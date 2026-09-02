import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessageDTO, SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../config";
import { ContinuityStateSchema, SceneStateSchema } from "../../shared/contracts";
import { emptySingleCharacter } from "../core/visual-state";
import { planTurn } from "./planner";

const message: ChatMessageDTO & { role: "assistant" } = {
  id: "assistant-1",
  chat_id: "chat-1",
  index_in_chat: 2,
  is_user: false,
  name: "Mira",
  content: "First paragraph.\n\nSecond paragraph.",
  send_date: 1,
  swipe_id: 0,
  swipes: ["First paragraph.\n\nSecond paragraph."],
  swipe_dates: [1],
  extra: {},
  parent_message_id: "user-1",
  branch_id: null,
  created_at: 1,
  role: "assistant"
};

function fallbackSpindle(): SpindleAPI {
  return {
    generate: { raw: async () => { throw new Error("planner unavailable"); } },
    log: { warn() {} }
  } as unknown as SpindleAPI;
}

test("planner fallback still creates a valid revealable turn and authored choices", async () => {
  const content = `First paragraph.\n\nSecond paragraph.\n\n<Choice value="We stay.">Stay here</Choice>`;
  const result = await planTurn(fallbackSpindle(), {
    chatId: "chat-1",
    message: { ...message, content },
    content,
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, mode: "cyoa" },
    singleCharacter: emptySingleCharacter()
  });
  assert.equal(result.usedFallback, true);
  assert.deepEqual(result.plan.paragraphs.map((paragraph) => paragraph.text), ["First paragraph.", "Second paragraph."]);
  assert.equal(result.plan.choices[0]?.submission, "We stay.");
  assert.equal(result.plan.scenes[0]?.startParagraph, 0);
  assert.equal(result.plan.visualCues[0]?.paragraphIndex, 0);
});

test("fallback planning reuses the active scene prompt and camera identity", async () => {
  const continuity = ContinuityStateSchema.parse({ revision: 2, characters: {}, facts: {} });
  const previousScene = SceneStateSchema.parse({
    sceneId: "scene-existing",
    revision: 4,
    startParagraph: 0,
    environment: {
      location: "Hill overlook",
      timeOfDay: "sunset",
      weather: "clear",
      lighting: "warm",
      description: "A grassy overlook above the valley.",
      persistentElements: ["old oak tree"]
    },
    cast: ["Mira"],
    continuity,
    basePrompt: "grassy hill overlook, old oak tree, sunset",
    cameraLock: {
      framing: "medium-wide",
      angle: "eye level",
      perspective: "third person",
      lens: "50mm",
      subjectAnchor: "center",
      horizon: "upper middle third",
      safeDialogueRegion: "lower quarter",
      aspectRatio: "16:9"
    },
    compositionLock: "Mira centered",
    activeAssetId: "image-previous",
    priorSceneId: null
  });
  const result = await planTurn(fallbackSpindle(), {
    chatId: "chat-1",
    message,
    content: message.content,
    previousScene,
    previousContinuity: continuity,
    recentMessages: [],
    config: DEFAULT_CONFIG,
    singleCharacter: emptySingleCharacter()
  });
  assert.equal(result.plan.scenes[0]?.sceneId, previousScene.sceneId);
  assert.equal(result.plan.scenes[0]?.revision, previousScene.revision);
  assert.equal(result.plan.scenes[0]?.basePrompt, previousScene.basePrompt);
  assert.equal(result.plan.scenes[0]?.activeAssetId, previousScene.activeAssetId);
});


function dedupeSpindle(cues: number[]): SpindleAPI {
  return {
    generate: {
      raw: async () => ({
        content: JSON.stringify({
          scenes: [{
            startParagraph: 0,
            boundary: {
              claimedNewScene: true,
              reason: "initial",
              location: "Observatory",
              timeOfDay: "night",
              majorTimeJump: false,
              environmentReplacement: false,
              forced: false
            },
            environment: {
              location: "Observatory",
              timeOfDay: "night",
              weather: null,
              lighting: "lantern light",
              description: "An old observatory",
              persistentElements: ["brass telescope"]
            },
            cast: ["Mira"],
            basePrompt: "old observatory, brass telescope",
            compositionLock: "Mira centered"
          }],
          cues: cues.map((paragraphIndex) => ({ paragraphIndex })),
          choices: [],
          characters: [{ name: "Mira", description: "silver hair, green eyes" }]
        })
      })
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;
}

test("dedupes same-paragraph cues before the maxImagesPerTurn slice", async () => {
  const content = "First paragraph.\n\nSecond paragraph.";
  const result = await planTurn(dedupeSpindle([0, 0, 1]), {
    chatId: "chat-1",
    message: { ...message, content },
    content,
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: {
      ...DEFAULT_CONFIG,
      includeCharacterContext: false,
      includePersonaContext: false,
      includeLorebookContext: false,
      maxImagesPerTurn: 4
    },
    singleCharacter: emptySingleCharacter()
  });

  const indexes = result.plan.visualCues.map((cue) => cue.paragraphIndex);
  assert.deepEqual(indexes, [0, 1]);
  // Exactly one cue/job for paragraph 0: no leaked, permanently-queued second job.
  assert.equal(result.plan.visualCues.filter((cue) => cue.paragraphIndex === 0).length, 1);
  assert.equal(result.plan.visualCues[0]?.cueId, result.plan.visualCues[0]?.cueId);
  assert.notEqual(result.plan.visualCues[0]?.assetJobId, result.plan.visualCues[1]?.assetJobId);
});
