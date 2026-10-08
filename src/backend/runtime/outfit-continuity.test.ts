import assert from "node:assert/strict";
import test from "node:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../config.js";
import { ContinuityStateSchema, SceneStateSchema } from "../../shared/contracts.js";
import { emptySingleCharacter } from "../core/visual-state.js";
import { planTurn } from "./planner.js";
import { cleanReplyText, sceneStartChunks } from "./system-one.js";

const OUTFIT = "white blouse, navy pleated skirt";
const continuity = ContinuityStateSchema.parse({ revision: 1, characters: { Mira: { wardrobe: { attire: OUTFIT } }, User: { wardrobe: { attire: "plaid flannel overshirt" } } }, facts: {} });
const scene = SceneStateSchema.parse({
  sceneId: "library-scene", revision: 1, startParagraph: 0,
  environment: { location: "Library", timeOfDay: "evening", weather: null, lighting: "lamplight", description: "A quiet library with bookshelves.", persistentElements: ["bookshelves"] },
  cast: ["Mira"], character: "Mira", attire: OUTFIT, continuity, basePrompt: "quiet library, bookshelves, lamplight",
  cameraLock: { framing: "upper body", angle: "eye level", perspective: "straight-on", lens: null, subjectAnchor: "center", horizon: "middle", safeDialogueRegion: "lower quarter", aspectRatio: "16:9" },
  compositionLock: "Mira centered", identityPrompt: "woman, brown hair, green eyes", activeAssetId: null, priorSceneId: null,
});

const SAME_PLACE = { choice: "same_place_reworded", probabilities: { same_place: 0.3, same_place_reworded: 0.65, different_place: 0.05 } };
const NEW_PLACE = { choice: "different_place", probabilities: { same_place: 0.05, different_place: 0.95 } };
/** outfit: [P(changed_outfit), yes/no] or a function of the request's text; null = no answer. */
type Answers = { outfit?: [number, number] | null | ((text: string) => [number, number]); scene?: { choice: string; probabilities: Record<string, number> } | null };

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

type Request = { state: Record<string, any>; questions: Record<string, { type: string; instructions: string }> };

function setup(answers: Answers | null, planner: unknown, paragraphs: number | string[] = 2) {
  const requests: Request[] = [];
  const bodies: string[] = [];
  const logs: string[] = [];
  const spindle = {
    enclave: { get: async () => answers ? "test-secret" : null },
    cors: async (_url: string, request: { body: string }) => {
      bodies.push(request.body);
      const body = JSON.parse(request.body) as Request;
      requests.push(body);
      const out: Record<string, unknown> = {};
      const text = JSON.stringify(body.state.paragraphs ?? []);
      const outfit = typeof answers?.outfit === "function" ? answers.outfit(text) : answers?.outfit;
      for (const key of Object.keys(body.questions)) {
        if (key === "scene_start" && answers?.scene) out[key] = { type: "choice", choice: answers.scene.choice, confidence: 0.9, probabilities: answers.scene.probabilities };
        else if (key === "needs_description") out[key] = { type: "noul", noul: 0.9 };
        else if (key.startsWith("outfit_choice") && outfit) out[key] = { type: "choice", choice: outfit[0] > 0.5 ? "changed_outfit" : "same_outfit", confidence: 0.9, probabilities: { changed_outfit: outfit[0], same_outfit: 1 - outfit[0] } };
        else if (key.startsWith("outfit_change") && outfit) out[key] = { type: "noul", noul: outfit[1] };
      }
      return { status: 200, body: JSON.stringify({ model: "jev-latest", answers: out }) };
    },
    generate: { raw: async () => ({ choices: [{ message: { content: JSON.stringify(planner) } }] }) },
    storage: { list: async () => [] },
    log: { warn: (line: string) => logs.push(line), info: (line: string) => logs.push(line) },
  } as unknown as SpindleAPI;
  const content = (typeof paragraphs === "number" ? Array.from({ length: paragraphs }, (_, index) => `Mira reads quietly, line ${index}.`) : paragraphs).join("\n\n");
  const input = {
    chatId: "c1", message: { id: "a1", chat_id: "c1", index_in_chat: 1, is_user: false, name: "Mira", content, send_date: 1, swipe_id: 0, swipes: [], swipe_dates: [], extra: {}, parent_message_id: null, branch_id: null, created_at: 1, role: "assistant" as const },
    content, previousScene: scene, previousContinuity: continuity, recentMessages: [],
    config: { ...DEFAULT_CONFIG, systemOneMode: answers ? "on" as const : "off" as const, debugLogging: true },
    singleCharacter: emptySingleCharacter(), characterAppearance: { Mira: "woman, brown hair, green eyes" },
  };
  const outfitRequests = () => requests.filter((request) => request.questions.outfit_choice_0);
  const sceneRequests = () => requests.filter((request) => request.questions.scene_start);
  return { spindle, input, requests, bodies, logs, outfitRequests, sceneRequests };
}

