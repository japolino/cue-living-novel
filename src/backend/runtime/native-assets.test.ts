import assert from "node:assert/strict";
import test from "node:test";
import type { CharacterDTO } from "lumiverse-spindle-types";
import { TurnPlanSchema } from "../../shared/contracts.js";
import {
  resolveCharacterAssetImageId,
  resolveCharacterFallbackImageId,
  resolveNativeCardJobs,
} from "./native-assets.js";

const now = new Date().toISOString();

const mockCharacter: CharacterDTO = {
  id: "char-123",
  name: "Hina",
  description: "Test character",
  personality: "Teasing",
  scenario: "Classroom",
  first_mes: "Hello",
  mes_example: "",
  creator_notes: "",
  system_prompt: "",
  post_history_instructions: "",
  tags: ["blonde", "student"],
  alternate_greetings: [],
  creator: "japolino",
  image_id: "avatar-image-id",
  world_book_ids: [],
  extensions: {
    risu_asset_map: {
      "hina_first_message_1.jpg": "img-first-1",
      "hina_first_message_1": "img-first-1",
      "hina_pout_2.jpg": "img-pout-2",
      "hina_pout_2": "img-pout-2",
    },
    lumirealm: {
      asset_index: {
        "hina_receives_cheekpats_10.jpg": {
          imageIds: ["img-cheekpats-10"],
          ext: "jpg",
        },
      },
      emotion_index: {
        "hina_angry.png": {
          imageIds: ["img-angry-1"],
          ext: "png",
        },
      },
    },
    expressions: {
      enabled: true,
      defaultExpression: "hina_neutral",
      mappings: {
        hina_neutral: "img-expr-neutral",
        hina_happy: "img-expr-happy",
      },
    },
  },
  created_at: 1000,
  updated_at: 1000,
};

test("resolves image ID from risu_asset_map with and without extensions", () => {
  assert.equal(
    resolveCharacterAssetImageId(mockCharacter, "hina_first_message_1"),
    "img-first-1"
  );
  assert.equal(
    resolveCharacterAssetImageId(mockCharacter, "hina_first_message_1.jpg"),
    "img-first-1"
  );
  assert.equal(
    resolveCharacterAssetImageId(mockCharacter, "HINA_POUT_2"),
    "img-pout-2"
  );
});

test("resolves image ID from lumirealm asset_index and emotion_index", () => {
  assert.equal(
    resolveCharacterAssetImageId(mockCharacter, "hina_receives_cheekpats_10"),
    "img-cheekpats-10"
  );
  assert.equal(
    resolveCharacterAssetImageId(mockCharacter, "hina_angry"),
    "img-angry-1"
  );
});

test("resolves image ID from expressions mappings", () => {
  assert.equal(
    resolveCharacterAssetImageId(mockCharacter, "hina_happy"),
    "img-expr-happy"
  );
});

test("resolves fallback image ID preferring image_id then default expression", () => {
  assert.equal(resolveCharacterFallbackImageId(mockCharacter), "avatar-image-id");

  const charWithoutAvatar: CharacterDTO = {
    ...mockCharacter,
    image_id: null,
  };
  assert.equal(resolveCharacterFallbackImageId(charWithoutAvatar), "img-expr-neutral");
});

function createMockPlan(paragraphs: Array<{ index: number; sourceIndex: number; text: string }>) {
  return TurnPlanSchema.parse({
    schemaVersion: 1,
    key: {
      chatId: "chat-1",
      assistantMessageId: "msg-1",
      swipeId: 0,
      sourceFingerprint: "fp-12345678",
      revision: 1,
    },
    paragraphs,
    scenes: [
      {
        sceneId: "scene",
        revision: 0,
        startParagraph: 0,
        environment: {
          location: "Library",
          timeOfDay: "night",
          weather: null,
          lighting: "lamplight",
          description: "A quiet library.",
          persistentElements: [],
        },
        cast: ["Hina"],
        continuity: { revision: 0, characters: {}, facts: {} },
        basePrompt: "quiet library at night",
        cameraLock: {
          framing: "medium wide",
          angle: "eye level",
          perspective: "fixed",
          lens: "50mm",
          subjectAnchor: "center",
          horizon: "upper third",
          safeDialogueRegion: "lower third",
          aspectRatio: "16:9",
        },
        compositionLock: "Hina centered",
        activeAssetId: null,
        priorSceneId: null,
      },
    ],
    visualCues: [],
    choices: [],
    initialContinuity: { revision: 0, characters: {}, facts: {} },
    continuityDeltas: [],
    terminalContinuity: { revision: 0, characters: {}, facts: {} },
    planningStatus: "planned",
    createdAt: now,
  });
}

test("resolves native card jobs matching inline markers and paragraph indexes", async () => {
  const plan = createMockPlan([
    { index: 0, sourceIndex: 0, text: "The sun set over the horizon." },
    { index: 1, sourceIndex: 1, text: "She smiled teasingly." },
    { index: 2, sourceIndex: 3, text: "She crossed her arms and pouted." },
  ]);

  const content = [
    "The sun set over the horizon.",
    "She smiled teasingly.\n\n<img=\"hina_first_message_1\"> | <\"😏:Are you looking?\">",
    "She crossed her arms and pouted.\n\n<img=\"hina_pout_2\">",
  ].join("\n\n");

  const mockSpindle: any = {
    chats: {
      get: async () => ({ id: "chat-1", character_id: "char-123" }),
    },
    characters: {
      get: async () => mockCharacter,
      list: async () => ({ data: [mockCharacter], total: 1 }),
    },
    images: {
      get: async (id: string) => ({ id, url: `/api/v1/images/${id}` }),
    },
  };

  const jobs = await resolveNativeCardJobs({
    spindle: mockSpindle,
    chatId: "chat-1",
    plan,
    content,
    speakerName: "Hina",
  });

  assert.equal(jobs.length, 2);
  assert.equal(jobs[0]!.imageId, "img-first-1");
  assert.equal(jobs[0]!.imageUrl, "/api/v1/images/img-first-1");
  assert.equal(jobs[0]!.paragraphIndex, 1);
  assert.equal(jobs[0]!.status, "browser_ready");

  assert.equal(jobs[1]!.imageId, "img-pout-2");
  assert.equal(jobs[1]!.imageUrl, "/api/v1/images/img-pout-2");
  assert.equal(jobs[1]!.paragraphIndex, 2);
  assert.equal(jobs[1]!.status, "browser_ready");
});

test("falls back to avatar or default expression at paragraph 0 when text has no markers", async () => {
  const plan = createMockPlan([
    { index: 0, sourceIndex: 0, text: "Just regular dialogue." },
  ]);

  const mockSpindle: any = {
    chats: {
      get: async () => ({ id: "chat-1", character_id: "char-123" }),
    },
    characters: {
      get: async () => mockCharacter,
      list: async () => ({ data: [mockCharacter], total: 1 }),
    },
    images: {
      get: async (id: string) => ({ id, url: `/api/v1/images/${id}` }),
    },
  };

  const jobs = await resolveNativeCardJobs({
    spindle: mockSpindle,
    chatId: "chat-1",
    plan,
    content: "Just regular dialogue.",
    speakerName: "Hina",
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.imageId, "avatar-image-id");
  assert.equal(jobs[0]!.imageUrl, "/api/v1/images/avatar-image-id");
  assert.equal(jobs[0]!.paragraphIndex, 0);
  assert.equal(jobs[0]!.status, "browser_ready");
});
