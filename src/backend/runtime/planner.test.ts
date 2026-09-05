import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessageDTO, PersonaDTO, SpindleAPI } from "lumiverse-spindle-types";
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
    // Audio cues are decoupled from image cues and present in the plan.
    assert.equal(result.plan.audioCues?.length, 2);
    assert.equal(result.plan.audioCues?.[0]?.bgm, "romantic_theme");
    assert.equal(result.plan.audioCues?.[1]?.sfx, "sword_slash");
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

test("audio cues survive the maxImagesPerTurn image-cue limit", async () => {
  const { clearAudioCatalogCache, scanAudioCatalog } = await import("./audio-catalog");
  const files: Record<string, Uint8Array> = {
    "audio/bgm/romantic_theme.mp3": new TextEncoder().encode("dummy"),
    "audio/sfx/sword_slash.wav": new TextEncoder().encode("dummy"),
  };
  const content = "First line.\n\nSecond.\n\nThird.\n\nFourth.\n\nFifth.\n\nSixth.";
  const spindle: SpindleAPI = {
    storage: {
      list: async () => ["bgm/romantic_theme.mp3", "sfx/sword_slash.wav"],
      readBinary: async (path: string) => files[path] ?? new Uint8Array(),
    },
    generate: {
      raw: async () => ({
        content: JSON.stringify({
          scenes: [{
            startParagraph: 0,
            boundary: { claimedNewScene: true, reason: "initial", location: "Garden", timeOfDay: "afternoon", majorTimeJump: false, environmentReplacement: false, forced: false },
            environment: { location: "Garden", timeOfDay: "afternoon", weather: null, lighting: "sunlight", description: "A flower garden", persistentElements: [] },
            cast: ["Mira"],
            basePrompt: "flower garden, sunlight",
            compositionLock: "Mira centered"
          }],
          cues: [
            { paragraphIndex: 0, expression: "smile", bgm: "romantic_theme", sfx: null },
            { paragraphIndex: 1, expression: "surprise", sfx: null },
            { paragraphIndex: 2, expression: "surprise", sfx: null },
            { paragraphIndex: 3, expression: "surprise", sfx: null },
            { paragraphIndex: 4, expression: "surprise", sfx: null },
            { paragraphIndex: 5, expression: "surprise", sfx: "sword_slash" }
          ],
          choices: [],
          characters: [{ name: "Mira", description: "silver hair, green eyes" }]
        })
      })
    },
    log: { warn() {}, error() {} }
  } as unknown as SpindleAPI;

  await scanAudioCatalog(spindle, "audio");
  try {
    const result = await planTurn(spindle, {
      chatId: "chat-1",
      message: { ...message, name: "Mira", content },
      content,
      previousScene: null,
      previousContinuity: null,
      recentMessages: [],
      config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 3 },
      singleCharacter: emptySingleCharacter(),
      characterAppearance: {}
    });
    // Only 3 image cues survive the limit...
    assert.equal(result.plan.visualCues.length, 3);
    // ...but both audio cues (p0 bgm and p5 sfx) are retained independently.
    assert.equal(result.plan.audioCues.length, 2);
    assert.equal(result.plan.audioCues[0]?.paragraphIndex, 0);
    assert.equal(result.plan.audioCues[0]?.bgm, "romantic_theme");
    assert.equal(result.plan.audioCues[1]?.paragraphIndex, 5);
    assert.equal(result.plan.audioCues[1]?.sfx, "sword_slash");
  } finally {
    clearAudioCatalogCache();
  }
});

