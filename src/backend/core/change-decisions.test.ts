import assert from "node:assert/strict";
import test from "node:test";
import { ContinuityStateSchema } from "../../shared/contracts.js";
import { changeDecision, decideOutfit, decideScene, type JevWardrobeAnswers } from "./change-decisions.js";
import { resolveCueTimeline } from "./cue-state.js";

const OLD = "dark green bib apron, white collared shirt, black slacks";
const REWORDED = "dark green bib apron, tight white collared shirt, fitted black slacks";
const NEW = "white button-down shirt, black shorts";
const jev = (top: number[], bottom: number[] = top, other: number[] = top): JevWardrobeAnswers => ({ top, bottom, other });

test("changeDecision: same only when every answer of every batch is <= 0.2; changed on any >= 0.6", () => {
  assert.equal(changeDecision([0.05, 0.2, 0.1, 0.02]), "same");
  assert.equal(changeDecision([0.05, 0.6]), "changed");
  assert.equal(changeDecision([0.05, 0.3, 0.9]), "changed");
  assert.equal(changeDecision([0.05, 0.21]), "unsure");
  assert.equal(changeDecision([0.05, null]), "unsure");
  assert.equal(changeDecision([]), null);
});

test("decideOutfit: Jev same or changed wins over the text check", () => {
  assert.equal(decideOutfit({ character: "Rin", previousOutfit: OLD, plannerOutfit: NEW, paragraphs: [], jev: jev([0.1, 0.05], [0.1, 0.1], [0.04, 0.2]) }).decision, "same");
  const changed = decideOutfit({ character: "Rin", previousOutfit: OLD, plannerOutfit: REWORDED, paragraphs: [], jev: jev([0.1, 0.1], [0.1, 0.1], [0.1, 0.83]) });
  assert.equal(changed.decision, "changed");
  assert.equal(changed.source, "jev");
  assert.match(changed.reason, /jev changed \(top 0\.10, bottom 0\.10, other 0\.83\)/);
});

test("decideOutfit: unsure or no Jev falls back to the text check", () => {
  const unsure = decideOutfit({ character: "Rin", previousOutfit: OLD, plannerOutfit: REWORDED, paragraphs: [], jev: jev([0.4]) });
  assert.deepEqual([unsure.decision, unsure.source], ["same", "text"]);
  assert.match(unsure.reason, /jev unsure .*text same/);
  assert.equal(decideOutfit({ character: "Rin", previousOutfit: OLD, plannerOutfit: REWORDED, paragraphs: [], jev: null }).decision, "same");
  assert.equal(decideOutfit({ character: "Rin", previousOutfit: OLD, plannerOutfit: NEW, paragraphs: [], jev: null }).decision, "changed");
  assert.equal(decideOutfit({ character: "Rin", previousOutfit: OLD, plannerOutfit: NEW, paragraphs: [], jev: null, overruled: ["white button-down shirt, black shorts, dark socks"] }).decision, "same");
});

test("decideScene: Jev only; no previous scene or no Jev is unsure", () => {
  const place = { location: "Cafe", timeOfDay: "afternoon", weather: null };
  assert.equal(decideScene({ previousEnvironment: place, plannerEnvironment: place, paragraphs: [], jev: [0.05, 0.1] }).decision, "same");
  assert.equal(decideScene({ previousEnvironment: place, plannerEnvironment: place, paragraphs: [], jev: [0.05, 0.7] }).decision, "changed");
  assert.equal(decideScene({ previousEnvironment: place, plannerEnvironment: place, paragraphs: [], jev: [0.05, 0.3] }).decision, "unsure");
  assert.equal(decideScene({ previousEnvironment: place, plannerEnvironment: place, paragraphs: [], jev: null }).decision, "unsure");
  assert.equal(decideScene({ previousEnvironment: null, plannerEnvironment: place, paragraphs: [], jev: [0.05] }).decision, "unsure");
});

function timeline(sceneAttire: string, cueAttire: string | null, outfit?: Parameters<typeof resolveCueTimeline>[0]["outfit"]) {
  return resolveCueTimeline({
    paragraphs: 30,
    proposals: [{ startParagraph: 0, cast: ["Rin"], character: "Rin", attire: sceneAttire }],
    cues: [{ paragraphIndex: 0, character: "Rin", attire: sceneAttire }, ...(cueAttire ? [{ paragraphIndex: 26, character: "Rin", attire: cueAttire }] : [])],
    roster: [], appearances: { Rin: "catgirl" }, baseline: { name: "Rin", identity: "catgirl" },
    previousCharacter: "Rin", previousAttire: OLD,
    continuity: ContinuityStateSchema.parse({ revision: 1, characters: { Rin: { wardrobe: { attire: OLD } } }, facts: {} }),
    isPersona: (name) => (name ?? "").toLowerCase() === "jay", isReset: () => false,
    ...(outfit ? { outfit } : {}),
  });
}

test("timeline: Jev same keeps the previous outfit everywhere (no continuity update)", () => {
  const result = timeline(NEW, null, { jev: new Map([["rin", jev([0.05])]]), coveredThrough: 23 });
  assert.equal(result.snapshots[0]!.attire, OLD);
  assert.equal(result.snapshots.at(-1)!.attire, OLD);
  assert.deepEqual(result.deltas, []);
  assert.equal(result.wardrobeNotes[0]!.kept, true);
  assert.equal(result.wardrobeNotes[0]!.source, "jev");
});

test("timeline: text same keeps the previous outfit when Jev is unsure or absent", () => {
  for (const outfit of [{ jev: new Map([["rin", jev([0.4])]]), coveredThrough: 23 }, undefined]) {
    const result = timeline(REWORDED, null, outfit);
    assert.equal(result.snapshots[0]!.attire, OLD);
    assert.deepEqual(result.deltas, []);
  }
});

test("timeline: Jev changed (or a different text) takes the planner's outfit", () => {
  const changed = timeline(REWORDED, null, { jev: new Map([["rin", jev([0.1], [0.1], [0.9])]]), coveredThrough: 23 });
  assert.equal(changed.snapshots[0]!.attire, REWORDED);
  assert.equal(changed.deltas.length, 1);
  const different = timeline(NEW, null);
  assert.equal(different.snapshots[0]!.attire, NEW);
});

test("timeline: past Jev's paragraphs the text check decides; a repeated overruled outfit stays overruled", () => {
  const repeated = timeline(NEW, NEW, { jev: new Map([["rin", jev([0.05])]]), coveredThrough: 23 });
  assert.equal(repeated.snapshots.at(-1)!.attire, OLD);
  const later = timeline(REWORDED, "red bikini", { jev: new Map([["rin", jev([0.05])]]), coveredThrough: 23 });
  assert.equal(later.snapshots[25]!.attire, OLD);
  assert.equal(later.snapshots[26]!.attire, "red bikini");
});

test("timeline: a custom decider can be plugged in", () => {
  const result = timeline(NEW, null, { decide: () => ({ decision: "same", source: "text", reason: "custom" }) });
  assert.equal(result.snapshots[0]!.attire, OLD);
  assert.equal(result.wardrobeNotes[0]!.reason, "custom");
});
