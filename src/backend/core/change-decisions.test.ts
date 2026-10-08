import assert from "node:assert/strict";
import test from "node:test";
import { ContinuityStateSchema } from "../../shared/contracts.js";
import { decideOutfit, decideScene, sceneScore, wardrobeScore, type JevWardrobeAnswers } from "./change-decisions.js";
import { resolveCueTimeline } from "./cue-state.js";

const OLD = "dark green bib apron, white collared shirt, black slacks";
const REWORDED = "dark green bib apron, tight white collared shirt, fitted black slacks";
const NEW = "white button-down shirt, black shorts";
const jev = (...chunks: Array<[number | null, number | null]>): JevWardrobeAnswers => ({ chunks: chunks.map(([changedOutfit, noul]) => ({ changedOutfit, noul })) });

test("wardrobeScore: mean of P(changed_outfit) and the yes/no, max over chunks", () => {
  assert.equal(wardrobeScore(jev([0.2, 0.4]))?.toFixed(2), "0.30");
  assert.equal(wardrobeScore(jev([0.1, 0.1], [0.9, 0.7])), 0.8);
  assert.equal(wardrobeScore(jev([null, 0.5])), 0.5);
  assert.equal(wardrobeScore(jev([null, null])), null);
  assert.equal(wardrobeScore({ chunks: [] }), null);
});

test("decideOutfit: a Jev score decides (changed above 0.4) and wins over the text check", () => {
  const same = decideOutfit({ character: "Rin", previousOutfit: OLD, plannerOutfit: NEW, paragraphs: [], jev: jev([0.1, 0.14]) });
  assert.deepEqual([same.decision, same.source, same.reason], ["same", "jev", "jev same (0.12)"]);
  assert.equal(decideOutfit({ character: "Rin", previousOutfit: OLD, plannerOutfit: NEW, paragraphs: [], jev: jev([0.4, 0.4]) }).decision, "same");
  const changed = decideOutfit({ character: "Rin", previousOutfit: OLD, plannerOutfit: REWORDED, paragraphs: [], jev: jev([0.9, 0.76]) });
  assert.deepEqual([changed.decision, changed.source, changed.reason], ["changed", "jev", "jev changed (0.83)"]);
});

test("decideOutfit: no Jev answer falls back to the text check", () => {
  for (const answers of [null, jev([null, null])]) {
    const kept = decideOutfit({ character: "Rin", previousOutfit: OLD, plannerOutfit: REWORDED, paragraphs: [], jev: answers });
    assert.deepEqual([kept.decision, kept.source, kept.reason], ["same", "text", "text same"]);
  }
  assert.equal(decideOutfit({ character: "Rin", previousOutfit: OLD, plannerOutfit: NEW, paragraphs: [], jev: null }).decision, "changed");
  assert.equal(decideOutfit({ character: "Rin", previousOutfit: OLD, plannerOutfit: NEW, paragraphs: [], jev: null, overruled: ["white button-down shirt, black shorts, dark socks"] }).decision, "same");
});

test("sceneScore and decideScene: same_place, reworded and flashback count as same; changed above 0.5", () => {
  const place = { location: "Cafe", timeOfDay: "afternoon", weather: null };
  const answer = (choice: string, probabilities: Record<string, number>) => ({ choice, probabilities });
  const reworded = answer("same_place_reworded", { same_place: 0.3, same_place_reworded: 0.66, different_place: 0.04 });
  assert.equal(Number(sceneScore(reworded).toFixed(2)), 0.04);
  const same = decideScene({ previousEnvironment: place, plannerEnvironment: place, paragraphs: [], jev: reworded });
  assert.deepEqual([same.decision, same.reason], ["same", "jev same_place_reworded (score 0.04)"]);
  assert.equal(decideScene({ previousEnvironment: place, plannerEnvironment: place, paragraphs: [], jev: answer("flashback_or_call", { flashback_or_call: 0.8, different_place: 0.2 }) }).decision, "same");
  assert.equal(decideScene({ previousEnvironment: place, plannerEnvironment: place, paragraphs: [], jev: answer("different_place", { same_place: 0.1, different_place: 0.9 }) }).decision, "changed");
  assert.equal(decideScene({ previousEnvironment: place, plannerEnvironment: place, paragraphs: [], jev: answer("moved_within_building", { same_place: 0.45, moved_within_building: 0.55 }) }).decision, "changed");
  assert.equal(decideScene({ previousEnvironment: place, plannerEnvironment: place, paragraphs: [], jev: null }).decision, "unsure");
  assert.equal(decideScene({ previousEnvironment: null, plannerEnvironment: place, paragraphs: [], jev: reworded }).decision, "unsure");
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
  const result = timeline(NEW, NEW, { jev: new Map([["rin", jev([0.05, 0.1])]]), coveredThrough: 29 });
  assert.equal(result.snapshots[0]!.attire, OLD);
  assert.equal(result.snapshots.at(-1)!.attire, OLD);
  assert.deepEqual(result.deltas, []);
  assert.equal(result.wardrobeNotes[0]!.kept, true);
  assert.equal(result.wardrobeNotes[0]!.source, "jev");
});

test("timeline: the text check keeps a reworded outfit when Jev did not answer", () => {
  for (const outfit of [{ jev: new Map([["rin", jev([null, null])]]), coveredThrough: 29 }, undefined]) {
    const result = timeline(REWORDED, null, outfit);
    assert.equal(result.snapshots[0]!.attire, OLD);
    assert.deepEqual(result.deltas, []);
  }
});

test("timeline: Jev changed (or a different text) takes the planner's outfit", () => {
  const changed = timeline(REWORDED, null, { jev: new Map([["rin", jev([0.9, 0.7])]]), coveredThrough: 29 });
  assert.equal(changed.snapshots[0]!.attire, REWORDED);
  assert.equal(changed.deltas.length, 1);
  assert.equal(timeline(NEW, null).snapshots[0]!.attire, NEW);
});

test("timeline: past the covered paragraphs the text check decides; a repeated overruled outfit stays overruled", () => {
  const repeated = timeline(NEW, NEW, { jev: new Map([["rin", jev([0.05, 0.05])]]), coveredThrough: 23 });
  assert.equal(repeated.snapshots.at(-1)!.attire, OLD);
  const later = timeline(REWORDED, "red bikini", { jev: new Map([["rin", jev([0.05, 0.05])]]), coveredThrough: 23 });
  assert.equal(later.snapshots[25]!.attire, OLD);
  assert.equal(later.snapshots[26]!.attire, "red bikini");
});

test("timeline: a custom decider can be plugged in", () => {
  const result = timeline(NEW, null, { decide: () => ({ decision: "same", source: "text", reason: "custom" }) });
  assert.equal(result.snapshots[0]!.attire, OLD);
  assert.equal(result.wardrobeNotes[0]!.reason, "custom");
});