test("planTurn ignores user persona character attribution and prevents assigning user expression to companion", async () => {
  const content = "Mira sits across from you.\n\nYou yawn and mutter that you want to go to sleep.";
  const persona: PersonaDTO = {
    id: "persona-1",
    name: "Jay",
    title: "Traveler",
    description: "A sleepy traveler",
    image_id: null,
    attached_world_book_id: null,
    folder: "",
    is_default: true,
    metadata: {},
    created_at: 1,
    updated_at: 1
  };
  const spindle: SpindleAPI = {
    generate: {
      raw: async () => ({
        content: JSON.stringify({
          scenes: [{
            startParagraph: 0,
            boundary: { claimedNewScene: true, reason: "initial", location: "Bedroom", timeOfDay: "night", majorTimeJump: false, environmentReplacement: false, forced: false },
            environment: { location: "Bedroom", timeOfDay: "night", weather: null, lighting: "dim", description: "A bedroom", persistentElements: [] },
            cast: ["Mira", "Jay"],
            basePrompt: "bedroom, night",
            compositionLock: "Mira centered"
          }],
          cues: [
            { paragraphIndex: 0, character: "Mira", expression: "smile" },
            { paragraphIndex: 1, character: "Jay", expression: "sleepy" }
          ],
          choices: [],
          characters: [{ name: "Mira", description: "silver hair" }]
        })
      })
    },
    personas: {
      getActive: async () => persona
    },
    log: { warn() {}, error() {} }
  } as unknown as SpindleAPI;

  const result = await planTurn(spindle, {
    chatId: "chat-1",
    message: { ...message, name: "Mira", content },
    content,
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: DEFAULT_CONFIG,
    singleCharacter: emptySingleCharacter(),
    characterAppearance: {}
  });

  // Scene cast must not contain Jay
  assert.ok(!result.plan.scenes[0]!.cast.includes("Jay"));
  // Cue 1 must not depict Jay
  assert.notEqual(result.plan.visualCues[1]?.character, "Jay");
  // Cue 1 must not inherit the user's sleepy expression
  assert.notEqual(result.plan.visualCues[1]?.poseExpressionId, "sleepy");
});

test("planner speaker attribution produces sanitized per-paragraph nameplates", async () => {
  const spindle: SpindleAPI = {
    generate: {
      raw: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              scenes: [{
                startParagraph: 0,
                boundary: { claimedNewScene: true, reason: "initial", location: "Garden", timeOfDay: "day", majorTimeJump: false, environmentReplacement: false, forced: false },
                environment: { location: "Garden", timeOfDay: "day", weather: null, lighting: null, description: "A garden", persistentElements: [] },
                cast: ["Lyra"],
                character: "Lyra",
                basePrompt: "garden",
                compositionLock: "centered"
              }],
              cues: [{ paragraphIndex: 0, expression: null }],
              choices: [],
              characters: [{ name: "Lyra", description: "elf girl, pointy elf ears, emerald eyes, silver hair, white sundress" }],
              speakers: [
                { paragraphIndex: 0, name: "lyra" },
                { paragraphIndex: 1, name: "Totally Unknown Girl" },
                { paragraphIndex: 2, name: "Narrator" }
              ]
            })
          }
        }]
      })
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;

  const result = await planTurn(spindle, {
    chatId: "chat",
    message: { ...message, name: "Monster Garden", content: "\"Hello!\"\n\nA stranger waves.\n\nThe sun sets slowly." },
    content: "\"Hello!\"\n\nA stranger waves.\n\nThe sun sets slowly.",
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, parserConnectionId: "parser" },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: {}
  });

  // Known name: case-insensitive match resolves to the canonical casing.
  // Unknown name: rejected -> null -> frontend falls back to the turn speaker.
  // Narrator: empty plate (classic VN narration).
  assert.deepEqual(result.plan.paragraphSpeakers, ["Lyra", null, ""]);
});

test("fallback turns carry no paragraph speakers", async () => {
  const spindle: SpindleAPI = {
    generate: { raw: async () => ({ choices: [{ message: { content: "not json" } }] }) },
    log: { warn() {} }
  } as unknown as SpindleAPI;
  const result = await planTurn(spindle, {
    chatId: "chat",
    message: { ...message, content: "One.\n\nTwo." },
    content: "One.\n\nTwo.",
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, parserConnectionId: "parser" },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: {}
  });
  assert.equal(result.usedFallback, true);
  assert.deepEqual(result.plan.paragraphSpeakers, [null, null]);
});