test("Jev same keeps the previous outfit and place although the planner reworded both", async () => {
  const f = setup({ outfit: [0.1, 0.14], scene: SAME_PLACE }, plannerOutput("red evening gown", "Old Library Reading Room"));
  const result = await planTurn(f.spindle, f.input);
  assert.equal(result.plan.scenes[0]!.attire, OUTFIT);
  assert.equal(result.plan.visualCues[0]!.resolvedAttire, OUTFIT);
  assert.equal(result.plan.terminalVisualState?.attire, OUTFIT);
  assert.deepEqual(result.plan.continuityDeltas, []);
  assert.equal(result.plan.scenes[0]!.environment.location, "Library");
  assert.equal(result.plan.scenes[0]!.environment.timeOfDay, "evening");
  assert.equal(result.plan.scenes[0]!.sceneId, "library-scene");
  assert.ok(f.logs.some((line) => line.includes(`wardrobe Mira p0: jev same (0.12) -> kept "${OUTFIT}"`)), f.logs.join("\n"));
  assert.ok(f.logs.some((line) => line.includes(`scene: jev same_place_reworded (score 0.05) -> kept "Library / evening"`)));
});

test("Jev changed takes the planner's outfit and place", async () => {
  const f = setup({ outfit: [0.9, 0.76], scene: NEW_PLACE }, plannerOutput("fitted white blouse, short navy skirt", "Rooftop"));
  const result = await planTurn(f.spindle, f.input);
  assert.equal(result.plan.scenes[0]!.attire, "fitted white blouse, short navy skirt");
  assert.equal(result.plan.scenes[0]!.environment.location, "Rooftop");
  assert.ok(f.logs.some((line) => line.includes("jev changed (0.83)")));
  assert.ok(f.logs.some((line) => line.includes("scene: jev different_place (score 0.95) -> planner")));
});

test("no Jev outfit answer: the text check keeps a reworded outfit and takes a new one", async () => {
  const kept = setup({ outfit: null, scene: null }, plannerOutput("fitted white blouse, short navy skirt", "Rooftop"));
  const keptResult = await planTurn(kept.spindle, kept.input);
  assert.equal(keptResult.plan.scenes[0]!.attire, OUTFIT);
  assert.equal(keptResult.plan.scenes[0]!.environment.location, "Rooftop");
  const taken = setup({ outfit: null }, plannerOutput("red evening gown", "Library"));
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

test("requests: one outfit request with the whole reply, one scene request with the start; the persona is never asked about", async () => {
  const f = setup({ outfit: [0.1, 0.1], scene: SAME_PLACE }, plannerOutput(OUTFIT, "Library"), 30);
  await planTurn(f.spindle, f.input);
  const outfit = f.outfitRequests();
  assert.equal(outfit.length, 1);
  assert.deepEqual(Object.keys(outfit[0]!.state), ["paragraphs"]);
  assert.equal(outfit[0]!.state.paragraphs.length, 30);
  assert.deepEqual(Object.keys(outfit[0]!.questions), ["outfit_choice_0", "outfit_change_0"]);
  assert.equal(outfit[0]!.questions.outfit_choice_0!.type, "choice");
  assert.match(outfit[0]!.questions.outfit_choice_0!.instructions, /Compare what Mira is wearing at the END of these paragraphs with her outfit before them: "white blouse, navy pleated skirt"\./);
  assert.match(outfit[0]!.questions.outfit_change_0!.instructions, /Her outfit at the start: white blouse, navy pleated skirt\./);
  assert.ok(!f.bodies.some((body) => body.includes("flannel")));
  const sceneRequest = f.sceneRequests();
  assert.equal(sceneRequest.length, 1);
  assert.deepEqual(sceneRequest[0]!.state.previousScene, { location: "Library", timeOfDay: "evening", weather: null });
  assert.equal(sceneRequest[0]!.state.paragraphs.length, 1);
  assert.ok(!JSON.stringify(sceneRequest[0]).includes("Rooftop"));
  // The per-paragraph batches carry neither change question; needs_description only for short replies.
  const batches = f.requests.filter((request) => !request.questions.outfit_choice_0 && !request.questions.scene_start);
  assert.equal(batches.length, 4);
  assert.ok(batches.every((request) => !request.questions.scene_change && !request.questions.needs_description));
  const short = setup({ outfit: [0.1, 0.1], scene: SAME_PLACE }, plannerOutput(OUTFIT, "Library"), 2);
  await planTurn(short.spindle, short.input);
  assert.ok(short.requests.some((request) => request.questions.needs_description));
});

test("a long reply is split into the fewest outfit requests under 64 KiB; the highest score counts", async () => {
  const long = Array.from({ length: 40 }, (_, index) => `${index === 37 ? "Mira takes off her blouse and puts on a red swimsuit. " : ""}${"Mira reads on. ".repeat(190)}`);
  const f = setup({ outfit: (text) => text.includes("swimsuit") ? [0.9, 0.9] : [0.05, 0.05], scene: SAME_PLACE }, plannerOutput("red swimsuit", "Library"), long);
  const result = await planTurn(f.spindle, f.input);
  const outfit = f.outfitRequests();
  assert.equal(outfit.length, 2);
  assert.ok(f.bodies.every((body) => new TextEncoder().encode(body).length <= 65_536));
  assert.equal(outfit.reduce((total, request) => total + request.state.paragraphs.length, 0), 40);
  assert.equal(result.plan.scenes[0]!.attire, "red swimsuit");
});

test("reply cleaning: HTML tags and long blobs are dropped; the scene start is 2 chunks of <= 3000 chars", () => {
  assert.equal(cleanReplyText(`<div class="x">Mira <b>smiles</b>.</div> data:${"A".repeat(120)} end`), "Mira smiles . end");
  const text = "word ".repeat(280).trim();
  const chunks = sceneStartChunks(Array.from({ length: 12 }, () => ({ text })));
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 3000));
  assert.equal(chunks[0], `${text}\n\n${text}`);
});
