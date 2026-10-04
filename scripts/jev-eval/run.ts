/**
 * Send the real sprite-classifier request bodies for the labeled dataset to
 * live Jev and cache the raw answers in .cache/jev-eval (never committed).
 * Not part of `bun run test`. Skips cleanly without a key.
 *
 *   bun run scripts/jev-eval/run.ts                 # all replies (cached bodies are not re-sent)
 *   bun run scripts/jev-eval/run.ts --dry           # batch counts and bytes only, no key needed
 *   bun run scripts/jev-eval/run.ts --repeat=3      # re-send the first 3 replies' bodies (determinism)
 *   bun run scripts/jev-eval/run.ts --only=id1,id2
 */
import { systemOneEndpoint } from "../../src/backend/runtime/system-one.js";
import { SPRITE_REQUEST_BYTE_LIMIT } from "../../src/backend/runtime/system-one-sprites.js";
import { buildCase, EVAL_CONFIG } from "./build.js";
import { ANSWERS_DIR, REPEAT_DIR, bodyHash, readCached, readKey, writeCached, type CachedAnswer } from "./common.js";
import { REPLIES } from "./dataset/index.js";

const args = new Map(process.argv.slice(2).map((arg) => {
  const [name, value] = arg.replace(/^--/, "").split("=");
  return [name!, value ?? "true"] as const;
}));
const dry = args.has("dry");
const repeat = args.has("repeat") ? Number(args.get("repeat")) || 3 : 0;
const only = args.get("only")?.split(",") ?? null;
const CONCURRENCY = 4;

const selected = REPLIES.filter((reply) => !only || only.includes(reply.id)).slice(0, repeat || undefined);
const jobs = selected.flatMap((reply) => buildCase(reply).batches.map((batch, index) => ({ reply, batch, index, hash: bodyHash(batch.body) })));
const totalBytes = jobs.reduce((sum, job) => sum + job.batch.bytes, 0);
const maxBytes = Math.max(0, ...jobs.map((job) => job.batch.bytes));
console.log(`replies=${selected.length} requests=${jobs.length} questions=${jobs.reduce((n, job) => n + Object.keys(job.batch.questions).length, 0)} bytes total=${totalBytes} max=${maxBytes} (limit ${SPRITE_REQUEST_BYTE_LIMIT})`);
if (dry) process.exit(0);

const key = readKey();
if (!key) {
  console.log("skip: no Jev key (set CUE_JEV_KEY or CUE_JEV_KEY_FILE, or put it in ~/.cue-secrets/jev.key)");
  process.exit(0);
}
const endpoint = systemOneEndpoint(EVAL_CONFIG.systemOneApiUrl);
const dir = repeat ? REPEAT_DIR : ANSWERS_DIR;
const pending = jobs.filter((job) => !readCached(dir, job.hash));
console.log(`to send: ${pending.length} (${jobs.length - pending.length} cached) -> ${dir}`);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function send(body: string): Promise<{ status: number; text: string; latencyMs: number; attempts: number }> {
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const started = performance.now();
    let status = 0;
    let text = "";
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(30_000),
      });
      status = response.status;
      text = await response.text();
    } catch (error) {
      text = error instanceof Error ? error.message : String(error);
    }
    const latencyMs = Math.round(performance.now() - started);
    if ((status === 429 || status === 529 || status === 0 || status >= 500) && attempts < 5) {
      await sleep(1000 * 2 ** (attempts - 1) + Math.floor(Math.random() * 500));
      continue;
    }
    return { status, text, latencyMs, attempts };
  }
}

let done = 0;
let failed = 0;
const queue = [...pending];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let job = queue.shift(); job; job = queue.shift()) {
    const result = await send(JSON.stringify(job.batch.body));
    let response: CachedAnswer["response"] = null;
    if (result.status >= 200 && result.status < 300) {
      try {
        response = JSON.parse(result.text) as CachedAnswer["response"];
      } catch {
        response = null;
      }
    }
    if (!response) {
      failed += 1;
      console.error(`  ${job.reply.id} #${job.index}: HTTP ${result.status} ${result.text.slice(0, 200)}`);
      continue;
    }
    writeCached(dir, job.hash, {
      replyId: job.reply.id,
      batch: job.index,
      paragraphs: job.batch.paragraphs,
      status: result.status,
      latencyMs: result.latencyMs,
      bytes: job.batch.bytes,
      attempts: result.attempts,
      response,
    });
    done += 1;
    if (done % 10 === 0) console.log(`  ${done}/${pending.length}`);
  }
}));
console.log(`sent=${done} failed=${failed}`);