test("attire persists across cues, turns, and character switches, and resets on explicit keyword (audit #5)", async () => {
  // 1. Turn A: Mira changes into pajamas on cue 1; cue 2 has missing attire -> stays in pajamas
  let planA: any;
  const spindleA: SpindleAPI = {
    generate: {
      raw: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              scenes: [{
                startParagraph: 0,
                boundary: { claimedNewScene: false, reason: "none" },
                environment: { location: "Bedroom", timeOfDay: "night", weather: "clear", lighting: "lamp", description: "A bedroom", persistentElements: [] },
                cast: ["Mira"],
                character: "Mira",
                basePrompt: "bedroom at night",
                compositionLock: "centered"
              }],
              cues: [
                { paragraphIndex: 0, expression: "idle" },
                { paragraphIndex: 1, expression: "idle", attire: "blue pajamas" },
                { paragraphIndex: 2, expression: "idle" }
              ],
              characters: [{ name: "Mira", description: "silver hair, green eyes, red coat" }]
            })
          }
        }]
      })
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;

  const resultA = await planTurn(spindleA, {
    chatId: "chat",
    message: { ...message, name: "Mira", content: "P0.\n\nP1.\n\nP2." },
    content: "P0.\n\nP1.\n\nP2.",
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: { Mira: "silver hair, green eyes, red coat" }
  });

  assert.equal(resultA.plan.visualCues[0]?.attire, undefined);
  assert.equal(resultA.plan.visualCues[1]?.attire, "blue pajamas");
  // Missing attire on cue 2 remains unchanged
  assert.equal(resultA.plan.visualCues[2]?.attire, "blue pajamas");
  assert.equal(resultA.plan.scenes[0]?.attire, "blue pajamas");
  assert.equal(resultA.plan.terminalContinuity.characters["Mira"]?.wardrobe?.attire, "blue pajamas");

  // 2. Turn B: Next turn without explicit attire inherits pajamas from previousScene / terminalContinuity
  const spindleB: SpindleAPI = {
    generate: {
      raw: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              scenes: [{
                startParagraph: 0,
                boundary: { claimedNewScene: false, reason: "none" },
                environment: { location: "Bedroom", timeOfDay: "night", weather: "clear", lighting: "lamp", description: "A bedroom", persistentElements: [] },
                cast: ["Mira"],
                character: "Mira",
                basePrompt: "bedroom at night",
                compositionLock: "centered"
              }],
              cues: [{ paragraphIndex: 0, expression: "idle" }],
              characters: [{ name: "Mira", description: "silver hair, green eyes, red coat" }]
            })
          }
        }]
      })
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;

  const resultB = await planTurn(spindleB, {
    chatId: "chat",
    message: { ...message, name: "Mira", content: "P0 next turn." },
    content: "P0 next turn.",
    previousScene: resultA.plan.scenes[0] ?? null,
    previousContinuity: resultA.plan.terminalContinuity,
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
    singleCharacter: resultA.singleCharacter,
    characterAppearance: { Mira: "silver hair, green eyes, red coat" }
  });

  assert.equal(resultB.plan.visualCues[0]?.attire, "blue pajamas");

  // 3. Turn C: Explicit reset returns to baseline outfit
  const spindleC: SpindleAPI = {
    generate: {
      raw: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              scenes: [{
                startParagraph: 0,
                boundary: { claimedNewScene: false, reason: "none" },
                environment: { location: "Bedroom", timeOfDay: "night", weather: "clear", lighting: "lamp", description: "A bedroom", persistentElements: [] },
                cast: ["Mira"],
                character: "Mira",
                basePrompt: "bedroom at night",
                compositionLock: "centered"
              }],
              cues: [{ paragraphIndex: 0, expression: "idle", attire: "baseline" }],
              characters: [{ name: "Mira", description: "silver hair, green eyes, red coat" }]
            })
          }
        }]
      })
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;

  const resultC = await planTurn(spindleC, {
    chatId: "chat",
    message: { ...message, name: "Mira", content: "P0 reset." },
    content: "P0 reset.",
    previousScene: resultB.plan.scenes[0] ?? null,
    previousContinuity: resultB.plan.terminalContinuity,
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
    singleCharacter: resultB.singleCharacter,
    characterAppearance: { Mira: "silver hair, green eyes, red coat" }
  });

  assert.equal(resultC.plan.visualCues[0]?.attire, undefined);
  assert.equal(resultC.plan.scenes[0]?.attire, null);
});

