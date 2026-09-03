import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessageDTO, SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../config";
import { ContinuityStateSchema, SceneStateSchema } from "../../shared/contracts";
import { emptySingleCharacter } from "../core/visual-state";
import { parseIgnoredTags, planTurn } from "./planner";

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
    singleCharacter: emptySingleCharacter(),
    characterAppearance: {}
  });
  assert.equal(result.usedFallback, true);
  assert.deepEqual(result.plan.paragraphs.map((paragraph) => paragraph.text), ["First paragraph.", "Second paragraph."]);
  assert.equal(result.plan.choices[0]?.submission, "We stay.");
  assert.equal(result.plan.scenes[0]?.startParagraph, 0);
  assert.equal(result.plan.visualCues[0]?.paragraphIndex, 0);
  assert.deepEqual(result.plan.scenes[0]?.cameraLock, {
    framing: "upper body",
    angle: "eye level",
    perspective: "straight-on",
    lens: null,
    subjectAnchor: "primary speaking character centered",
    horizon: "stable horizon at the upper middle third",
    safeDialogueRegion: "lower quarter free of faces and important objects",
    aspectRatio: "16:9"
  });
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
    singleCharacter: emptySingleCharacter(),
    characterAppearance: {}
  });
  assert.equal(result.plan.scenes[0]?.sceneId, previousScene.sceneId);
  assert.equal(result.plan.scenes[0]?.revision, previousScene.revision);
  assert.equal(result.plan.scenes[0]?.basePrompt, previousScene.basePrompt);
  assert.equal(result.plan.scenes[0]?.activeAssetId, previousScene.activeAssetId);
});


function dedupeSpindle(cues: number[], captured?: { system: string }): SpindleAPI {
  return {
    generate: {
      raw: async (request: any) => {
        if (captured) captured.system = request.messages?.[0]?.content ?? "";
        return {
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
        };
      }
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;
}

test("dedupes same-paragraph cues before the maxImagesPerTurn slice", async () => {
  const content = "First paragraph.\n\nSecond paragraph.";
  const captured = { system: "" };
  const result = await planTurn(dedupeSpindle([0, 0, 1], captured), {
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
    singleCharacter: emptySingleCharacter(),
    characterAppearance: {}
  });

  const indexes = result.plan.visualCues.map((cue) => cue.paragraphIndex);
  assert.deepEqual(indexes, [0, 1]);
  // Exactly one cue/job for paragraph 0: no leaked, permanently-queued second job.
  assert.equal(result.plan.visualCues.filter((cue) => cue.paragraphIndex === 0).length, 1);
  assert.equal(result.plan.visualCues[0]?.cueId, result.plan.visualCues[0]?.cueId);
  assert.notEqual(result.plan.visualCues[0]?.assetJobId, result.plan.visualCues[1]?.assetJobId);
  assert.match(captured.system, /concise comma-separated Danbooru-style scene tags/);
  assert.match(captured.system, /no camera or composition prose, character names, or character description/);
});

test("maxImagesPerTurn=0 means unlimited: retains all distinct cues", async () => {
  const content = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
  const result = await planTurn(dedupeSpindle([0, 1, 2, 0]), {
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
      maxImagesPerTurn: 0
    },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: {}
  });

  // Unlimited: the duplicate paragraph-0 index is still deduped first, then no slice truncates.
  assert.deepEqual(result.plan.visualCues.map((cue) => cue.paragraphIndex), [0, 1, 2]);
});

test("maxImagesPerTurn=0 still creates a fallback cue when the sidecar fails", async () => {
  const content = "First paragraph.\n\nSecond paragraph.";
  const result = await planTurn(fallbackSpindle(), {
    chatId: "chat-1",
    message: { ...message, content },
    content,
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0 },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: {}
  });
  assert.equal(result.usedFallback, true);
  // Unlimited fallback still emits the cue for paragraph 0.
  assert.equal(result.plan.visualCues[0]?.paragraphIndex, 0);
});
test("parseIgnoredTags parses comma and newline separated tag names", () => {
  const result = parseIgnoredTags("status, <stats>, [system]\n inventory");
  assert.deepEqual(result, ["status", "stats", "[system]", "inventory"]);
});

