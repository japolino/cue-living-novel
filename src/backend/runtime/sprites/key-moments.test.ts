import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../../config.js";
import { AssetJobSchema, type AssetJob } from "../../../shared/contracts.js";
import { SpriteStagingSchema, type SpriteParagraphStage } from "../../../shared/sprites.js";
import { makePlan } from "../__fixtures__/sprite-staging-plans.js";
import {
  applyKeyMoments,
  illustratedParagraphs,
  isSpritePlannedRecord,
  keyIllustrationCap,
  keyIllustrationCues,
  keyIllustrationPlan,
  keyIllustrationViews,
  keyMomentCues,
  keyMomentStrength,
  selectClassifiedKeyMoments,
  selectDeterministicKeyMoments,
} from "./key-moments.js";

const cue = { action: null };
const empty = (count: number): SpriteParagraphStage[] => Array.from({ length: count }, () => ({ actors: [], plateKey: null, light: "neutral" as const }));
const actor = { characterKey: "mira", expression: "idle", slot: "center" as const, facing: "viewer" as const, focus: true, motion: "none" as const, emote: "none" as const, intensity: 3 };
const withActor = (count: number): SpriteParagraphStage[] => Array.from({ length: count }, () => ({ actors: [actor], plateKey: null, light: "neutral" as const }));

function job(paragraphIndex: number, status: AssetJob["status"], jobId = `job-${paragraphIndex}`): AssetJob {
  const now = "2026-10-01T00:00:00.000Z";
  return AssetJobSchema.parse({
    jobId, ownerTurnKey: { chatId: "chat-1", assistantMessageId: "m-1", swipeId: 0, sourceFingerprint: "fingerprint-1", revision: 1 },
    sceneId: "scene-0", sceneRevision: 1, paragraphIndex, promptFingerprint: "fingerprint-abcdef", provider: "pending", status,
    imageId: status === "generated" ? `img-${paragraphIndex}` : null,
    imageUrl: status === "generated" ? `/api/v1/images/img-${paragraphIndex}` : null,
    error: status === "failed" ? "boom" : null,
    queuedAt: now,
    startedAt: status === "queued" ? null : now,
    generatedAt: status === "generated" ? now : null,
    finishedAt: status === "failed" || status === "cancelled" ? now : null,
  });
}

describe("key moments: cap", () => {
  test("off is 0, few is 1; no generated images or card images turn it off", () => {
    expect(keyIllustrationCap(DEFAULT_CONFIG)).toBe(0);
    expect(DEFAULT_CONFIG.keyIllustrations).toBe("off");
    expect(keyIllustrationCap({ ...DEFAULT_CONFIG, generateImages: true, keyIllustrations: "few" })).toBe(1);
    expect(keyIllustrationCap({ ...DEFAULT_CONFIG, generateImages: false, keyIllustrations: "few" })).toBe(0);
    expect(keyIllustrationCap({ ...DEFAULT_CONFIG, generateImages: true, useNativeCardImages: true, keyIllustrations: "few" })).toBe(0);
    expect(keyIllustrationCap(null)).toBe(0);
  });
});