test("character switches preserve individual character attire independently (audit #5)", async () => {
  const spindle: SpindleAPI = {
    generate: {
      raw: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              scenes: [{
                startParagraph: 0,
                boundary: { claimedNewScene: false, reason: "none" },
                environment: { location: "Living room", timeOfDay: "day", weather: "clear", lighting: "sun", description: "A room", persistentElements: [] },
                cast: ["Mira", "Lyra"],
                character: "Mira",
                basePrompt: "living room",
                compositionLock: "centered"
              }],
              cues: [
                { paragraphIndex: 0, character: "Mira", expression: "idle", attire: "blue pajamas" },
                { paragraphIndex: 1, character: "Lyra", expression: "idle" },
                { paragraphIndex: 2, character: "Mira", expression: "smile" }
              ],
              characters: [
                { name: "Mira", description: "silver hair, green eyes" },
                { name: "Lyra", description: "blonde hair, blue eyes" }
              ]
            })
          }
        }]
      })
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;

  const result = await planTurn(spindle, {
    chatId: "chat",
    message: { ...message, name: "Mira", content: "P0.\n\nP1.\n\nP2." },
    content: "P0.\n\nP1.\n\nP2.",
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: { Mira: "silver hair", Lyra: "blonde hair" }
  });

  assert.equal(result.plan.visualCues[0]?.character, "Mira");
  assert.equal(result.plan.visualCues[0]?.attire, "blue pajamas");
  assert.equal(result.plan.visualCues[1]?.character, "Lyra");
  assert.equal(result.plan.visualCues[1]?.attire, undefined); // Lyra baseline
  assert.equal(result.plan.visualCues[2]?.character, "Mira");
  assert.equal(result.plan.visualCues[2]?.attire, "blue pajamas"); // Mira still in pajamas
});

test("repairs missing opening cue and ensures usable visual coverage (audit #6)", async () => {
  // Output with cues: [] is repaired with an opening cue at paragraph 0
  const spindle: SpindleAPI = {
    generate: {
      raw: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              scenes: [{
                startParagraph: 0,
                boundary: { claimedNewScene: false, reason: "none" },
                environment: { location: "Garden", timeOfDay: "day", weather: "clear", lighting: "sun", description: "A garden", persistentElements: [] },
                cast: ["Mira"],
                character: "Mira",
                basePrompt: "a beautiful garden",
                compositionLock: "centered"
              }],
              cues: [],
              characters: [{ name: "Mira", description: "silver hair, green eyes" }]
            })
          }
        }]
      })
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;

  const result = await planTurn(spindle, {
    chatId: "chat",
    message: { ...message, content: "P0.\n\nP1." },
    content: "P0.\n\nP1.",
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: {}
  });

  // Repaired with usable visual coverage at paragraph 0
  assert.equal(result.plan.visualCues.length, 1);
  assert.equal(result.plan.visualCues[0]?.paragraphIndex, 0);
  assert.equal(result.plan.planningStatus, "planned");
});

