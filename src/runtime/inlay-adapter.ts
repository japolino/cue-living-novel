import type { SpindleAPI } from "lumiverse-spindle-types";
import type { VisualNovelConfig } from "../config.js";
import {
  DEFAULT_CONFIG as INLAY_DEFAULT_CONFIG,
  normalizeConfig as normalizeInlayConfig,
  type Config as InlayConfig,
  type RawConfig as InlayRawConfig
} from "../inlay-image-pipeline/shared/config.js";
import { generateForMessage } from "../inlay-image-pipeline/backend/generation.js";
import type { GeneratedRecordV3 as InlayGeneratedRecord } from "../inlay-image-pipeline/backend/generated-record.js";

/**
 * Cue <- -> Inlay image-pipeline adapter.
 *
 * This module is the ONLY bridge between Cue's Living Novel presentation state
 * and the transplanted Inlay image-generation subsystem. It does three narrow
 * things and nothing else:
 *
 *   1. Maps Cue's VisualNovelConfig into a valid Inlay Config (defaulting the
 *      Inlay-only tuning knobs that Cue has no UI for).
 *   2. Provides Inlay a namespaced `spindle` host proxy so its storage/config
 *      paths cannot collide with Cue's, and captures the final GeneratedRecord
 *      that Inlay reports through `sendToFrontend({ type: "status", record })`.
 *   3. Maps Inlay GeneratedRecord slots (per-paragraph illustrations) into the
 *      per-paragraph background set Cue's presentation consumes.
 *
 * It deliberately does NOT reinterpret Inlay internals: parsing, memory,
 * visual-state, prompt construction, planning, generation sequencing, and
 * state updates all run in the transplanted tree untouched.
 */

const INLAY_STORAGE_PREFIX = "inlay/";

function qualified(path: string): string {
  return `${INLAY_STORAGE_PREFIX}${path}`;
}

/** Maps Cue's richer-but-different config into a valid Inlay Config. */
export function buildInlayConfig(cue: VisualNovelConfig, userId?: string): InlayConfig {
  const raw: InlayRawConfig = {
    enabled: cue.enabled,
    autoGenerate: true,
    parserConnectionId: cue.parserConnectionId,
    parserModel: "",
    parserParameters: { ...cue.parserParameters },
    imageConnectionId: cue.imageConnectionId,
    imageModel: cue.imageModel,
    imageParameters: { ...cue.imageParameters },
    includeCharacterInfo: cue.includeCharacterContext,
    includeUserInfo: cue.includePersonaContext,
    includeLorebook: cue.includeLorebookContext,
    includeMinMessages: 0,
    includeMaxMessages: cue.includeRecentMessages,
    // Cue shows one illustration per revealed paragraph; the Inlay defaults
    // below are deliberately conservative and stable across turns.
    minImages: Math.max(1, cue.maxImagesPerTurn),
    maxImages: Math.max(1, cue.maxImagesPerTurn),
    maxCharacters: 4,
    perspectiveMode: "dynamic",
    promptStyle: "default",
    promptSyntax: "comfyui",
    preprocessingEnabled: false,
    previousVisualStateEnabled: true,
    supplement: true,
    customParserInstructions: cue.customPlannerInstructions,
    customPositivePrefix: cue.promptPrefix,
    customPositiveSuffix: cue.promptSuffix,
    customNegative: cue.negativePrompt
  };
  return normalizeInlayConfig(raw);
}

