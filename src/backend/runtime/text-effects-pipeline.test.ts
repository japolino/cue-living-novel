import { describe, expect, test } from "bun:test";
import { planTurn } from "./planner.js";
import { turnView } from "./controller.js";
import { cleanResolvedText } from "./message-text.js";
import { compileImagePrompt } from "./images.js";
import { emptySingleCharacter } from "../core/visual-state.js";
import { DEFAULT_CONFIG } from "../../config.js";

/**
 * Inline text effects end to end on the backend: the tags are display markup.
 * They must reach the TurnView paragraphs untouched (the stage renders them)
 * and must not reach planner prompts or image prompts.
 */

const content = [
  'Mira grips the rail. "<shake>Get down!</shake>"',
  "<rainbow><wave>La la la~</wave></rainbow> she sings, <whisper>softly</whisper>.",
  "<thinking>secret plan</thinking>The <GLOW>seal</GLOW> breaks.",
].join("\n\n");
const message: any = { id: "m-fx", chat_id: "chat", index_in_chat: 2, is_user: false, name: "Mira", content, send_date: 1, swipe_id: 0, swipes: [content], extra: {}, role: "assistant" };
const config = { ...DEFAULT_CONFIG, includeCharacterContext: false, includePersonaContext: false, includeLorebookContext: false, ignoredTags: "thinking" };
const scene = { startParagraph: 0, boundary: { claimedNewScene: true, reason: "initial", location: "Deck" }, environment: { location: "Deck", timeOfDay: "night", weather: null, lighting: "lantern", description: "A ship deck.", persistentElements: [] }, cast: ["Mira"], basePrompt: "ship deck", compositionLock: "centered" };
const frozen = { ...emptySingleCharacter(), protagonist: { name: "Mira", tags: ["silver hair", "red coat"] } };

async function run(fail = false) {
  const prompts: string[] = [];
  const spindle: any = {
    generate: {
      raw: async (request: { messages: Array<{ content: string }> }) => {
        prompts.push(request.messages.map((m) => m.content).join("\n"));
        if (fail) throw new Error("planner unavailable");
        return { text: JSON.stringify({ scenes: [scene], cues: [{ paragraphIndex: 0, character: "Mira", expression: "shocked" }], characters: [] }) };
      },
    },
    log: { warn() {} },
  };
  const result = await planTurn(spindle, {
    chatId: "chat",
    message,
    content: cleanResolvedText(content),
    previousScene: null,
    previousContinuity: null,
    recentMessages: [{ ...message, id: "m-prev", content: "<tremble>Earlier</tremble> line." }],
    config,
    singleCharacter: frozen,
    characterAppearance: {},
  });
  return { result, prompts };
}

describe("text effect tags through the backend pipeline", () => {
  test("reach the TurnView paragraphs unchanged; ignored tags still drop", async () => {
    const { result } = await run();
    const view = turnView({ schemaVersion: 1, speaker: "Mira", status: "ready", plan: result.plan, jobs: [], updatedAt: new Date().toISOString() });
    expect(view.paragraphs).toEqual([
      'Mira grips the rail. "<shake>Get down!</shake>"',
      "<rainbow><wave>La la la~</wave></rainbow> she sings, <whisper>softly</whisper>.",
      "The <GLOW>seal</GLOW> breaks.",
    ]);
  });

  test("never reach the planner prompt", async () => {
    const { prompts } = await run();
    expect(prompts.length).toBeGreaterThan(0);
    for (const prompt of prompts) {
      expect(prompt).toContain("Get down!");
      expect(prompt).toContain("La la la~");
      expect(prompt).not.toMatch(/<\/?(?:shake|rainbow|wave|whisper|glow|tremble)>/i);
    }
  });

  test("never reach the image prompt, also on the fallback planner", async () => {
    for (const fail of [false, true]) {
      const { result } = await run(fail);
      for (const cue of result.plan.visualCues) {
        const scene = result.plan.scenes.find((candidate) => candidate.sceneId === cue.sceneId)!;
        const prompt = compileImagePrompt(config, scene, cue);
        expect(prompt).not.toMatch(/<\/?(?:shake|rainbow|wave|whisper|glow)>/i);
        expect(cue.promptDelta).not.toMatch(/<\/?(?:shake|rainbow|wave|whisper|glow)>/i);
      }
    }
  });
});
