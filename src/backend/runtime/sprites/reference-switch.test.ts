import { describe, expect, test } from "bun:test";
import type { VisualNovelConfig } from "../../../config.js";
import { AssetJobSchema, type AssetJob } from "../../../shared/contracts.js";
import { SPRITE_HOT_SET, spriteSetKeyFor } from "../../../shared/sprites.js";
import anima from "../__fixtures__/anima29b-connection.json";
import { CUT_META, MIRA, fakePng, mockSpindle, sampleStaging, spriteConfig, toBase64, type MockSpindleOptions } from "./__fixtures__/sprite-fixtures.js";
import { SpriteService } from "./jobs.js";
import type { KeyMomentScene } from "./moment-prompts.js";
import { spriteStyleKey } from "./style.js";

/** Sprites, plates and key moments with a mapped ComfyUI reference switch (Anima 2.9b: 804:value). */

function setup(options: MockSpindleOptions & { config?: Partial<VisualNovelConfig> } = {}) {
  const mock = mockSpindle({ provider: "comfyui", ...options });
  const config = spriteConfig(options.config);
  const log: string[] = [];
  const service = new SpriteService(mock.spindle, {
    isViewOpen: () => true,
    openChatId: () => "chat-1",
    loadConfig: async () => config,
    log: (line) => log.push(line),
    referenceTimeoutMs: 200,
  });
  const started = () => log.filter((line) => line.endsWith("-> generating")).map((line) => line.split(" ")[3]!);
  const callsBy = () => started().map((name, index) => ({ name, parameters: mock.calls[index]!.parameters }));
  const answered = new Set<string>();
  const answerAll = async () => {
    for (let guard = 0; guard < 60; guard += 1) {
      const pending = (mock.of("vn_sprite_cut") as Array<{ requestId: string }>).filter((request) => !answered.has(request.requestId));
      if (pending.length === 0) return;
      for (const request of pending) {
        answered.add(request.requestId);
        service.handleCutResult("u1", { type: "vn_sprite_cut_result", requestId: request.requestId, chunkIndex: 0, chunkCount: 1, dataBase64: toBase64(fakePng()), meta: CUT_META });
      }
      await service.settle("u1");
    }
  };
  return { ...mock, service, config, log, callsBy, answerAll, styleKey: spriteStyleKey(config) };
}

const kiss: KeyMomentScene = {
  interaction: "kiss",
  characters: [
    { name: "Mira", identity: "1girl, silver hair", attire: "white blouse", expression: "smile" },
    { name: "Kai", identity: "1boy, black hair", attire: "black jacket", expression: "idle" },
  ],
  partner: false,
  plate: { location: "observatory", timeOfDay: "night", weather: null, description: "" },
  light: "night",
};

function job(jobId: string): AssetJob {
  return AssetJobSchema.parse({
    jobId, ownerTurnKey: { chatId: "chat-1", assistantMessageId: "m-1", swipeId: 0, sourceFingerprint: "fingerprint-1", revision: 1 },
    sceneId: "scene-0", sceneRevision: 1, paragraphIndex: 1, promptFingerprint: "fingerprint-abcdef", provider: "pending", status: "queued",
    imageId: null, imageUrl: null, error: null, queuedAt: "2026-10-01T00:00:00.000Z", startedAt: null, generatedAt: null, finishedAt: null,
  });
}

async function anchoredSpriteCalls(options: MockSpindleOptions & { config?: Partial<VisualNovelConfig> }) {
  const f = setup({ ...options, config: { referenceAnchoring: true, ...options.config } });
  await f.service.prepareCast("u1", [MIRA], f.config);
  await f.service.settle("u1");
  await f.answerAll();
  await f.service.settle("u1");
  const calls = f.callsBy();
  expect(calls).toHaveLength(SPRITE_HOT_SET.length);
  expect(calls[0]!.name).toBe(`${spriteSetKeyFor(MIRA, f.styleKey)}/idle`);
  return { f, idle: calls[0]!.parameters, expressions: calls.slice(1).map((entry) => entry.parameters) };
}