test("planner includes audio catalog in prompt instructions and preserves returned audio cues", async () => {
  const { clearAudioCatalogCache, scanAudioCatalog } = await import("./audio-catalog");
  const files: Record<string, Uint8Array> = {
    "audio/bgm/romantic_theme.mp3": new TextEncoder().encode("dummy"),
    "audio/sfx/sword_slash.wav": new TextEncoder().encode("dummy"),
  };

  const captured = { system: "" };
  const spindleWithAudio: SpindleAPI = {
    storage: {
      list: async () => ["bgm/romantic_theme.mp3", "sfx/sword_slash.wav"],
      readBinary: async (path: string) => files[path] ?? new Uint8Array(),
    },
    generate: {
      raw: async (request: any) => {
        captured.system = request.messages?.[0]?.content ?? "";
        return {
          content: JSON.stringify({
            scenes: [{
              startParagraph: 0,
              boundary: {
                claimedNewScene: true,
                reason: "initial",
                location: "Garden",
                timeOfDay: "afternoon",
                majorTimeJump: false,
                environmentReplacement: false,
                forced: false
              },
              environment: {
                location: "Garden",
                timeOfDay: "afternoon",
                weather: null,
                lighting: "sunlight",
                description: "A flower garden",
                persistentElements: []
              },
              cast: ["Mira"],
              basePrompt: "flower garden, sunlight",
              compositionLock: "Mira centered"
            }],
            cues: [
              { paragraphIndex: 0, expression: "smile", bgm: "romantic_theme", sfx: null },
              { paragraphIndex: 1, expression: "surprise", sfx: "sword_slash" }
            ],
            choices: [],
            characters: [{ name: "Mira", description: "silver hair, green eyes" }]
          })
        };
      }
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;

  await scanAudioCatalog(spindleWithAudio, "audio");

  try {
    const content = "First line in the garden.\n\nA sudden sound.";
    const result = await planTurn(spindleWithAudio, {
      chatId: "chat-1",
      message: { ...message, content },
      content,
      previousScene: null,
      previousContinuity: null,
      recentMessages: [],
      config: DEFAULT_CONFIG,
      singleCharacter: emptySingleCharacter(),
      characterAppearance: {}
    });

    // Check system prompt instruction contains audio section
    assert.match(captured.system, /Audio & Atmosphere/);
    assert.match(captured.system, /romantic_theme/);
    assert.match(captured.system, /sword_slash/);

    // Check plan visual cues preserve bgm & sfx
    assert.equal(result.plan.visualCues[0]?.bgm, "romantic_theme");
    assert.equal(result.plan.visualCues[1]?.sfx, "sword_slash");
  } finally {
    clearAudioCatalogCache();
  }
});


test("planner supports multi-character cast resolution and attire overrides", async () => {
  const spindle: SpindleAPI = {
    generate: {
      raw: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                scenes: [
                  {
                    startParagraph: 0,
                    boundary: { claimedNewScene: false, reason: "none", location: "Garden", timeOfDay: "day", majorTimeJump: false, environmentReplacement: false, forced: false },
                    environment: { location: "Garden", timeOfDay: "day", weather: "sunny", lighting: "sunlight", description: "A garden", persistentElements: [] },
                    cast: ["Lyra"],
                    character: "Lyra",
                    attire: "white sundress, straw hat",
                    basePrompt: "blooming garden, sunny day",
                    compositionLock: "centered"
                  }
                ],
                cues: [
                  { paragraphIndex: 0, expression: "smile", character: "Lyra", attire: "white sundress, straw hat" }
                ],
                choices: [],
                characters: [
                  { name: "Lyra", description: "elf girl, pointy elf ears, emerald eyes, silver hair, white sundress" }
                ]
              })
            }
          }
        ]
      })
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;

  const result = await planTurn(spindle, {
    chatId: "chat",
    message: { ...message, name: "Lyra", content: "Lyra smiles in the garden." },
    content: "Lyra smiles in the garden.",
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, parserConnectionId: "parser" },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: {
      "Lyra": "elf girl, pointy elf ears, silver hair, emerald eyes, green tunic, leather boots",
      "Hina": "golden blonde hair, red eyes, sailor uniform"
    }
  });

  assert.equal(result.plan.scenes[0]?.character, "Lyra");
  assert.equal(result.plan.scenes[0]?.attire, "white sundress, straw hat");
  assert.equal(result.plan.scenes[0]?.identityPrompt, "elf girl, pointy elf ears, silver hair, emerald eyes, green tunic, leather boots");
  assert.equal(result.plan.visualCues[0]?.character, "Lyra");
  assert.equal(result.plan.visualCues[0]?.attire, "white sundress, straw hat");
});


test("planTurn resolves {{user}}/{{char}} display macros in narrative paragraphs", async () => {
  const spindle: SpindleAPI = {
    generate: {
      raw: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              scenes: [{
                startParagraph: 0,
                boundary: { claimedNewScene: true, reason: "initial", location: "Street", timeOfDay: "evening", majorTimeJump: false, environmentReplacement: false, forced: false },
                environment: { location: "Street", timeOfDay: "evening", weather: "windy", lighting: "dusk", description: "A street at dusk", persistentElements: [] },
                cast: ["Hina"],
                basePrompt: "street, dusk",
                compositionLock: "Hina centered"
              }]
            }),
            cues: [{ paragraphIndex: 0, expression: "smile" }],
            choices: [],
            characters: [{ name: "Hina", description: "silver hair, green eyes" }]
          }
        }]
      })
    },
    personas: {
      getActive: async () => ({ name: "Jay", id: "p", title: "", description: "", image_id: null, attached_world_book_id: null, folder: "", is_default: false, metadata: {}, created_at: 0, updated_at: 0 }),
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;

  const result = await planTurn(spindle, {
    chatId: "chat-1",
    message: { ...message, name: "Hina", content: "Hi {{user}}." },
    content: "{{char}} looks at {{user}}. 'Hello, {{user}}.'",
    previousScene: null,
    previousContinuity: null,
    recentMessages: [{ name: "User", content: "", is_user: true }],
    config: DEFAULT_CONFIG,
    singleCharacter: emptySingleCharacter(),
    characterAppearance: {}
  });

  assert.equal(result.plan.paragraphs[0]!.text, "Hina looks at Jay. 'Hello, Jay.'");
});
