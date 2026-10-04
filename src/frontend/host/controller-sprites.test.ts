import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../config.js";
import type { TurnView } from "../../protocol.js";
import type { SpriteTurnView } from "../../shared/sprites.js";
import {
  applyVisualConfigToStage,
  fetchLumiverseImage,
  relayReferenceFetch,
  stageOwnsBackground,
  stageTurnInput,
  turnWithPlate,
  turnWithSpriteImage,
  type VisualStageThemeTarget,
} from "./controller";

/** Host wiring for sprite mode (pure parts of controller.ts). */
const sprites: SpriteTurnView = {
  staging: {
    version: 1,
    source: "planner",
    cast: [{ characterKey: "mira", name: "Mira", identity: "", attire: null }],
    plates: [{ plateKey: "plate_a", location: "park", timeOfDay: null, weather: null, description: "" }],
    paragraphs: [{ actors: [], plateKey: "plate_a", light: "neutral" }],
  },
  sets: { mira: { setKey: "set_mira", name: "Mira", attire: null, expressions: { idle: { expression: "idle", status: "queued" } }, readyCount: 0, updatedAt: "" } },
  plates: { plate_a: { plateKey: "plate_a", location: "park", timeOfDay: null, weather: null, status: "queued" } },
};

const view = (patch: Partial<TurnView> = {}): TurnView => ({
  chatId: "c", messageId: "m", sourceFingerprint: "f", status: "ready", speaker: "Mira", userSpeaker: "You",
  paragraphs: ["One."], choices: [], assets: [], ...patch,
} as TurnView);

describe("sprite mode host wiring", () => {
  test("applyVisualConfigToStage pushes the presentation mode when the stage supports it", () => {
    const calls: string[] = [];
    const stage: VisualStageThemeTarget = {
      setThemePreset() {}, setSceneImageFit() {}, setUserCss() {}, setDisplayRegexRules() {},
      setPresentationMode(mode) { calls.push(mode); },
    };
    applyVisualConfigToStage(stage, { ...DEFAULT_CONFIG, presentationMode: "sprites" });
    applyVisualConfigToStage(stage, { ...DEFAULT_CONFIG });
    expect(calls).toEqual(["sprites", "scene"]);
  });

  test("stageTurnInput carries turn.sprites only when present", () => {
    expect(stageTurnInput(view({ sprites }), "standard", false).sprites).toBe(sprites);
    expect(Object.hasOwn(stageTurnInput(view(), "standard", false), "sprites")).toBe(false);
  });

  test("the stage owns the background only in sprite mode for a turn with sprites", () => {
    expect(stageOwnsBackground({ presentationMode: "sprites" }, { sprites })).toBe(true);
    expect(stageOwnsBackground({ presentationMode: "sprites" }, {})).toBe(false);
    expect(stageOwnsBackground({ presentationMode: "scene" }, { sprites })).toBe(false);
    expect(stageOwnsBackground(null, { sprites })).toBe(false);
  });

  test("sprite and plate updates are folded into the stored turn", () => {
    const turn = view({ sprites });
    const updated = turnWithSpriteImage(turn, "set_mira", { expression: "idle", status: "ready", url: "/i.png" });
    expect(updated.sprites!.sets.mira!.expressions.idle!.url).toBe("/i.png");
    expect(updated.sprites!.sets.mira!.readyCount).toBe(1);
    expect(turnWithSpriteImage(turn, "set_other", { expression: "idle", status: "ready", url: "/i.png" })).toBe(turn);
    const plated = turnWithPlate(turn, { plateKey: "plate_a", location: "park", timeOfDay: null, weather: null, status: "ready", url: "/p.png" });
    expect(plated.sprites!.plates.plate_a!.url).toBe("/p.png");
    const plain = view();
    expect(turnWithPlate(plain, { plateKey: "plate_a", location: "", timeOfDay: null, weather: null, status: "ready" })).toBe(plain);
  });

  test("fetchLumiverseImage fetches same-origin with credentials and reports HTTP errors", async () => {
    const seen: Array<[string, RequestInit | undefined]> = [];
    const ok = async (input: string, init?: RequestInit) => { seen.push([input, init]); return new Response(new Blob(["x"], { type: "image/png" })); };
    const blob = await fetchLumiverseImage("a b", ok);
    expect(blob.size).toBe(1);
    expect(seen[0]).toEqual(["/api/v1/images/a%20b", { credentials: "same-origin" }]);
    await expect(fetchLumiverseImage("x", async () => new Response("", { status: 404 }))).rejects.toThrow("Image fetch failed (404).");
  });

  test("relayReferenceFetch keeps its error text after the shared fetch refactor", async () => {
    const replies: unknown[] = [];
    await relayReferenceFetch({ requestId: "r", imageId: "x" }, async () => new Response("", { status: 403 }), (reply) => replies.push(reply));
    expect(replies).toEqual([{ type: "vn_reference_image", requestId: "r", error: "Image fetch failed (403)." }]);
  });
});