describe("sprite jobs: ComfyUI reference switch", () => {
  test("idle: off and no denoise; expressions with the idle reference: on at strength 0.5", async () => {
    const { f, idle, expressions } = await anchoredSpriteCalls({ metadata: anima.metadata });
    expect(idle.resolvedSourceImages).toBeUndefined();
    expect(idle.denoise).toBeUndefined();
    expect(idle.comfyui_custom_fields).toEqual({ "804:value": false });
    for (const parameters of expressions) {
      expect(parameters.resolvedSourceImages).toHaveLength(1);
      expect(parameters.denoise).toBe(0.5);
      expect(parameters.comfyui_custom_fields).toEqual({ "804:value": true });
    }
    expect(f.log.some((line) => line.endsWith("/idle: reference switch 804:value -> off"))).toBe(true);
    expect(f.log.some((line) => line.endsWith("/smile: reference switch 804:value -> on"))).toBe(true);
  });

  test("anchoring off: every sprite and plate switches the IP-Adapter off", async () => {
    const f = setup({ metadata: anima.metadata });
    await f.service.ensureForStaging("u1", sampleStaging(f.styleKey), f.config);
    await f.service.settle("u1");
    const calls = f.callsBy();
    const plates = calls.filter((entry) => !entry.name.includes("/"));
    expect(plates.length).toBeGreaterThan(0);
    expect(calls.length).toBeGreaterThan(plates.length);
    for (const entry of calls) {
      expect(entry.parameters.denoise).toBeUndefined();
      expect(entry.parameters.comfyui_custom_fields).toEqual({ "804:value": false });
    }
    expect(f.log.some((line) => line.startsWith("plate ") && line.endsWith("reference switch 804:value -> off"))).toBe(true);
  });

  test("plate with anchoring on: still off (a plate has no reference)", async () => {
    const f = setup({ metadata: anima.metadata, config: { referenceAnchoring: true } });
    await f.service.ensureForStaging("u1", sampleStaging(f.styleKey), f.config);
    await f.service.settle("u1");
    const plates = f.callsBy().filter((entry) => !entry.name.includes("/"));
    expect(plates.length).toBeGreaterThan(0);
    for (const entry of plates) {
      expect(entry.parameters.denoise).toBeUndefined();
      expect(entry.parameters.comfyui_custom_fields).toEqual({ "804:value": false });
    }
  });

  test("key moment: off and no denoise; the user's custom fields are merged", async () => {
    const f = setup({ metadata: anima.metadata, config: { imageParameters: { custom: { "7:text": "x" } } } });
    await f.service.runKeyMoments("u1", { jobs: [job("job-a")], scenes: new Map([["job-a", kiss]]), chatId: "chat-1", signal: new AbortController().signal, onUpdate: () => {} });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.parameters.denoise).toBeUndefined();
    expect(f.calls[0]!.parameters.comfyui_custom_fields).toEqual({ "7:text": "x", "804:value": false });
    expect(f.log).toContain("key moment: reference switch 804:value -> off");
  });

  test("the user's own switch value wins (and the old denoise 0.0 stays)", async () => {
    const { idle, expressions } = await anchoredSpriteCalls({ metadata: anima.metadata, config: { imageParameters: { comfyui_custom_fields: { "804:value": true } } } });
    expect(idle.comfyui_custom_fields).toEqual({ "804:value": true });
    expect(idle.denoise).toBe(0);
    for (const parameters of expressions) expect(parameters.comfyui_custom_fields).toEqual({ "804:value": true });
  });

  test("no switch, or a failed lookup: unchanged", async () => {
    for (const metadata of [undefined, { comfyui: { ...anima.metadata.comfyui, field_mappings: [] } }, () => { throw new Error("unreadable"); }]) {
      const { idle, expressions } = await anchoredSpriteCalls(metadata ? { metadata: metadata as NonNullable<MockSpindleOptions["metadata"]> } : {});
      expect(idle.denoise).toBe(0);
      expect(idle.comfyui_custom_fields).toBeUndefined();
      for (const parameters of expressions) {
        expect(parameters.denoise).toBe(0.5);
        expect(parameters.comfyui_custom_fields).toBeUndefined();
      }
    }
  });
});