test("includeRecentMessages=0 does not pass recent messages into planner target (audit #12)", async () => {
  let capturedTarget: string = "";
  const spindle: SpindleAPI = {
    generate: {
      raw: async (req: any) => {
        capturedTarget = req.messages?.[1]?.content ?? "";
        return {
          choices: [{
            message: {
              content: JSON.stringify({
                scenes: [{
                  startParagraph: 0,
                  boundary: { claimedNewScene: false, reason: "none" },
                  environment: { location: "Room", timeOfDay: "day", weather: "clear", lighting: "sun", description: "A room", persistentElements: [] },
                  cast: ["Mira"],
                  basePrompt: "room",
                  compositionLock: "centered"
                }],
                cues: [{ paragraphIndex: 0 }],
                characters: [{ name: "Mira", description: "silver hair" }]
              })
            }
          }]
        };
      }
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;

  await planTurn(spindle, {
    chatId: "chat",
    message: { ...message, content: "Active content." },
    content: "Active content.",
    previousScene: null,
    previousContinuity: null,
    recentMessages: [{ name: "Mira", content: "OBSOLETE_HISTORY_SENTINEL", is_user: false }],
    config: { ...DEFAULT_CONFIG, includeRecentMessages: 0, parserConnectionId: "parser" },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: {}
  });

  assert.equal(capturedTarget.includes("OBSOLETE_HISTORY_SENTINEL"), false);
});

test("choices:[null] does not discard valid visual scenes and character identities (audit #12)", async () => {
  const spindle: SpindleAPI = {
    generate: {
      raw: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              scenes: [{
                startParagraph: 0,
                boundary: { claimedNewScene: false, reason: "none" },
                environment: { location: "Sanctuary", timeOfDay: "day", weather: "clear", lighting: "sun", description: "A holy sanctuary", persistentElements: [] },
                cast: ["Mira"],
                character: "Mira",
                basePrompt: "holy sanctuary with stained glass",
                compositionLock: "centered"
              }],
              cues: [{ paragraphIndex: 0, expression: "smile" }],
              choices: [null],
              characters: [{ name: "Mira", description: "silver hair, emerald eyes, white robes" }]
            })
          }
        }]
      })
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;

  const result = await planTurn(spindle, {
    chatId: "chat",
    message: { ...message, content: "The light filters through." },
    content: "The light filters through.",
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: {}
  });

  // Valid scenes and cues are preserved; fallback is not triggered
  assert.equal(result.usedFallback, false);
  assert.equal(result.plan.scenes[0]?.environment.location, "Sanctuary");
  assert.equal(result.plan.visualCues[0]?.poseExpressionId, "smile");
  assert.deepEqual(result.plan.choices, []);
});