describe("key moments: deterministic rule", () => {
  test("contact and fights rank 3, poses 2, an empty scene opener 1, ordinary moments 0", () => {
    expect(keyMomentStrength("Mira leans over and kisses him.", cue)).toBe(3);
    expect(keyMomentStrength("They fought across the rooftop.", cue)).toBe(3);
    expect(keyMomentStrength("She punched the wall.", cue)).toBe(3);
    expect(keyMomentStrength("Kai lifted her up and spun around.", cue)).toBe(3);
    expect(keyMomentStrength("Mira sits down on the bench.", cue)).toBe(2);
    expect(keyMomentStrength("He ran toward the gate.", cue)).toBe(2);
    expect(keyMomentStrength("She fell to her knees.", cue)).toBe(2);
    expect(keyMomentStrength("Mira smiles at him.", cue)).toBe(0);
    expect(keyMomentStrength("Mira smiles at him.", cue, { sceneOpenerWithoutCast: true })).toBe(1);
    expect(keyMomentStrength("She grips the hilt.", { action: { action: "wielding", object: "sword", relationship: "in right hand", hand: "right" } })).toBe(2);
  });

  test("no cue, quoted speech, negation, possessives and idioms do not count", () => {
    expect(keyMomentStrength("Mira sits down.", null)).toBe(0);
    expect(keyMomentStrength("\"Sit down and kiss me,\" Mira says.", cue)).toBe(0);
    expect(keyMomentStrength("She did not sit down.", cue)).toBe(0);
    expect(keyMomentStrength("He wanted to kiss her.", cue)).toBe(0);
    expect(keyMomentStrength("Mira lifts her chin.", cue)).toBe(0);
    expect(keyMomentStrength("She fights back tears.", cue)).toBe(0);
    expect(keyMomentStrength("He wrestles with the decision.", cue)).toBe(0);
    expect(keyMomentStrength("Her heart leaps.", cue)).toBe(0);
    expect(keyMomentStrength("Night falls over the city.", cue)).toBe(0);
    expect(keyMomentStrength("The answer lies in the letter.", cue)).toBe(0);
  });

  test("only paragraphs with a paintable cue; the strongest wins; ties go to the earliest; the cap holds", () => {
    const plan = makePlan({
      paragraphs: ["Mira sits on the bench.", "Mira kisses Kai.", "Mira kisses him again.", "Mira hugs Kai.", "Kai runs off."],
      cues: [
        { p: 0, character: "Mira", pose: "smile", identity: "1girl" },
        { p: 2, character: "Mira", pose: "smile", identity: "1girl" },
        { p: 3, character: "Mira", pose: "smile", identity: "1girl", cache: true },
        { p: 4, character: "Kai", pose: "idle", identity: "" },
      ],
    });
    // p1 has no cue; p4's identity is unresolved (the job would only fail).
    expect([...keyMomentCues(plan).keys()].sort()).toEqual([0, 2, 3]);
    expect([...selectDeterministicKeyMoments(plan, withActor(5), 1)]).toEqual([2]);
    expect([...selectDeterministicKeyMoments(plan, withActor(5), 2)].sort()).toEqual([2, 3]);
    expect([...selectDeterministicKeyMoments(plan, withActor(5), 0)]).toEqual([]);
  });

  test("a scene's first paragraph with nobody on stage qualifies only without anything stronger", () => {
    const plan = makePlan({
      paragraphs: ["The hall is silent.", "Mira smiles."],
      cues: [{ p: 0, character: "Mira", pose: "idle", identity: "1girl" }, { p: 1, character: "Mira", pose: "smile", identity: "1girl" }],
    });
    expect([...selectDeterministicKeyMoments(plan, empty(2), 1)]).toEqual([0]);
    expect([...selectDeterministicKeyMoments(plan, withActor(2), 1)]).toEqual([]);
  });
});

