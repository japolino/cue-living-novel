import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../../../config.js";
import { AssetJobSchema, type AssetJob } from "../../../shared/contracts.js";
import { SPRITE_HOT_SET, SPRITE_SET_4, SPRITE_SET_8, plateKeyFor, spriteSetKeyFor, type SpriteStaging } from "../../../shared/sprites.js";
import { CUT_META, KAI, MIRA, fakePng, mockSpindle, sampleStaging, spriteConfig, toBase64, waitFor, type MockSpindleOptions } from "./__fixtures__/sprite-fixtures.js";
import { SpriteService } from "./jobs.js";
import type { KeyMomentScene } from "./moment-prompts.js";
import { spriteStyleKey } from "./style.js";

/**
 * Order of work for a staged turn (docs/SPRITE_MODE.md, "Order of work"):
 * plates and needed expressions first in reading order, then key moments,
 * then rare expressions and the fill-in; and the set size (4 / 8 / 12).
 */

function setup(options: MockSpindleOptions & { config?: Partial<VisualNovelConfig> } = {}) {
  const mock = mockSpindle(options);
  let config = spriteConfig(options.config);
  const log: string[] = [];
  const service = new SpriteService(mock.spindle, {
    isViewOpen: () => true,
    openChatId: () => "chat-1",
    loadConfig: async () => config,
    log: (line) => log.push(line),
    referenceTimeoutMs: 100,
  });
  const styleKey = spriteStyleKey(config);
  const started = () => log.filter((line) => line.endsWith("-> generating")).map((line) => line.split(" ")[3]!);
  const answered = new Set<string>();
  const answerCuts = () => {
    for (const request of mock.of("vn_sprite_cut") as Array<{ requestId: string }>) {
      if (answered.has(request.requestId)) continue;
      answered.add(request.requestId);
      service.handleCutResult("u1", { type: "vn_sprite_cut_result", requestId: request.requestId, chunkIndex: 0, chunkCount: 1, dataBase64: toBase64(fakePng()), meta: { ...CUT_META, twoFigures: false } });
    }
  };
  /** Release gates one by one (answering cuts) until `limit` calls were made or nothing more starts. */
  const drain = async (limit = 200) => {
    let released = mock.gates.filter((gate) => (gate as { done?: boolean }).done).length;
    for (let quiet = 0; quiet < 40 && released < limit; ) {
      answerCuts();
      const next = mock.gates.find((gate) => !(gate as { done?: boolean }).done);
      if (next) {
        (next as { done?: boolean }).done = true;
        next.release();
        released += 1;
        quiet = 0;
      } else {
        quiet += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 3));
    }
    if (!mock.gates.length) await service.settle("u1");
    return released;
  };
  /** Release one gate (marked so `drain` skips it). */
  const release = (index: number) => {
    const gate = mock.gates[index]! as typeof mock.gates[number] & { done?: boolean };
    gate.done = true;
    gate.release();
  };
  return { ...mock, service, log, styleKey, started, answerCuts, drain, release, setConfig: (patch: Partial<VisualNovelConfig>) => { config = { ...config, ...patch }; }, config: () => config };
}

const actor = (characterKey: string, expression: string, slot: "left" | "center" | "right" = "center") => ({ characterKey, expression, slot, facing: "viewer" as const, focus: true, motion: "none" as const, emote: "none" as const, intensity: 3 });

function staging(styleKey: string, cast: typeof MIRA[], paragraphs: Array<Array<[string, string]>>, places: string[] = ["Classroom"]): SpriteStaging {
  const plates = places.map((location) => ({ plateKey: plateKeyFor({ location, timeOfDay: "noon" }, styleKey), location, timeOfDay: "noon", weather: null, description: location }));
  return {
    version: 1,
    source: "planner",
    cast,
    plates,
    paragraphs: paragraphs.map((actors, index) => ({
      actors: actors.map(([key, expression], position) => actor(key, expression, (["left", "center", "right"] as const)[position]!)),
      plateKey: plates[Math.min(plates.length - 1, Math.floor(index / Math.max(1, Math.ceil(paragraphs.length / plates.length))))]?.plateKey ?? null,
      light: "day" as const,
    })),
  };
}

function momentJob(jobId: string, paragraphIndex: number): AssetJob {
  return AssetJobSchema.parse({
    jobId, ownerTurnKey: { chatId: "chat-1", assistantMessageId: "m-1", swipeId: 0, sourceFingerprint: "fingerprint-1", revision: 1 },
    sceneId: "scene-0", sceneRevision: 1, paragraphIndex, promptFingerprint: "fingerprint-abcdef", provider: "pending", status: "queued", queuedAt: "2026-10-01T00:00:00.000Z",
  });
}

