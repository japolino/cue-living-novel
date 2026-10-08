import assert from "node:assert/strict";
import test from "node:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../config.js";
import { ContinuityStateSchema, SceneStateSchema } from "../../shared/contracts.js";
import { emptySingleCharacter } from "../core/visual-state.js";
import { planTurn } from "./planner.js";

const OUTFIT = "white blouse, navy pleated skirt";
const continuity = ContinuityStateSchema.parse({ revision: 1, characters: { Mira: { wardrobe: { attire: OUTFIT } }, User: { wardrobe: { attire: "gray hoodie" } } }, facts: {} });
const scene = SceneStateSchema.parse({
  sceneId: "library-scene", revision: 1, startParagraph: 0,
  environment: { location: "Library", timeOfDay: "evening", weather: null, lighting: "lamplight", description: "A quiet library with bookshelves.", persistentElements: ["bookshelves"] },
  cast: ["Mira"], character: "Mira", attire: OUTFIT, continuity, basePrompt: "quiet library, bookshelves, lamplight",
  cameraLock: { framing: "upper body", angle: "eye level", perspective: "straight-on", lens: null, subjectAnchor: "center", horizon: "middle", safeDialogueRegion: "lower quarter", aspectRatio: "16:9" },
  compositionLock: "Mira centered", identityPrompt: "woman, brown hair, green eyes", activeAssetId: null, priorSceneId: null,
});

type Answers = { wardrobe?: number; other?: number; scene?: number };

function plannerOutput(attire: string, location: string) {
  return {
    scenes: [{
      startParagraph: 0,
      boundary: { claimedNewScene: location !== "Library", reason: location !== "Library" ? "location_change" : "none", location },
      environment: { location, timeOfDay: "night", weather: null, lighting: "lamplight", description: `${location} at night`, persistentElements: [] },
      cast: ["Mira"], character: "Mira", attire, basePrompt: location, compositionLock: "centered",
    }],
    cues: [{ paragraphIndex: 0, character: "Mira", attire, expression: "smile" }],
    characters: [{ name: "Mira", description: "woman, brown hair, green eyes" }],
  };
}

function setup(answers: Answers | null, planner: unknown, paragraphs = 2) {
  const requests: Array<{ questions: Record<string, { instructions: string }> }> = [];
  const logs: string[] = [];
  const spindle = {
    enclave: { get: async () => answers ? "test-secret" : null },
    cors: async (_url: string, request: { body: string }) => {
      const body = JSON.parse(request.body);
      requests.push(body);
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(body.questions)) {
        if (key === "scene_change") out[key] = { type: "noul", noul: answers?.scene ?? 0.05 };
        else if (key === "needs_description") out[key] = { type: "noul", noul: 0.9 };
        else if (key.startsWith("wardrobe_other")) out[key] = { type: "noul", noul: answers?.other ?? answers?.wardrobe ?? 0.05 };
        else if (key.startsWith("wardrobe_")) out[key] = { type: "noul", noul: answers?.wardrobe ?? 0.05 };
      }
      return { status: 200, body: JSON.stringify({ model: "jev-latest", answers: out }) };
    },
    generate: { raw: async () => ({ choices: [{ message: { content: JSON.stringify(planner) } }] }) },
    storage: { list: async () => [] },
    log: { warn: (line: string) => logs.push(line), info: (line: string) => logs.push(line) },
  } as unknown as SpindleAPI;
  const content = Array.from({ length: paragraphs }, (_, index) => `Mira reads quietly, line ${index}.`).join("\n\n");
  const input = {
    chatId: "c1", message: { id: "a1", chat_id: "c1", index_in_chat: 1, is_user: false, name: "Mira", content, send_date: 1, swipe_id: 0, swipes: [], swipe_dates: [], extra: {}, parent_message_id: null, branch_id: null, created_at: 1, role: "assistant" as const },
    content, previousScene: scene, previousContinuity: continuity, recentMessages: [],
    config: { ...DEFAULT_CONFIG, systemOneMode: answers ? "on" as const : "off" as const, debugLogging: true },
    singleCharacter: emptySingleCharacter(), characterAppearance: { Mira: "woman, brown hair, green eyes" },
  };
  return { spindle, input, requests, logs };
}