describe("key moments: classifier selection", () => {
  test("a major moment a sprite cannot show, or the defining moment unless a sprite clearly can", () => {
    const eligible = new Set([0, 1, 2, 3, 4]);
    const answers = new Map([
      [0, { moment: 1, standing: 0.05 }],
      [1, { moment: 3, standing: 0.3 }],
      [2, { moment: 3, standing: 0.7 }],
      [3, { moment: 4, standing: 0.55 }],
      [4, { moment: 4, standing: 0.9 }],
    ]);
    expect([...selectClassifiedKeyMoments(answers, eligible, 1)]).toEqual([3]);
    expect([...selectClassifiedKeyMoments(answers, eligible, 5)].sort()).toEqual([1, 3]);
    expect([...selectClassifiedKeyMoments(answers, new Set([0, 1, 2]), 5)]).toEqual([1]);
    expect([...selectClassifiedKeyMoments(new Map([[1, { standing: 0 }]]), eligible, 1)]).toEqual([]);
  });

  test("applyKeyMoments: classifier answers decide when present, else the deterministic rule; flags stay schema-valid", () => {
    const plan = makePlan({
      paragraphs: ["Mira sits down.", "Mira laughs.", "Mira cries."],
      cues: [0, 1, 2].map((p) => ({ p, character: "Mira", pose: "idle", identity: "1girl" })),
    });
    const stages = withActor(3).map((stage, index) => (index === 1 ? { ...stage, illustrate: true } : stage));
    expect(applyKeyMoments(stages, plan, 1).map((stage) => stage.illustrate ?? false)).toEqual([true, false, false]);
    expect(applyKeyMoments(stages, plan, 1, new Map([[2, { moment: 4, standing: 0.1 }]])).map((stage) => stage.illustrate ?? false)).toEqual([false, false, true]);
    // Answers without a moment level fall back to the rule; cap 0 clears every flag.
    expect(applyKeyMoments(stages, plan, 1, new Map([[2, { standing: 0.1 }]])).map((stage) => stage.illustrate ?? false)).toEqual([true, false, false]);
    const cleared = applyKeyMoments(stages, plan, 0);
    expect(cleared.every((stage) => !("illustrate" in stage))).toBe(true);
    const staging = { version: 1, source: "planner", cast: [{ characterKey: "mira", name: "Mira", identity: "1girl", attire: null }], plates: [], paragraphs: applyKeyMoments(stages, plan, 1) };
    expect(SpriteStagingSchema.safeParse(staging).success).toBe(true);
  });
});

describe("key moments: jobs and views", () => {
  const plan = makePlan({
    paragraphs: ["a", "b", "c"],
    cues: [
      { p: 0, character: "Mira", pose: "idle", identity: "1girl" },
      { p: 2, character: "Mira", pose: "smile", identity: "1girl", cache: true },
    ],
  });
  const staged = { ...plan, spriteStaging: { version: 1 as const, source: "planner" as const, cast: [], plates: [], paragraphs: [{ actors: [], plateKey: null, light: "neutral" as const }, { actors: [], plateKey: null, light: "neutral" as const, illustrate: true }, { actors: [], plateKey: null, light: "neutral" as const, illustrate: true }] } };

  test("cues for flagged paragraphs with a cue, within the cap; old records without flags have none", () => {
    expect(illustratedParagraphs(staged.spriteStaging)).toEqual([1, 2]);
    expect(keyIllustrationCues(staged, 1).map((item) => item.paragraphIndex)).toEqual([2]);
    expect(keyIllustrationCues(staged, 0)).toEqual([]);
    expect(keyIllustrationCues(plan, 1)).toEqual([]);
  });

  test("the pipeline plan keeps only cues that own a job and drops reuse-only candidates", () => {
    const narrowed = keyIllustrationPlan({ ...plan, classifierVisuals: true }, [{ jobId: "job-1" }]);
    expect(narrowed.visualCues.map((item) => item.assetJobId)).toEqual(["job-1"]);
    expect(narrowed.cacheCues).toBeUndefined();
    expect(narrowed.classifierVisuals).toBeUndefined();
  });

  test("views: ready with a URL, failed, or pending; only flagged paragraphs", () => {
    expect(keyIllustrationViews(staged.spriteStaging, [job(0, "generated"), job(2, "generated")])).toEqual([
      { paragraphIndex: 2, jobId: "job-2", status: "ready", url: "/api/v1/images/img-2" },
    ]);
    expect(keyIllustrationViews(staged.spriteStaging, [job(2, "failed")])[0]!.status).toBe("failed");
    expect(keyIllustrationViews(staged.spriteStaging, [job(2, "queued")])[0]).toEqual({ paragraphIndex: 2, jobId: "job-2", status: "pending" });
    expect(keyIllustrationViews(staged.spriteStaging, [job(2, "cancelled")])[0]!.status).toBe("pending");
  });

  test("a sprite-planned record is marked in its settings snapshot", () => {
    expect(isSpritePlannedRecord({ plan: staged, settingsSnapshot: { presentationMode: "sprites" } })).toBe(true);
    expect(isSpritePlannedRecord({ plan: staged, settingsSnapshot: {} })).toBe(false);
    expect(isSpritePlannedRecord({ plan, settingsSnapshot: { presentationMode: "sprites" } })).toBe(false);
  });
});