test("repaired JSON preserves Python-style literals inside quoted strings (audit #12)", async () => {
  // Output with malformed unquoted key that requires repairJsonString
  const malformedJson = '{\nscenes: [{\n  startParagraph: 0,\n  boundary: { claimedNewScene: false, reason: "none" },\n  environment: { location: "Hall", timeOfDay: "day", weather: "clear", lighting: "sun", description: "A hall", persistentElements: [] },\n  cast: ["Mira"],\n  character: "Mira",\n  basePrompt: "False ceiling, None logo, True blue wallpaper",\n  compositionLock: "centered"\n}],\ncues: [{ paragraphIndex: 0, expression: "idle" }],\ncharacters: [{ name: "Mira", description: "silver hair" }]\n}';

  const spindle: SpindleAPI = {
    generate: {
      raw: async () => ({
        choices: [{
          message: {
            content: malformedJson
          }
        }]
      })
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;

  const result = await planTurn(spindle, {
    chatId: "chat",
    message: { ...message, content: "Inside the hall." },
    content: "Inside the hall.",
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: {}
  });

  assert.equal(result.usedFallback, false);
  // Python literals inside quotes are preserved with original casing
  assert.equal(result.plan.scenes[0]?.basePrompt, "False ceiling, None logo, True blue wallpaper");
});

test("local environment patches are merged into reused continuing scene without losing identity (audit #10)", async () => {
  const initialEnv = {
    location: "Bedroom",
    timeOfDay: "night",
    weather: "clear",
    lighting: "lamp light",
    description: "bedroom with a closed window",
    persistentElements: ["closed window"]
  };

  const initialSpindle: SpindleAPI = {
    generate: {
      raw: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              scenes: [{
                startParagraph: 0,
                boundary: { claimedNewScene: true, reason: "initial", location: "Bedroom" },
                environment: initialEnv,
                cast: ["Mira"],
                character: "Mira",
                basePrompt: "bedroom, closed window, lamp light",
                compositionLock: "centered"
              }],
              cues: [{ paragraphIndex: 0, expression: "idle" }],
              characters: [{ name: "Mira", description: "silver hair, green eyes" }]
            })
          }
        }]
      })
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;

  const resultA = await planTurn(initialSpindle, {
    chatId: "chat",
    message: { ...message, content: "Mira sits by the closed window." },
    content: "Mira sits by the closed window.",
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: { Mira: "silver hair, green eyes" }
  });

  const sceneA = resultA.plan.scenes[0]!;
  assert.equal(sceneA.basePrompt, "bedroom, closed window, lamp light");
  assert.deepEqual(sceneA.environment.persistentElements, ["closed window"]);

  // Turn B proposes continuing scene (claimedNewScene: false, reason: 'none') with local patch (open window)
  const patchedEnv = {
    ...initialEnv,
    description: "bedroom with an open window",
    persistentElements: ["open window"]
  };

  const continuingSpindle: SpindleAPI = {
    generate: {
      raw: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              scenes: [{
                startParagraph: 0,
                boundary: { claimedNewScene: false, reason: "none", location: "Bedroom" },
                environment: patchedEnv,
                cast: ["Mira"],
                character: "Mira",
                basePrompt: "bedroom, open window, lamp light",
                compositionLock: "centered"
              }],
              cues: [{ paragraphIndex: 0, expression: "idle" }],
              characters: [{ name: "Mira", description: "silver hair, green eyes" }]
            })
          }
        }]
      })
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;

  const resultB = await planTurn(continuingSpindle, {
    chatId: "chat",
    message: { ...message, content: "Mira opens the window to let the night air in." },
    content: "Mira opens the window to let the night air in.",
    previousScene: sceneA,
    previousContinuity: resultA.plan.terminalContinuity,
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
    singleCharacter: resultA.singleCharacter,
    characterAppearance: { Mira: "silver hair, green eyes" }
  });

  const sceneB = resultB.plan.scenes[0]!;
  // Scene identity is preserved
  assert.equal(sceneB.sceneId, sceneA.sceneId);
  // Revision is bumped because environment changed
  assert.equal(sceneB.revision, sceneA.revision + 1);
  // Patched environment details are merged in
  assert.deepEqual(sceneB.environment.persistentElements, ["open window"]);
  assert.equal(sceneB.environment.description, "bedroom with an open window");
  assert.equal(sceneB.basePrompt, "bedroom, open window, lamp light");
});

test("salvages character and attire metadata from redundant same-setting scene proposals (audit #10)", async () => {
  const content = "Mira enters the tearoom.\n\nRin steps forward wearing a ceremonial gown.";
  const spindle: SpindleAPI = {
    generate: {
      raw: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              scenes: [
                {
                  startParagraph: 0,
                  boundary: { claimedNewScene: true, reason: "initial", location: "Tearoom" },
                  environment: { location: "Tearoom", timeOfDay: "day", weather: "clear", lighting: "sunlight", description: "traditional tearoom", persistentElements: ["tatami"] },
                  cast: ["Mira"],
                  character: "Mira",
                  basePrompt: "tearoom, tatami, sunlight",
                  compositionLock: "centered"
                },
                {
                  startParagraph: 1,
                  boundary: { claimedNewScene: false, reason: "none", location: "Tearoom" },
                  environment: { location: "Tearoom", timeOfDay: "day", weather: "clear", lighting: "sunlight", description: "traditional tearoom", persistentElements: ["tatami"] },
                  cast: ["Rin"],
                  character: "Rin",
                  attire: "ceremonial blue kimono",
                  basePrompt: "tearoom, tatami, sunlight",
                  compositionLock: "centered"
                }
              ],
              cues: [
                { paragraphIndex: 0, expression: "idle" },
                { paragraphIndex: 1, expression: "smile" }
              ],
              characters: [
                { name: "Mira", description: "silver hair, green eyes" },
                { name: "Rin", description: "black hair, blue eyes" }
              ]
            })
          }
        }]
      })
    },
    log: { warn() {} }
  } as unknown as SpindleAPI;

  const result = await planTurn(spindle, {
    chatId: "chat",
    message: { ...message, content },
    content,
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, maxImagesPerTurn: 0, parserConnectionId: "parser" },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: { Mira: "silver hair, green eyes", Rin: "black hair, blue eyes" }
  });

  // Redundant proposal at paragraph 1 collapsed into single continuous scene
  assert.equal(result.plan.scenes.length, 1);
  // Cue 0 is attributed to Mira
  assert.equal(result.plan.visualCues[0]?.character, "Mira");
  // Cue 1 salvages character and attire from the discarded proposal at paragraph 1
  assert.equal(result.plan.visualCues[1]?.character, "Rin");
  assert.equal(result.plan.visualCues[1]?.attire, "ceremonial blue kimono");
});