/** A userStorage wrapper that prefixes every path into a Cue-safe namespace. */
function namespacedUserStorage(real: SpindleAPI["userStorage"]): SpindleAPI["userStorage"] {
  return {
    ...real,
    read: (path: string, userId?: string) => real.read(qualified(path), userId),
    write: (path: string, data: string, userId?: string) => real.write(qualified(path), data, userId),
    delete: (path: string, userId?: string) => real.delete(qualified(path), userId),
    list: (prefix?: string, userId?: string) => real.list(prefix ? qualified(prefix) : prefix, userId),
    exists: (path: string, userId?: string) => real.exists(qualified(path), userId),
    mkdir: (path: string, userId?: string) => real.mkdir(qualified(path), userId),
    move: (from: string, to: string, userId?: string) => real.move(qualified(from), qualified(to), userId),
    stat: (path: string, userId?: string) => real.stat(qualified(path), userId),
    getJson: <T>(path: string, options?: { fallback?: T; userId?: string }): Promise<T> =>
      real.getJson<T>(qualified(path), options),
    setJson: (path: string, value: unknown, options?: { indent?: number; userId?: string }): Promise<void> =>
      real.setJson(qualified(path), value, options)
  };
}

export type CueGeneratedImage = {
  /** The paragraph at which Cue shows this background. */
  paragraph: number;
  imageId: string;
  imageUrl: string;
  prompt: string;
  negativePrompt: string;
  status: "pending" | "generating" | "completed" | "failed" | "cancelled";
  placement: "cover" | "paragraph";
};

/**
 * Maps an Inlay GeneratedRecord into the flat per-paragraph image list Cue's
 * presentation consumes. This is pure projection: it reads Inlay slot fields and
 * returns Cue-shaped values. It does not derive or reinterpret Inlay state.
 */
export function mapInlaySlotsToCue(record: InlayGeneratedRecord | null): CueGeneratedImage[] {
  if (!record) return [];
  return record.slots.map((slot) => ({
    paragraph: slot.paragraph,
    imageId: slot.imageId,
    imageUrl: slot.imageUrl,
    prompt: slot.prompt,
    negativePrompt: slot.negativePrompt,
    status: slot.status,
    placement: slot.placement
  }));
}

/** A scoped Inlay `spindle` host proxy, safe for the duration of one generate call. */
function inlaySpindleAdapter(real: SpindleAPI, onRecord: (record: InlayGeneratedRecord) => void): SpindleAPI {
  const proxied = Object.create(real) as SpindleAPI;
  proxied.userStorage = namespacedUserStorage(real.userStorage);
  proxied.sendToFrontend = ((message: unknown, userId?: string) => {
    if (message && typeof message === "object") {
      const payload = message as { type?: unknown; record?: unknown };
      if (payload.type === "status" && payload.record) {
        onRecord(payload.record as InlayGeneratedRecord);
      }
    }
    return real.sendToFrontend(message, userId);
  }) as SpindleAPI["sendToFrontend"];
  return proxied;
}

let inlayGlobalMutex: Promise<void> = Promise.resolve();

/**
 * Runs the Inlay pipeline for one assistant message, returning the generated
 * images mapped into Cue's presentation model.
 */
export async function generateInlayImages(
  real: SpindleAPI,
  cueConfig: VisualNovelConfig,
  chatId: string,
  messageId: string,
  content: string,
  userId?: string
): Promise<CueGeneratedImage[]> {
  const messages = (await real.chat.getMessages(chatId)) as Array<{
    id: string; role: string; content: string; metadata?: Record<string, unknown>; swipe_id?: unknown;
  }>;

  let captured: InlayGeneratedRecord | null = null;
  const priorGlobal = (globalThis as Record<string, unknown>).spindle;
  // Serialize around the global-spindle swap so concurrent chat turns cannot race.
  const swapTail = inlayGlobalMutex;
  let swapRelease!: () => void;
  inlayGlobalMutex = swapTail.then(() => new Promise<void>((resolve) => { swapRelease = resolve; }));
  await swapTail;

  const adapter = inlaySpindleAdapter(real, (record) => { captured = record; });
  (globalThis as Record<string, unknown>).spindle = adapter;
  try {
    const inlayConfig = buildInlayConfig(cueConfig, userId);
    await generateForMessage(
      chatId,
      messageId,
      content,
      userId,
      { config: inlayConfig, messages }
    );
  } finally {
    (globalThis as Record<string, unknown>).spindle = priorGlobal;
    swapRelease();
  }

  return mapInlaySlotsToCue(captured);
}