const kiss: KeyMomentScene = {
  interaction: "kiss",
  characters: [
    { name: "Mira", identity: "1girl, silver hair", attire: "white blouse", expression: "smile" },
    { name: "Kai", identity: "1boy, black hair", attire: "black jacket", expression: "idle" },
  ],
  partner: false,
  plate: { location: "classroom", timeOfDay: "noon", weather: null, description: "" },
  light: "day",
};

describe("order of work for a staged turn", () => {
  test("the opening plate first, then needed expressions by first appearance, a later plate before its paragraph's sprites, then rare, then fill-in", async () => {
    const f = setup({ gated: true });
    const mira = spriteSetKeyFor(MIRA, f.styleKey);
    const kai = spriteSetKeyFor(KAI, f.styleKey);
    // p0 Mira smiles; p1 Kai is worried; p2 Mira is proud (rare -> smug); p3 (garden) Kai laughs.
    const turn = staging(f.styleKey, [MIRA, KAI], [[["mira", "smile"]], [["mira", "smile"], ["kai", "worried"]], [["mira", "proud"], ["kai", "worried"]], [["kai", "laughing"]]], ["Classroom", "Garden"]);
    await f.service.ensureForStaging("u1", turn, f.config());
    await f.drain();
    const [classroom, garden] = turn.plates.map((plate) => plate.plateKey);
    const order = f.started();
    // The garden starts at p2: it goes before the sprites p2 needs.
    expect(order.slice(0, 7)).toEqual([
      classroom!, `${mira}/smile`, `${kai}/worried`, garden!, `${mira}/smug`, `${kai}/laughing`, `${mira}/proud`,
    ]);
    // Then the fill-in: Mira's set first (she appears first), then Kai's.
    const fill = order.slice(7);
    expect(fill).toHaveLength(SPRITE_HOT_SET.length * 2 - 4);
    expect(fill.slice(0, SPRITE_HOT_SET.length - 2).every((name) => name.startsWith(mira))).toBe(true);
    expect(fill.slice(SPRITE_HOT_SET.length - 2).every((name) => name.startsWith(kai))).toBe(true);
  });

  test("with anchoring the idle comes first; nothing else starts while its check is pending (no fill-in, no later turn work)", async () => {
    const f = setup({ gated: true, provider: "comfyui", config: { referenceAnchoring: true, imageConcurrency: 2 } });
    const mira = spriteSetKeyFor(MIRA, f.styleKey);
    const kai = spriteSetKeyFor(KAI, f.styleKey);
    const turn = { ...staging(f.styleKey, [MIRA, KAI], [[["mira", "smile"]], [["mira", "smile"], ["kai", "idle"]]]), plates: [], paragraphs: staging(f.styleKey, [MIRA, KAI], [[["mira", "smile"]], [["mira", "smile"], ["kai", "idle"]]]).paragraphs.map((paragraph) => ({ ...paragraph, plateKey: null })) };
    await f.service.ensureForStaging("u1", turn, f.config());
    await waitFor(() => f.gates.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    // Two slots, but Kai's idle (needed later) waits for Mira's smile, which waits for Mira's idle.
    expect(f.started()).toEqual([`${mira}/idle`]);
    f.release(0);
    await waitFor(() => f.of("vn_sprite_cut").length === 1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    // The idle's check is pending: no fill-in, no later turn work, even with a free slot.
    expect(f.gates).toHaveLength(1);
    f.answerCuts();
    await waitFor(() => f.gates.length === 3);
    // Both are turn work: they run side by side (2 slots).
    expect(new Set(f.started().slice(1, 3))).toEqual(new Set([`${mira}/smile`, `${kai}/idle`]));
    f.release(1);
    f.release(2);
    // Kai's idle is cut-checked before anything else starts.
    await waitFor(() => f.of("vn_sprite_cut").length >= 2);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(f.gates).toHaveLength(3);
    await f.drain();
    expect(f.started().slice(3).every((name) => name.startsWith(mira) || name.startsWith(kai))).toBe(true);
    expect(f.started()).toHaveLength(SPRITE_HOT_SET.length * 2);
  });

  test("a newer turn goes ahead of fill-in that has not started; the image already generating finishes", async () => {
    const f = setup({ gated: true });
    const mira = spriteSetKeyFor(MIRA, f.styleKey);
    const kai = spriteSetKeyFor(KAI, f.styleKey);
    const first = { ...staging(f.styleKey, [MIRA], [[["mira", "smile"]]]), plates: [], paragraphs: [{ actors: [actor("mira", "smile")], plateKey: null, light: "day" as const }] };
    await f.service.ensureForStaging("u1", first, f.config());
    // smile, then the first fill-in image starts.
    await waitFor(() => f.gates.length === 1);
    f.release(0);
    await waitFor(() => f.gates.length === 2);
    expect(f.started()[1]).toBe(`${mira}/idle`);
    // A newer turn: Kai is sad, at the classroom.
    const second = staging(f.styleKey, [KAI], [[["kai", "sad"]]]);
    await f.service.ensureForStaging("u1", second, f.config());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(f.gates).toHaveLength(2);
    f.release(1);
    await waitFor(() => f.gates.length === 3);
    f.release(2);
    await waitFor(() => f.gates.length === 4);
    expect(f.started().slice(2, 4)).toEqual([second.plates[0]!.plateKey, `${kai}/sad`]);
    await f.drain();
    expect(f.started().slice(4, 4 + SPRITE_HOT_SET.length - 1).every((name) => name.startsWith(kai))).toBe(true);
  });

  test("key moments go after the turn's plates and needed sprites, before rare expressions and the fill-in", async () => {
    const f = setup({ gated: true });
    const mira = spriteSetKeyFor(MIRA, f.styleKey);
    const turn = sampleStaging(f.styleKey);
    await f.service.ensureForStaging("u1", turn, f.config());
    const run = f.service.runKeyMoments("u1", { jobs: [momentJob("job-a", 1)], scenes: new Map([["job-a", kiss]]), chatId: "chat-1", signal: new AbortController().signal, onUpdate: () => {} });
    await f.drain();
    expect((await run)[0]!.status).toBe("generated");
    const moment = f.calls.findIndex((call) => call.prompt.includes("kiss"));
    const [observatory, garden] = turn.plates.map((plate) => plate.plateKey);
    // Four turn images (2 plates, smile, crying), then the key moment, then happy tears (rare), then the fill-in.
    expect(moment).toBe(4);
    expect(f.started().slice(0, 4)).toEqual([observatory!, `${mira}/smile`, garden!, `${mira}/crying_with_eyes_open`]);
    expect(f.started()[4]).toBe(`${mira}/happy_tears`);
  });

  test("a key moment waits while the turn's sprites wait for the idle's check", async () => {
    const f = setup({ gated: true, provider: "comfyui", config: { referenceAnchoring: true } });
    const turn = { ...sampleStaging(f.styleKey), plates: [], paragraphs: sampleStaging(f.styleKey).paragraphs.map((paragraph) => ({ ...paragraph, plateKey: null })) };
    await f.service.ensureForStaging("u1", turn, f.config());
    const run = f.service.runKeyMoments("u1", { jobs: [momentJob("job-a", 0)], scenes: new Map([["job-a", kiss]]), chatId: "chat-1", signal: new AbortController().signal, onUpdate: () => {} });
    await waitFor(() => f.gates.length === 1);
    f.release(0);
    await waitFor(() => f.of("vn_sprite_cut").length === 1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(f.gates).toHaveLength(1);
    await f.drain();
    await run;
    expect(f.calls.findIndex((call) => call.prompt.includes("kiss"))).toBe(3);
  });
});

describe("set size (spriteExpressionCount)", () => {
  test("default 4: the 4 set only; other expressions map into it; rare expressions are not made", async () => {
    expect(DEFAULT_CONFIG.spriteExpressionCount).toBe(4);
    const f = setup({ config: { spriteExpressionCount: DEFAULT_CONFIG.spriteExpressionCount } });
    const mira = spriteSetKeyFor(MIRA, f.styleKey);
    // worried -> sad, happy_tears -> crying -> sad, smirk -> smug -> smile.
    const turn = staging(f.styleKey, [MIRA], [[["mira", "worried"]], [["mira", "happy_tears"]], [["mira", "smirk"]]]);
    await f.service.ensureForStaging("u1", turn, f.config());
    await f.drain();
    expect(f.started()).toEqual([turn.plates[0]!.plateKey, `${mira}/sad`, `${mira}/smile`, `${mira}/idle`, `${mira}/angry`]);
    const view = await f.service.turnView("u1", turn, f.config());
    expect(view.expressionCount).toBe(4);
    expect(Object.keys(view.sets.mira!.expressions)).toEqual([...SPRITE_SET_4]);
  });

  test("8: needed expressions map into the 8 set; the fill-in completes the 8", async () => {
    const f = setup({ config: { spriteExpressionCount: 8 } });
    const mira = spriteSetKeyFor(MIRA, f.styleKey);
    const turn = staging(f.styleKey, [MIRA], [[["mira", "scared"]], [["mira", "thinking"]], [["mira", "smirk"]]]);
    await f.service.ensureForStaging("u1", turn, f.config());
    await f.drain();
    expect(f.started().slice(0, 4)).toEqual([turn.plates[0]!.plateKey, `${mira}/surprised`, `${mira}/idle`, `${mira}/smug`]);
    expect(new Set(f.started().slice(1))).toEqual(new Set(SPRITE_SET_8.map((expression) => `${mira}/${expression}`)));
  });

  test("an image that exists is used in any size; changing the size deletes nothing; a bigger size fills the rest as fill-in", async () => {
    const f = setup({ config: { spriteExpressionCount: 12 } });
    const mira = spriteSetKeyFor(MIRA, f.styleKey);
    // 12: Mira's surprised (and the rest) exist.
    await f.service.ensureForStaging("u1", staging(f.styleKey, [MIRA], [[["mira", "surprised"]]]), f.config());
    await f.drain();
    const made = f.calls.length;
    expect(made).toBe(SPRITE_HOT_SET.length + 1);
    // 4: a shocked line shows the existing surprised sprite; nothing new is made.
    f.setConfig({ spriteExpressionCount: 4 });
    await f.service.ensureForStaging("u1", staging(f.styleKey, [MIRA], [[["mira", "shocked"]]]), f.config());
    await f.drain();
    expect(f.calls.length).toBe(made);
    const view = await f.service.turnView("u1", staging(f.styleKey, [MIRA], [[["mira", "shocked"]]]), f.config());
    // Listed: the 4 set, then the other images that exist (nothing is hidden or deleted).
    expect(Object.keys(view.sets.mira!.expressions).slice(0, 4)).toEqual([...SPRITE_SET_4]);
    expect(Object.keys(view.sets.mira!.expressions)).toContain("surprised");
    // Progress counts the 4 set.
    expect(view.sets.mira!.readyCount).toBe(4);
    expect(f.deleted.filter((id) => id.startsWith("cut-"))).toEqual([]);
    expect(mira).toMatch(/^set_/);
  });

  test("4 -> 12: the missing expressions are made as fill-in, after the turn's work", async () => {
    const f = setup({ gated: true, config: { spriteExpressionCount: 4 } });
    const mira = spriteSetKeyFor(MIRA, f.styleKey);
    const noPlate = (paragraphs: Array<Array<[string, string]>>) => ({ ...staging(f.styleKey, [MIRA], paragraphs), plates: [], paragraphs: staging(f.styleKey, [MIRA], paragraphs).paragraphs.map((paragraph) => ({ ...paragraph, plateKey: null })) });
    await f.service.ensureForStaging("u1", noPlate([[["mira", "smile"]]]), f.config());
    await f.drain();
    expect(f.calls).toHaveLength(4);
    f.setConfig({ spriteExpressionCount: 12 });
    await f.service.ensureForStaging("u1", noPlate([[["mira", "worried"]]]), f.config());
    await f.drain();
    expect(f.started()[4]).toBe(`${mira}/worried`);
    expect(f.calls).toHaveLength(SPRITE_HOT_SET.length);
  });

  test("12 -> 4 while the fill-in waits: the queued images outside the 4 set go back to missing", async () => {
    const f = setup({ gated: true, config: { spriteExpressionCount: 12 } });
    const mira = spriteSetKeyFor(MIRA, f.styleKey);
    const turn = { ...staging(f.styleKey, [MIRA], [[["mira", "smile"]]]), plates: [], paragraphs: [{ actors: [actor("mira", "smile")], plateKey: null, light: "day" as const }] };
    await f.service.ensureForStaging("u1", turn, f.config());
    await waitFor(() => f.gates.length === 1);
    f.setConfig({ spriteExpressionCount: 4 });
    await f.service.ensureForStaging("u1", turn, f.config());
    await f.drain();
    const set = (await f.service.library.get("u1")).sets[mira]!;
    expect(Object.values(set.images).filter((image) => image.status === "missing").map((image) => image.expression).sort())
      .toEqual(SPRITE_HOT_SET.filter((expression) => !(SPRITE_SET_4 as readonly string[]).includes(expression)).sort());
    expect(f.calls).toHaveLength(4);
  });

  test("Prepare sprites for this chat makes the active set only", async () => {
    const f = setup({ config: { spriteExpressionCount: 8 } });
    await f.service.prepareCast("u1", [MIRA], f.config());
    await f.drain();
    expect(f.calls).toHaveLength(8);
  });
});
