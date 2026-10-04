import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const CACHE_DIR = join(process.cwd(), ".cache", "jev-eval");
export const ANSWERS_DIR = join(CACHE_DIR, "answers");
export const REPEAT_DIR = join(CACHE_DIR, "answers-repeat");
export const RESULTS_DIR = join(CACHE_DIR, "results");

export type CachedAnswer = {
  replyId: string;
  batch: number;
  paragraphs: number[];
  status: number;
  latencyMs: number;
  bytes: number;
  attempts: number;
  response: { answers: Record<string, unknown>; usage?: { input_tokens?: number | null; output_tokens?: number | null }; model?: string } | null;
};

export function bodyHash(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 16);
}

export function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

export function readCached(dir: string, hash: string): CachedAnswer | null {
  const file = join(dir, `${hash}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as CachedAnswer;
}

export function writeCached(dir: string, hash: string, value: CachedAnswer): void {
  ensureDir(dir);
  writeFileSync(join(dir, `${hash}.json`), `${JSON.stringify(value, null, 1)}\n`);
}

/**
 * The live key: env CUE_JEV_KEY, else the file named by CUE_JEV_KEY_FILE,
 * else ~/.cue-secrets/jev.key. Never printed or written anywhere.
 */
export function readKey(): string | null {
  const fromEnv = process.env.CUE_JEV_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = process.env.CUE_JEV_KEY_FILE?.trim() || join(homedir(), ".cue-secrets", "jev.key");
  try {
    const key = readFileSync(file, "utf8").trim();
    return key || null;
  } catch {
    return null;
  }
}