test("stage effect and scene ambient survive planning; invalid values are dropped (screen effects)", async () => {
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
                    boundary: { claimedNewScene: true, reason: "initial", location: "Rooftop", timeOfDay: "night", majorTimeJump: false, environmentReplacement: false, forced: false },
                    environment: { location: "Rooftop", timeOfDay: "night", weather: "storm", lighting: "lightning", description: "A rooftop in a storm", persistentElements: [] },
                    cast: ["Mira"],
                    character: "Mira",
                    ambient: "Heavy Rain",
                    basePrompt: "rooftop, storm",
                    compositionLock: "centered"
                  }
                ],
                cues: [
                  { paragraphIndex: 0, expression: "surprise", character: "Mira", effect: "lightning" },
                  { paragraphIndex: 1, expression: "idle", character: "Mira", effect: "explode_everything" }
                ],
                choices: [],
                characters: [{ name: "Mira", description: "silver hair, green eyes, red coat" }]
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
    message: { ...message, name: "Mira", content: "Thunder cracks overhead.\n\nShe steadies herself." },
    content: "Thunder cracks overhead.\n\nShe steadies herself.",
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, parserConnectionId: "parser" },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: { "Mira": "silver hair, green eyes, red coat" }
  });

  // "Heavy Rain" normalizes onto the exact enum id; the scene carries it.
  assert.equal(result.plan.scenes[0]?.ambient, "heavy_rain");
  // A valid effect lands on the built cue.
  assert.equal(result.plan.visualCues[0]?.effect, "lightning");
  // An unknown effect is dropped rather than invented.
  assert.equal(result.plan.visualCues[1]?.effect, undefined);
});

test("absent effect and ambient stay absent (screen effects)", async () => {
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
                    boundary: { claimedNewScene: true, reason: "initial", location: "Cafe", timeOfDay: "day", majorTimeJump: false, environmentReplacement: false, forced: false },
                    environment: { location: "Cafe", timeOfDay: "day", weather: "clear", lighting: "warm", description: "A cafe", persistentElements: [] },
                    cast: ["Mira"],
                    character: "Mira",
                    basePrompt: "cafe interior",
                    compositionLock: "centered"
                  }
                ],
                cues: [{ paragraphIndex: 0, expression: "smile", character: "Mira" }],
                choices: [],
                characters: [{ name: "Mira", description: "silver hair, green eyes, red coat" }]
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
    message: { ...message, name: "Mira", content: "She sips her coffee." },
    content: "She sips her coffee.",
    previousScene: null,
    previousContinuity: null,
    recentMessages: [],
    config: { ...DEFAULT_CONFIG, parserConnectionId: "parser" },
    singleCharacter: emptySingleCharacter(),
    characterAppearance: { "Mira": "silver hair, green eyes, red coat" }
  });

  assert.equal(result.plan.scenes[0]?.ambient ?? null, null);
  assert.equal(result.plan.visualCues[0]?.effect, undefined);
});
