import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../config.js";
import { SceneStateSchema } from "../../shared/contracts.js";
import { seedSingleCharacter } from "../core/visual-state.js";
import { fingerprintForMessage, planTurn } from "./planner.js";

/**
 * Debug-gated planner tracing. Everything asserted here must be invisible when
 * `debugLogging` is off and must never change the plan itself.
 */

const IDENTITY = "girl, auburn hair, Kitsune species, fox ears anatomy";
const content = "She leans closer on the couch.\n\nThe television flickers.";
const message: any = {
  id: "msg-debug", chat_id: "chat-debug", index_in_chat: 4, is_user: false, name: "Kitsune", content,
  send_date: 1, swipe_id: 3, swipes: [content], swipe_dates: [1], extra: {}, parent_message_id: "u", branch_id: null, created_at: 1, role: "assistant"
};
const baseConfig = { ...DEFAULT_CONFIG, includeCharacterContext: false, includePersonaContext: false, includeLorebookContext: false };
const previousScene = SceneStateSchema.parse({
  sceneId: "scene-prev", revision: 1, startParagraph: 0,
  environment: { location: "Living room", timeOfDay: "night", weather: null, lighting: "dim warm indoor lighting", description: "A cozy living room", persistentElements: ["couch"] },
  cast: ["Kitsune"], character: "Kitsune", attire: "cream sweater", ambient: null,
  continuity: { revision: 0, characters: {}, facts: {} }, basePrompt: "living room", identityPrompt: IDENTITY,
  cameraLock: { framing: "upper body", angle: "eye level", perspective: "straight-on", lens: null, subjectAnchor: "center", horizon: "upper middle third", safeDialogueRegion: "lower quarter", aspectRatio: "16:9" },
  compositionLock: "centered", activeAssetId: null, priorSceneId: null
});
const plannerPayload = {
  scenes: [{
    startParagraph: 0,
    boundary: { claimedNewScene: false, reason: "none", location: "Living room" },
    environment: { location: "Living room", timeOfDay: "night", weather: null, lighting: null, description: "", persistentElements: [] },
    cast: ["Kitsune"], character: "Kitsune", basePrompt: "living room, couch", compositionLock: "centered"
  }],
  cues: [{ paragraphIndex: 0, expression: "smile", character: "Kitsune" }, { paragraphIndex: 1, expression: "surprise", character: "Kitsune", attire: "red swimsuit" }],
  characters: [], speakers: [{ paragraphIndex: 0, name: "Kitsune" }], choices: []
};

function harness(responses: Array<unknown | (() => never)>) {
  const info: string[] = [];
  const warn: string[] = [];
  let calls = 0;
  const spindle = {
    chats: { get: async () => ({ character_id: null }) },
    characters: { get: async () => null },
    personas: { getActive: async () => null },
    connections: { get: async () => null },
    generate: {
      raw: async () => {
        const next = responses[Math.min(calls, responses.length - 1)];
        calls += 1;
        if (typeof next === "function") return (next as () => never)();
        return next;
      }
    },
    log: { info: (line: string) => { info.push(line); }, warn: (line: string) => { warn.push(line); }, error() {} }
  } as unknown as SpindleAPI;
  return { spindle, info, warn, calls: () => calls };
}

async function run(spindle: SpindleAPI, debugLogging: boolean) {
  return planTurn(spindle, {
    chatId: "chat-debug", message, content, previousScene, previousContinuity: null, recentMessages: [],
    config: { ...baseConfig, debugLogging }, singleCharacter: seedSingleCharacter("Kitsune", IDENTITY), characterAppearance: { Kitsune: IDENTITY }
  });
}

const prefix = `[VN] planner chat=chat-debug msg=msg-debug swipe=3 fp=${fingerprintForMessage(message)}`;
const plannerLines = (lines: string[]) => lines.filter((line) => line.startsWith("[VN] planner"));

