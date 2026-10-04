import { describe, expect, test } from "bun:test";
import type { VisualNovelConfig } from "../../../config.js";
import { AssetJobSchema, type AssetJob } from "../../../shared/contracts.js";
import { SPRITE_HOT_SET, spriteSetKeyFor } from "../../../shared/sprites.js";
import { CUT_META, MIRA, fakePng, mockSpindle, spriteConfig, toBase64, waitFor, type MockSpindleOptions } from "./__fixtures__/sprite-fixtures.js";
import { SpriteService } from "./jobs.js";
import type { KeyMomentScene } from "./moment-prompts.js";
import { spriteStyleKey } from "./style.js";

/** Key-moment jobs on the sprite scheduler, and the anchoring wait. */

function setup(options: MockSpindleOptions & { config?: Partial<VisualNovelConfig> } = {}) {
  const mock = mockSpindle(options);
  const config = spriteConfig(options.config);
  let open = true;
  const service = new SpriteService(mock.spindle, {
    isViewOpen: () => open,
    openChatId: () => "chat-1",
    loadConfig: async () => config,
    referenceTimeoutMs: 200,
  });
  return { ...mock, service, config, styleKey: spriteStyleKey(config), setOpen: (value: boolean) => { open = value; } };
}

function job(jobId: string, status: AssetJob["status"] = "queued", paragraphIndex = 1): AssetJob {
  const now = "2026-10-01T00:00:00.000Z";
  return AssetJobSchema.parse({
    jobId, ownerTurnKey: { chatId: "chat-1", assistantMessageId: "m-1", swipeId: 0, sourceFingerprint: "fingerprint-1", revision: 1 },
    sceneId: "scene-0", sceneRevision: 1, paragraphIndex, promptFingerprint: "fingerprint-abcdef", provider: "pending", status,
    imageId: status === "generated" ? "img-done" : null, imageUrl: status === "generated" ? "/api/v1/images/img-done" : null,
    error: null, queuedAt: now, startedAt: status === "queued" ? null : now, generatedAt: status === "generated" ? now : null, finishedAt: status === "cancelled" || status === "failed" ? now : null,
  });
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

const isMoment = (prompt: string) => prompt.includes("kiss");

describe("key moments on the sprite scheduler", () => {
  test("a queued job runs with the key-moment prompt; updates carry the turn's job id; the result is returned", async () => {
    const f = setup();
    const updates: Array<[string, string]> = [];
    const jobs = await f.service.runKeyMoments("u1", {
      jobs: [job("job-a"), job("job-done", "generated", 0)],
      scenes: new Map([["job-a", kiss], ["job-done", kiss]]),
      chatId: "chat-1",
      signal: new AbortController().signal,
      onUpdate: (_jobs, changed) => { updates.push([changed.jobId, changed.status]); },
    });
    expect(jobs.map((entry) => [entry.jobId, entry.status])).toEqual([["job-a", "generated"], ["job-done", "generated"]]);
    expect(jobs[0]!.imageUrl).toMatch(/^\/api\/v1\/images\//);
    expect(jobs[1]!.imageId).toBe("img-done");
    expect(updates).toEqual([["job-a", "queued"], ["job-a", "generating"], ["job-a", "generated"]]);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.prompt).toContain("a girl with silver hair");
    // Default spriteImageSize "standard": landscape 912x624.
    expect(f.calls[0]!.parameters).toMatchObject({ width: 912, height: 624 });
    expect((f.calls[0] as Record<string, unknown>).owner_chat_id).toBe("chat-1");
  });

  test("key moments share the provider's concurrency with sprites (imageConcurrency 1: one call at a time)", async () => {
    const f = setup({ gated: true });
    await f.service.prepareCast("u1", [MIRA], f.config);
    await waitFor(() => f.gates.length === 1);
    const run = f.service.runKeyMoments("u1", {
      jobs: [job("job-a")], scenes: new Map([["job-a", kiss]]), chatId: "chat-1", signal: new AbortController().signal, onUpdate: () => {},
    });
    let released = 0;
    let maxInFlight = 0;
    while (!f.calls.some((call) => isMoment(call.prompt)) || released < f.gates.length) {
      await waitFor(() => f.gates.length > released);
      maxInFlight = Math.max(maxInFlight, f.gates.length - released);
      f.gates[released]!.release();
      released += 1;
    }
    expect(maxInFlight).toBe(1);
    expect((await run)[0]!.status).toBe("generated");
    // Equal priority: the earlier sprite work went first, the key moment waited its turn.
    expect(f.calls.findIndex((call) => isMoment(call.prompt))).toBeGreaterThan(0);
    for (let index = released; index < SPRITE_HOT_SET.length + 1; index += 1) {
      await waitFor(() => f.gates.length > index);
      f.gates[index]!.release();
    }
    await f.service.settle("u1");
  });

  test("an abort (view closed, newer batch) or pause cancels the job; a retry of the same job id runs again", async () => {
    const f = setup({ gated: true });
    const controller = new AbortController();
    const run = f.service.runKeyMoments("u1", { jobs: [job("job-a")], scenes: new Map([["job-a", kiss]]), chatId: "chat-1", signal: controller.signal, onUpdate: () => {} });
    await waitFor(() => f.gates.length === 1);
    controller.abort("The visual novel view closed.");
    f.gates[0]!.release();
    expect((await run)[0]!.status).toBe("cancelled");
    // pause() cancels a key moment like sprite work.
    const paused = f.service.runKeyMoments("u1", { jobs: [job("job-a")], scenes: new Map([["job-a", kiss]]), chatId: "chat-1", signal: new AbortController().signal, onUpdate: () => {} });
    await waitFor(() => f.gates.length === 2);
    f.service.pause("u1");
    f.gates[1]!.release();
    expect((await paused)[0]!.status).toBe("cancelled");
    // The same turn job id again (Retry / resume): a fresh run, not the cancelled one.
    const again = f.service.runKeyMoments("u1", { jobs: [job("job-a")], scenes: new Map([["job-a", kiss]]), chatId: "chat-1", signal: new AbortController().signal, onUpdate: () => {} });
    await waitFor(() => f.gates.length === 3);
    f.gates[2]!.release();
    expect((await again)[0]!.status).toBe("generated");
  });

  test("a provider failure fails the job with its message; failed, cancelled and scene-less jobs are not started", async () => {
    let fail = true;
    const f = setup({ failGenerate: (call) => (fail && isMoment(call.prompt) ? "ComfyUI is down" : null) });
    const first = await f.service.runKeyMoments("u1", { jobs: [job("job-a")], scenes: new Map([["job-a", kiss]]), chatId: "chat-1", signal: new AbortController().signal, onUpdate: () => {} });
    expect(first[0]).toMatchObject({ status: "failed", error: "ComfyUI is down" });
    fail = false;
    const calls = f.calls.length;
    const untouched = await f.service.runKeyMoments("u1", {
      jobs: [first[0]!, job("job-b", "cancelled"), job("job-c")], scenes: new Map([["job-a", kiss], ["job-b", kiss]]), chatId: "chat-1", signal: new AbortController().signal, onUpdate: () => {},
    });
    expect(untouched.map((entry) => entry.status)).toEqual(["failed", "cancelled", "queued"]);
    expect(f.calls.length).toBe(calls);
  });

  test("nothing runs when image generation is off", async () => {
    const f = setup({ config: { generateImages: false } });
    const jobs = await f.service.runKeyMoments("u1", { jobs: [job("job-a")], scenes: new Map([["job-a", kiss]]), chatId: "chat-1", signal: new AbortController().signal, onUpdate: () => {} });
    expect(jobs[0]!.status).toBe("queued");
    expect(f.calls).toHaveLength(0);
  });
});

describe("sprite jobs: the anchoring wait needs a provider that can anchor", () => {
  test("anchoring on with a provider that cannot anchor: other expressions start without waiting for idle", async () => {
    const f = setup({ provider: "pollinations", gated: true, config: { referenceAnchoring: true, imageConcurrency: 4 } });
    await f.service.prepareCast("u1", [MIRA], f.config);
    await waitFor(() => f.gates.length === 4);
    expect(f.calls.every((call) => !call.includeDataUrl)).toBe(true);
    expect(new Set(f.calls.map((call) => call.prompt)).size).toBe(4);
    let released = 0;
    while (released < SPRITE_HOT_SET.length) {
      await waitFor(() => f.gates.length > released);
      f.gates[released]!.release();
      released += 1;
    }
    await f.service.settle("u1");
  });

  test("anchoring on with NovelAI: only idle runs until it is rendered", async () => {
    const f = setup({ provider: "novelai", gated: true, config: { referenceAnchoring: true, imageConcurrency: 4 } });
    await f.service.prepareCast("u1", [MIRA], f.config);
    await waitFor(() => f.gates.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(f.gates).toHaveLength(1);
    expect(f.calls[0]!.includeDataUrl).toBe(true);
    f.gates[0]!.release();
    // Then the expressions wait for the idle's duplicate check (the browser cut-out).
    await waitFor(() => f.of("vn_sprite_cut").length === 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(f.gates).toHaveLength(1);
    const cut = f.of("vn_sprite_cut")[0] as { requestId: string; expression: string };
    expect(cut.expression).toBe("idle");
    f.service.handleCutResult("u1", { type: "vn_sprite_cut_result", requestId: cut.requestId, chunkIndex: 0, chunkCount: 1, dataBase64: toBase64(fakePng()), meta: { ...CUT_META, twoFigures: false } });
    await waitFor(() => f.gates.length === 5);
    for (let index = 1; index < SPRITE_HOT_SET.length; index += 1) {
      await waitFor(() => f.gates.length > index);
      f.gates[index]!.release();
    }
    await f.service.settle("u1");
    expect(spriteSetKeyFor(MIRA, f.styleKey)).toMatch(/^set_/);
  });
});
