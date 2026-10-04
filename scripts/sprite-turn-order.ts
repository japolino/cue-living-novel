/**
 * Sprite turn order: runs one staged turn through the sprite scheduler with a
 * fake provider (no network, no image service) and prints the order of the
 * image jobs and their counts for each set size (4 / 8 / 12).
 *
 *   bun scripts/sprite-turn-order.ts [stage-data.json] [--moment <paragraph>]
 *
 * The file holds `{ staging }` (as written by the reply tests) or a staging.
 * Reference anchoring is on (ComfyUI double), concurrency 1, every cut-out is
 * answered at once with "one figure". `--moment N` adds one key moment at
 * paragraph N.
 */
import { readFileSync } from "node:fs";
import { SpriteService } from "../src/backend/runtime/sprites/jobs.js";
import { mockSpindle, spriteConfig, toBase64, fakePng, CUT_META } from "../src/backend/runtime/sprites/__fixtures__/sprite-fixtures.js";
import { spriteStyleKey } from "../src/backend/runtime/sprites/style.js";
import { AssetJobSchema } from "../src/shared/contracts.js";
import { SpriteStagingSchema, spriteSetKeyFor, type SpriteExpressionCount, type SpriteStaging } from "../src/shared/sprites.js";
import type { KeyMomentScene } from "../src/backend/runtime/sprites/moment-prompts.js";

export type OrderEntry = { label: string; kind: "plate" | "sprite" | "moment"; priority: string };
export type OrderResult = { count: SpriteExpressionCount; order: OrderEntry[] };

/** Run one staging at one set size; returns the jobs in the order they started. */
export async function runTurnOrder(raw: SpriteStaging, count: SpriteExpressionCount, options: { moment?: number } = {}): Promise<OrderResult> {
  const mock = mockSpindle({ provider: "comfyui", gated: true });
  const config = spriteConfig({ spriteExpressionCount: count, referenceAnchoring: true, imageConcurrency: 1 });
  const log: string[] = [];
  const service = new SpriteService(mock.spindle, {
    isViewOpen: () => true,
    openChatId: () => "chat-1",
    loadConfig: async () => config,
    log: (line) => log.push(line),
    referenceTimeoutMs: 50,
  });
  const styleKey = spriteStyleKey(config);
  const staging = SpriteStagingSchema.parse(raw);
  const names = new Map(staging.cast.map((member) => [spriteSetKeyFor(member, styleKey), member.name]));
  const order: OrderEntry[] = [];
  const users = (service as unknown as { users: Map<string, { inflight: Map<string, { kind: string; setKey?: string; expression?: string; plateKey?: string; priority: string }> }> }).users;
  const answered = new Set<string>();
  const answerCuts = () => {
    for (const request of mock.of("vn_sprite_cut") as Array<{ requestId: string }>) {
      if (answered.has(request.requestId)) continue;
      answered.add(request.requestId);
      service.handleCutResult("u1", { type: "vn_sprite_cut_result", requestId: request.requestId, chunkIndex: 0, chunkCount: 1, dataBase64: toBase64(fakePng()), meta: { ...CUT_META, twoFigures: false } });
    }
  };
  await service.ensureForStaging("u1", staging, config);
  let moment: Promise<unknown> | null = null;
  if (options.moment !== undefined) {
    const now = new Date().toISOString();
    const job = AssetJobSchema.parse({
      jobId: "moment-job", ownerTurnKey: { chatId: "chat-1", assistantMessageId: "m-1", swipeId: 0, sourceFingerprint: "fingerprint-1", revision: 1 },
      sceneId: "scene-0", sceneRevision: 1, paragraphIndex: options.moment, promptFingerprint: "fingerprint-moment", provider: "pending", status: "queued", queuedAt: now,
    });
    const member = staging.cast[0]!;
    const scene: KeyMomentScene = {
      interaction: "sitting", characters: [{ name: member.name, identity: member.identity, attire: member.attire, expression: "smile" }], partner: false,
      plate: { location: staging.plates[0]?.location ?? "room", timeOfDay: null, weather: null, description: "" }, light: "day",
    };
    moment = service.runKeyMoments("u1", { jobs: [job], scenes: new Map([["moment-job", scene]]), chatId: "chat-1", signal: new AbortController().signal, onUpdate: () => {} });
  }
  let released = 0;
  for (let idle = 0; idle < 400; ) {
    answerCuts();
    if (mock.gates.length > released) {
      const gate = mock.gates[released]!;
      const prompt = gate.call.prompt;
      const work = [...(users.get("u1")?.inflight.values() ?? [])][0];
      if (/sitting/.test(prompt) && !work) order.push({ label: "key moment", kind: "moment", priority: "moment" });
      else if (work?.kind === "plate") order.push({ label: "plate", kind: "plate", priority: work.priority });
      else if (work) order.push({ label: `${names.get(work.setKey!) ?? work.setKey}/${work.expression}`, kind: "sprite", priority: work.priority });
      gate.release();
      released += 1;
      idle = 0;
    } else {
      idle += 1;
    }
    await service.settle("u1", 200);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  if (moment) await moment;
  return { count, order };
}

export function describeOrder(result: OrderResult, needed: ReadonlySet<string> = new Set()): string {
  const tally = { plate: 0, needed: 0, moment: 0, rare: 0, fill: 0 };
  const lines = result.order.map((entry, index) => {
    let group: keyof typeof tally;
    if (entry.kind === "plate") group = "plate";
    else if (entry.kind === "moment") group = "moment";
    else if (entry.priority === "visible" || needed.has(entry.label)) group = "needed";
    else if (entry.priority === "next") group = "rare";
    else group = "fill";
    tally[group] += 1;
    return `${String(index + 1).padStart(2)}. ${entry.label.padEnd(26)} ${group}`;
  });
  const total = result.order.length;
  return [
    `== ${result.count} expressions per character: ${total} images (plates ${tally.plate}, needed sprites ${tally.needed}, key moments ${tally.moment}, rare ${tally.rare}, fill-in ${tally.fill}) ==`,
    ...lines,
  ].join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const momentAt = args.indexOf("--moment");
  const moment = momentAt >= 0 ? Number(args[momentAt + 1]) : undefined;
  const file = args.find((arg, index) => !arg.startsWith("--") && (momentAt < 0 || index !== momentAt + 1)) ?? ".cache/reply-test/stage-data-lr.json";
  const data = JSON.parse(readFileSync(file, "utf8")) as { staging?: SpriteStaging } & SpriteStaging;
  const staging = data.staging ?? data;
  for (const count of [4, 8, 12] as const) {
    console.log(describeOrder(await runTurnOrder(staging, count, moment !== undefined ? { moment } : {})));
    console.log("");
  }
}