describe("planner debug trace", () => {
  test("emits nothing from the planner when debugLogging is off", async () => {
    const { spindle, info } = harness([{ content: JSON.stringify(plannerPayload) }]);
    const result = await run(spindle, false);
    expect(result.usedFallback).toBe(false);
    expect(plannerLines(info)).toEqual([]);
  });

  test("logs the raw response, parse status, outcome, and resolved state with correlation ids", async () => {
    const raw = `\`\`\`json\n${JSON.stringify(plannerPayload)}\n\`\`\``;
    const { spindle, info } = harness([{ content: raw, finish_reason: "stop" }]);
    const result = await run(spindle, true);
    expect(result.usedFallback).toBe(false);
    const lines = plannerLines(info);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toStartWith(prefix);

    expect(lines.find((line) => line.includes(" response "))).toContain("finish_reason=stop reasoning=no content=string chars=" + raw.length);
    expect(lines.find((line) => line.includes("raw response chars="))).toContain("parts=1");
    const rawLine = lines.find((line) => line.includes("raw response [1/1]"))!;
    expect(rawLine.slice(rawLine.indexOf("\n") + 1)).toBe(raw);
    expect(lines.find((line) => line.includes("parse ok"))).toContain("extract=json-fence strategy=direct");
    expect(lines.find((line) => line.includes("outcome="))).toContain("outcome=planner accepted attempt=1/2 scenes=1 cues=2");

    const status = lines.find((line) => line.includes("resolved status="))!;
    expect(status).toContain(`status=${result.plan.planningStatus} fallback=no previousScene=scene-prev rev1 "Living room"`);
    expect(status).toContain('attire="cream sweater"');
    expect(lines.find((line) => line.includes("resolved protagonist="))).toContain('protagonist="Kitsune"');
    const sceneLine = lines.find((line) => line.includes("resolved scene "))!;
    expect(sceneLine).toContain(`resolved scene ${result.plan.scenes[0]!.sceneId}`);
    expect(sceneLine).toContain('character="Kitsune"');
    const envLine = lines.find((line) => line.includes("resolved environment "))!;
    expect(envLine).toContain('location="Living room"');
    expect(envLine).toContain('timeOfDay="night"');
    expect(envLine).toContain(`lighting=${JSON.stringify(result.plan.scenes[0]!.environment.lighting)}`);
    const cueLines = lines.filter((line) => line.includes("resolved cue p"));
    expect(cueLines).toHaveLength(2);
    expect(cueLines[0]).toContain(`pose=${result.plan.visualCues[0]!.poseExpressionId}`);
    expect(cueLines[0]).toContain(`identity=${JSON.stringify(result.plan.visualCues[0]!.resolvedIdentity)}`);
    expect(cueLines[0]).toContain('attire="cream sweater"');
    expect(cueLines[1]).toContain('attire="red swimsuit"');
    expect(lines.some((line) => line.includes("resolved continuity delta p1") && line.includes("red swimsuit"))).toBe(true);
  });

  test("reports rejected subject-category drift on the protagonist line", async () => {
    const payload = { ...plannerPayload, characters: [{ name: "Kitsune", description: IDENTITY, subjectCategory: "male" }] };
    const { spindle, info } = harness([{ content: JSON.stringify(payload) }]);
    await planTurn(spindle, {
      chatId: "chat-debug", message, content, previousScene, previousContinuity: null, recentMessages: [], config: { ...baseConfig, debugLogging: true },
      singleCharacter: seedSingleCharacter("Kitsune", IDENTITY), characterAppearance: { Kitsune: IDENTITY },
      characterRegistry: { kitsune: { id: "kitsune", name: "Kitsune", aliases: [], tags: IDENTITY, subjectCategory: "female" } }
    });
    const line = plannerLines(info).find((entry) => entry.includes("resolved protagonist="))!;
    expect(line).toContain('rejectedSubjects="Kitsune" requested=male kept=female');
  });

  test("reports the repair strategy when the response needed JSON repair", async () => {
    const malformed = JSON.stringify(plannerPayload).replace(/\]\}$/, "],}");
    const { spindle, info } = harness([{ content: malformed }]);
    const result = await run(spindle, true);
    expect(result.usedFallback).toBe(false);
    expect(plannerLines(info).find((line) => line.includes("parse ok"))).toContain("strategy=trailing-commas repaired=yes");
  });

  test("traces each failed attempt and the deterministic fallback outcome", async () => {
    const { spindle, info, warn } = harness([{ content: "" , finish_reason: "length" }, { content: "not json at all" }]);
    const result = await run(spindle, true);
    expect(result.usedFallback).toBe(true);
    const lines = plannerLines(info);
    expect(lines.find((line) => line.includes(" response ") && line.includes("finish_reason=length"))).toBeDefined();
    expect(lines.filter((line) => /attempt [12]\/2 failed:/.test(line))).toHaveLength(2);
    expect(lines.find((line) => line.includes("parse failed:"))).toContain("did not return a JSON object");
    expect(lines.find((line) => line.includes("outcome="))).toContain("outcome=fallback attempts=2/2");
    expect(lines.find((line) => line.includes("resolved status="))).toContain("fallback=yes");
    // The pre-existing warn lines are unchanged.
    expect(warn.filter((line) => line.startsWith("Visual planner attempt"))).toHaveLength(2);
    expect(warn.some((line) => line.startsWith("Visual planner fallback after 2 attempts"))).toBe(true);
  });

  test("logs a missing text body with response keys only, never the whole response", async () => {
    const { spindle, info } = harness([{ finish_reason: "stop", usage: { secret_token: "sk-abcdefghijklmnop1234" } }, { content: JSON.stringify(plannerPayload) }]);
    const result = await run(spindle, true);
    expect(result.usedFallback).toBe(false);
    const lines = plannerLines(info);
    const missing = lines.find((line) => line.includes("content=missing"))!;
    expect(missing).toContain("responseKeys=finish_reason,usage");
    expect(lines.join("\n")).not.toContain("sk-abcdefghijklmnop1234");
    expect(lines.filter((line) => line.includes("raw response chars="))).toHaveLength(1);
  });

  test("redacts inline image payloads and credential-shaped strings from the raw response", async () => {
    const payload = { ...plannerPayload, scenes: [{ ...plannerPayload.scenes[0], basePrompt: `living room data:image/png;base64,${"Qz7".repeat(300)} api_key="sk-zzzzzzzzzzzzzzzzzzzz"` }] };
    const { spindle, info } = harness([{ content: JSON.stringify(payload) }]);
    await run(spindle, true);
    const text = plannerLines(info).join("\n");
    expect(text).not.toContain("Qz7".repeat(300));
    expect(text).not.toContain("sk-zzzzzzzzzzzzzzzzzzzz");
    expect(text).toContain("[data-url redacted]");
  });

  test("debug tracing does not change the produced plan", async () => {
    const quiet = harness([{ content: JSON.stringify(plannerPayload) }]);
    const loud = harness([{ content: JSON.stringify(plannerPayload) }]);
    const a = await run(quiet.spindle, false);
    const b = await run(loud.spindle, true);
    const strip = (plan: unknown) => JSON.stringify(plan, (key, value) => key === "createdAt" ? undefined : value);
    expect(strip(b.plan)).toBe(strip(a.plan));
    expect(quiet.calls()).toBe(1);
    expect(loud.calls()).toBe(1);
  });
});
