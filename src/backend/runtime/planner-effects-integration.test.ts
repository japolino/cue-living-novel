import { describe, expect, test } from "bun:test";
import type { ChatMessageDTO, SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../../config.js";
import { AmbientEffectSchema, StageEffectSchema, type SceneState, type StageEffect, type AmbientEffect } from "../../shared/contracts.js";
import { emptySingleCharacter } from "../core/visual-state.js";
import { planTurn } from "./planner.js";
import { turnView } from "./controller.js";
import type { StoredTurnRecord } from "./storage.js";

// Durable versions of the eight-paragraph effects audit fixtures.
const paragraphs8 = [
  "Rain hammers the tin roof of the shrine.",
  "Mira steps out of the shadows, soaked to the bone.",
  "\"You came,\" she says quietly.",
  "The ground lurches. A deafening crack splits the sky.",
  "She grabs my wrist and pulls me under the eaves.",
  "For a second the world goes white.",
  "Then silence. Only the rain.",
  "\"We should go,\" she whispers, and the lantern dies."
];
const content8 = paragraphs8.join("\n\n");

const message: ChatMessageDTO & { role: "assistant" } = {
  id: "assistant-1", chat_id: "chat-1", index_in_chat: 2, is_user: false, name: "Mira",
  content: content8, send_date: 1, swipe_id: 0, swipes: [content8], swipe_dates: [1], extra: {},
  parent_message_id: "user-1", branch_id: null, created_at: 1, role: "assistant"
};

function baseScene(overrides: Record<string, unknown> = {}) {
  return {
    startParagraph: 0,
    boundary: { claimedNewScene: true, reason: "initial", location: "Mountain shrine", timeOfDay: "night", majorTimeJump: false, environmentReplacement: false, forced: false },
    environment: { location: "Mountain shrine", timeOfDay: "night", weather: "storm", lighting: "lantern light", description: "A small shrine in a storm", persistentElements: ["stone lantern"] },
    cast: ["Mira"], character: "Mira", basePrompt: "mountain shrine, night, storm, stone lantern", compositionLock: "centered",
    ...overrides
  };
}

type Captured = { requests: Array<{ messages: Array<{ content: string }> }>; logs: string[] };
function spindleWith(payload: unknown, captured?: Captured): SpindleAPI {
  return {
    generate: { raw: async (request: Captured["requests"][number]) => {
      captured?.requests.push(request);
      return { choices: [{ message: { content: JSON.stringify(payload) } }] };
    } },
    log: {
      warn() {}, error() {}, debug() {},
      info: (line: string) => { captured?.logs.push(line); }
    }
  } as unknown as SpindleAPI;
}
const idle = { paragraphIndex: 0, expression: "idle", character: "Mira" };
function payload(overrides: Record<string, unknown> = {}) {
  return {
    scenes: [baseScene()], cues: [idle], choices: [],
    characters: [{ name: "Mira", description: "silver hair, green eyes, red coat" }],
    ...overrides
  };
}
async function plan(raw: unknown, config: Partial<VisualNovelConfig> = {}, previousScene: SceneState | null = null, captured?: Captured) {
  const result = await planTurn(spindleWith(raw, captured), {
    chatId: "chat-1", message, content: content8, previousScene,
    previousContinuity: null, recentMessages: [],
    config: { ...DEFAULT_CONFIG, parserConnectionId: "parser", ...config },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: { Mira: "silver hair, green eyes, red coat" }
  });
  expect(result.usedFallback).toBe(false);
  return result;
}
function recordFor(result: Awaited<ReturnType<typeof plan>>): StoredTurnRecord {
  return { schemaVersion: 1, speaker: "Mira", userSpeaker: "You", status: "ready", plan: result.plan, jobs: [], updatedAt: "2026-01-01T00:00:00.000Z" };
}
const richCues = [
  idle,
  { paragraphIndex: 1, expression: "surprise", character: "Mira" },
  { paragraphIndex: 2, expression: "smile", character: "Mira" },
  { paragraphIndex: 3, expression: "shocked", character: "Mira", effect: "shake_hard" },
  { paragraphIndex: 4, expression: "scared", character: "Mira", effect: "heartbeat" },
  { paragraphIndex: 5, expression: "shocked", character: "Mira", effect: "flash_white" },
  { paragraphIndex: 7, expression: "worried", character: "Mira", effect: "fade_to_black", sfx: "wind" }
];
const expectedEffects: Array<{ paragraphIndex: number; effect: StageEffect }> = [
  { paragraphIndex: 3, effect: "shake_hard" },
  { paragraphIndex: 4, effect: "heartbeat" },
  { paragraphIndex: 5, effect: "flash_white" },
  { paragraphIndex: 7, effect: "fade_to_black" }
];

describe("planner effects integration", () => {
  for (const cap of [2, 4, 0]) {
    test(`all seven cues' effects survive image cap ${cap}`, async () => {
      const result = await plan(payload({ cues: richCues }), { maxImagesPerTurn: cap });
      expect(result.plan.visualCues).toHaveLength(cap || 7);
      expect(result.plan.effectCues).toEqual(expectedEffects);
      expect(turnView(recordFor(result)).effects).toEqual([
        null, null, null, "shake_hard", "heartbeat", "flash_white", null, "fade_to_black"
      ]);
      expect(result.plan.audioCues.map(cue => cue.paragraphIndex)).toEqual([7]);
    });
  }

  test("a separate late-paragraph effect does not allocate an image cue", async () => {
    const baseline = await plan(payload(), { maxImagesPerTurn: 2 });
    const result = await plan(payload({ effects: [{ paragraphIndex: 7, effect: "flash_white" }] }), { maxImagesPerTurn: 2 });
    expect(result.plan.visualCues.map(cue => cue.paragraphIndex)).toEqual(baseline.plan.visualCues.map(cue => cue.paragraphIndex));
    expect(result.plan.visualCues.some(cue => cue.paragraphIndex === 7)).toBe(false);
    expect(result.plan.effectCues).toEqual([{ paragraphIndex: 7, effect: "flash_white" }]);
    expect(turnView(recordFor(result)).effects).toEqual([null, null, null, null, null, null, null, "flash_white"]);
  });

  test("malformed null entries in the separate effects list are ignored", async () => {
    const result = await plan(payload({
      effects: [null, { paragraphIndex: 7, effect: "flash_white" }]
    }));
    expect(result.plan.effectCues).toEqual([{ paragraphIndex: 7, effect: "flash_white" }]);
    expect(turnView(recordFor(result)).effects).toEqual([null, null, null, null, null, null, null, "flash_white"]);
  });

  const aliases: Array<[string, Record<string, unknown>, Record<string, unknown>, StageEffect | null, AmbientEffect]> = [
    ["cue stageEffect synonym", { ambient: "rain" }, { stageEffect: "hard shake" }, "shake_hard", "rain"],
    ["wrapped screen effect and ambient alias", { ambientEffect: "mist" }, { screenEffect: { type: "white flash" } }, "flash_white", "fog"],
    ["array fx and ambient synonym", { atmosphere: "snowfall" }, { fx: ["blackout"] }, "fade_to_black", "snow"],
    ["ambient value in effect slot", { ambient: "rain" }, { effect: "downpour" }, null, "heavy_rain"],
    ["stage value in scene ambient slot", { ambient: "lightning strike" }, {}, "lightning", "heavy_rain"],
    ["stage value in cue ambient slot", { ambient: "rain" }, { ambient: "sparkles" }, "sparkle_burst", "rain"]
  ];
  for (const [name, sceneExtra, cueExtra, effect, ambient] of aliases) {
    test(name, async () => {
      const result = await plan(payload({ scenes: [baseScene(sceneExtra)], cues: [{ ...idle, ...cueExtra }] }));
      expect(result.plan.effectCues).toEqual(effect ? [{ paragraphIndex: 0, effect }] : []);
      expect(result.plan.scenes[0]?.ambient).toBe(ambient);
      expect(turnView(recordFor(result)).ambients).toEqual(new Array(8).fill(ambient));
    });
  }

  for (const explicitClear of [false, true]) {
    test(`continuing turn ${explicitClear ? "clears explicit null" : "inherits omitted ambient"}`, async () => {
      // Use a mood overlay so weather inference cannot accidentally pass inheritance.
      const first = await plan(payload({ scenes: [baseScene({ ambient: "dream_haze" })] }));
      const previous = first.plan.scenes[0]!;
      const continuing = baseScene({
        boundary: { claimedNewScene: false, reason: "none", location: "Mountain shrine", timeOfDay: "night", majorTimeJump: false, environmentReplacement: false, forced: false },
        ...(explicitClear ? { ambient: null } : {})
      });
      const second = await plan(payload({ scenes: [continuing] }), {}, previous);
      expect(second.plan.scenes[0]?.sceneId).toBe(previous.sceneId);
      expect(second.plan.scenes[0]?.ambient).toBe(explicitClear ? null : "dream_haze");
      const view = turnView(recordFor(second));
      if (explicitClear) expect(view.ambients?.some(Boolean) ?? false).toBe(false);
      else expect(view.ambients).toEqual(new Array(8).fill("dream_haze"));
    });
  }

  for (const [weather, ambient] of [["rain", "rain"], ["heavy rain", "heavy_rain"], ["snow", "snow"], ["fog", "fog"]] as const) {
    test(`omitted ambient derives ${ambient} from weather`, async () => {
      const scene = baseScene({ environment: { ...baseScene().environment, weather } });
      const result = await plan(payload({ scenes: [scene] }));
      expect(result.plan.scenes[0]?.ambient).toBe(ambient);
      expect(turnView(recordFor(result)).ambients).toEqual(new Array(8).fill(ambient));
    });
  }

  test("prompt gives positive examples, an independent effects list, and current ambient", async () => {
    const first = await plan(payload({ scenes: [baseScene({ ambient: "dream_haze" })] }));
    const captured: Captured = { requests: [], logs: [] };
    await plan(payload(), { maxImagesPerTurn: 2 }, first.plan.scenes[0]!, captured);
    const system = captured.requests[0]!.messages[0]!.content;
    const user = captured.requests[0]!.messages[1]!.content;
    expect(system).toContain(StageEffectSchema.options.join(", "));
    expect(system).toContain(AmbientEffectSchema.options.join(", "));
    expect(system).toMatch(/effects.*separate|separate.*effects/i);
    expect(system).toMatch(/effects do not count toward the image cue limit/i);
    expect(system).toContain("shake_hard");
    expect(system).toContain("Impact/explosion -> shake_hard");
    expect(system).not.toContain("Most paragraphs must have no effect");
    expect(system).toMatch(/omit to keep it; set null only to clear it/i);
    expect(user).toContain("PREVIOUS SCENE");
    expect(user).toMatch(/"ambient"\s*:\s*"dream_haze"/);
  });

  for (const debugLogging of [false, true]) {
    test(`dropped-value diagnostics are ${debugLogging ? "enabled" : "gated"}`, async () => {
      const captured: Captured = { requests: [], logs: [] };
      const result = await plan(payload({
        scenes: [baseScene({ ambient: "unsupported_overlay" })],
        cues: [{ ...idle, effect: "unsupported_burst" }]
      }), { debugLogging }, null, captured);
      expect(result.plan.effectCues).toEqual([]);
      const dropped = captured.logs.filter(line => /dropped (effect|ambient)/.test(line));
      if (debugLogging) {
        expect(dropped.some(line => line.includes("unsupported_burst"))).toBe(true);
        expect(dropped.some(line => line.includes("unsupported_overlay"))).toBe(true);
      } else expect(dropped).toEqual([]);
    });
  }
});