test("Jev same keeps the previous outfit and place although the planner reworded both", async () => {
  const f = setup({ wardrobe: 0.05, scene: 0.05 }, plannerOutput("red evening gown", "Old Library Reading Room"));
  const result = await planTurn(f.spindle, f.input);
  assert.equal(result.plan.scenes[0]!.attire, OUTFIT);
  assert.equal(result.plan.visualCues[0]!.resolvedAttire, OUTFIT);
  assert.equal(result.plan.terminalVisualState?.attire, OUTFIT);
  assert.deepEqual(result.plan.continuityDeltas, []);
  assert.equal(result.plan.scenes[0]!.environment.location, "Library");
  assert.equal(result.plan.scenes[0]!.environment.timeOfDay, "evening");
  assert.equal(result.plan.scenes[0]!.sceneId, "library-scene");
  assert.ok(f.logs.some((line) => line.includes(`wardrobe Mira p0: jev same (top 0.05, bottom 0.05, other 0.05) -> kept "${OUTFIT}"`)), f.logs.join("\n"));
  assert.ok(f.logs.some((line) => line.includes(`scene: jev same (0.05) -> kept "Library / evening"`)));
});

test("Jev changed takes the planner's outfit and place", async () => {
  const f = setup({ wardrobe: 0.1, other: 0.83, scene: 0.9 }, plannerOutput("fitted white blouse, short navy skirt", "Rooftop"));
  const result = await planTurn(f.spindle, f.input);
  assert.equal(result.plan.scenes[0]!.attire, "fitted white blouse, short navy skirt");
  assert.equal(result.plan.scenes[0]!.environment.location, "Rooftop");
  assert.ok(f.logs.some((line) => line.includes("jev changed (top 0.10, bottom 0.10, other 0.83)")));
});

test("Jev unsure: the text check keeps a reworded outfit and takes a new one", async () => {
  const kept = setup({ wardrobe: 0.4, scene: 0.4 }, plannerOutput("fitted white blouse, short navy skirt", "Rooftop"));
  const keptResult = await planTurn(kept.spindle, kept.input);
  assert.equal(keptResult.plan.scenes[0]!.attire, OUTFIT);
  assert.equal(keptResult.plan.scenes[0]!.environment.location, "Rooftop");
  const taken = setup({ wardrobe: 0.4 }, plannerOutput("red evening gown", "Library"));
  assert.equal((await planTurn(taken.spindle, taken.input)).plan.scenes[0]!.attire, "red evening gown");
});

test("Jev off: only the text check; no request is sent", async () => {
  const f = setup(null, plannerOutput("fitted white blouse, short navy skirt", "Rooftop"));
  const result = await planTurn(f.spindle, f.input);
  assert.equal(f.requests.length, 0);
  assert.equal(result.plan.scenes[0]!.attire, OUTFIT);
  assert.equal(result.plan.scenes[0]!.environment.location, "Rooftop");
  assert.ok(f.logs.some((line) => line.includes("wardrobe Mira p0: text same -> kept")));
});

test("wardrobe and scene questions go to every batch; needs_description only with a complete view; the persona is never asked about", async () => {
  const f = setup({ wardrobe: 0.05, scene: 0.05 }, plannerOutput(OUTFIT, "Library"), 9);
  await planTurn(f.spindle, f.input);
  assert.equal(f.requests.length, 2);
  for (const request of f.requests) {
    assert.ok(request.questions.scene_change);
    assert.ok(request.questions.wardrobe_top_0 && request.questions.wardrobe_bottom_0 && request.questions.wardrobe_other_0);
    assert.match(request.questions.wardrobe_top_0!.instructions, /Mira's current outfit: white blouse, navy pleated skirt/);
    assert.equal(request.questions.wardrobe_top_1, undefined);
    assert.ok(!JSON.stringify(request.questions).includes("hoodie"));
    assert.equal(request.questions.needs_description, undefined);
  }
  const short = setup({ wardrobe: 0.05, scene: 0.05 }, plannerOutput(OUTFIT, "Library"), 2);
  await planTurn(short.spindle, short.input);
  assert.equal(short.requests.length, 1);
  assert.ok(short.requests[0]!.questions.needs_description);
});
