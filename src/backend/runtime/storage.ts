import type { SpindleAPI } from "lumiverse-spindle-types";
import { normalizeConfig, type VisualNovelConfig } from "../../config.js";
import { AssetJobSchema, SceneStateSchema, TurnPlanSchema, type AssetJob, type SceneState, type TurnPlan } from "../../shared/contracts.js";
import { parseProfiles } from "../core/visual-state.js";
import type { VisualProfileState } from "../core/visual-state.js";

export type StoredTurnRecord = {
  schemaVersion: 1;
  speaker: string;
  status: "planning" | "ready" | "failed" | "cancelled";
  plan: TurnPlan;
  jobs: AssetJob[];
  error?: string;
  updatedAt: string;
};

export type StoredChatState = {
  schemaVersion: 1;
  activeTurnPath: string | null;
  latestScene: SceneState | null;
  terminalContinuity: TurnPlan["terminalContinuity"] | null;
  updatedAt: string;
};

const writeTails = new Map<string, Promise<void>>();

function safeSegment(value: string): string {
  return encodeURIComponent(value).replaceAll("%", "_");
}

function scopedKey(userId: string | undefined, path: string): string {
  return `${userId ?? "owner"}:${path}`;
}

async function serializedWrite(taskKey: string, writer: () => Promise<void>): Promise<void> {
  const previous = writeTails.get(taskKey) ?? Promise.resolve();
  const current = previous.then(writer, writer);
  const tail = current.then(() => undefined, () => undefined);
  writeTails.set(taskKey, tail);
  try {
    await current;
  } finally {
    if (writeTails.get(taskKey) === tail) writeTails.delete(taskKey);
  }
}

function userOptions(userId?: string): { userId: string } | undefined {
  return userId ? { userId } : undefined;
}

export function turnPath(chatId: string, messageId: string, swipeId: string | number | null): string {
  return `turns/${safeSegment(chatId)}/${safeSegment(messageId)}/${safeSegment(String(swipeId ?? 0))}.json`;
}

export function chatStatePath(chatId: string): string {
  return `chats/${safeSegment(chatId)}/state.json`;
}

export function visualProfilePath(chatId: string): string {
  return `chats/${safeSegment(chatId)}/visual-state.json`;
}

export async function loadVisualProfiles(spindle: SpindleAPI, chatId: string, userId?: string): Promise<VisualProfileState> {
  const raw = await spindle.userStorage.getJson<unknown>(visualProfilePath(chatId), {
    fallback: {},
    ...(userOptions(userId) ?? {})
  });
  return parseProfiles(raw);
}

export async function saveVisualProfiles(
  spindle: SpindleAPI,
  chatId: string,
  profiles: VisualProfileState,
  userId?: string
): Promise<void> {
  const path = visualProfilePath(chatId);
  await serializedWrite(scopedKey(userId, path), () => spindle.userStorage.setJson(path, {
    schemaVersion: 1,
    profiles,
    updatedAt: new Date().toISOString()
  }, {
    indent: 2,
    ...(userOptions(userId) ?? {})
  }));
}

export async function loadConfig(spindle: SpindleAPI, userId?: string): Promise<VisualNovelConfig> {
  const raw = await spindle.userStorage.getJson<unknown>("config.json", {
    fallback: {},
    ...(userOptions(userId) ?? {})
  });
  return normalizeConfig(raw);
}

export async function updateConfig(
  spindle: SpindleAPI,
  patch: Partial<VisualNovelConfig>,
  userId?: string
): Promise<VisualNovelConfig> {
  const current = await loadConfig(spindle, userId);
  const next = normalizeConfig({ ...current, ...patch });
  await serializedWrite(scopedKey(userId, "config.json"), () => spindle.userStorage.setJson("config.json", next, {
    indent: 2,
    ...(userOptions(userId) ?? {})
  }));
  return next;
}

export async function loadChatState(spindle: SpindleAPI, chatId: string, userId?: string): Promise<StoredChatState> {
  const raw = await spindle.userStorage.getJson<Partial<StoredChatState>>(chatStatePath(chatId), {
    fallback: {},
    ...(userOptions(userId) ?? {})
  });
  return {
    schemaVersion: 1,
    activeTurnPath: typeof raw.activeTurnPath === "string" ? raw.activeTurnPath : null,
    latestScene: raw.latestScene ? SceneStateSchema.parse(raw.latestScene) : null,
    terminalContinuity: raw.terminalContinuity ? TurnPlanSchema.shape.terminalContinuity.parse(raw.terminalContinuity) : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString()
  };
}

export async function saveChatState(
  spindle: SpindleAPI,
  chatId: string,
  state: StoredChatState,
  userId?: string
): Promise<void> {
  const path = chatStatePath(chatId);
  await serializedWrite(scopedKey(userId, path), () => spindle.userStorage.setJson(path, state, {
    indent: 2,
    ...(userOptions(userId) ?? {})
  }));
}

export async function loadTurnRecord(
  spindle: SpindleAPI,
  path: string | null,
  userId?: string
): Promise<StoredTurnRecord | null> {
  if (!path) return null;
  const raw = await spindle.userStorage.getJson<Partial<StoredTurnRecord> | null>(path, {
    fallback: null,
    ...(userOptions(userId) ?? {})
  });
  if (!raw?.plan || typeof raw.speaker !== "string") return null;
  const status = raw.status === "planning" || raw.status === "failed" || raw.status === "cancelled" ? raw.status : "ready";
  return {
    schemaVersion: 1,
    speaker: raw.speaker,
    status,
    plan: TurnPlanSchema.parse(raw.plan),
    jobs: Array.isArray(raw.jobs) ? raw.jobs.map((job) => AssetJobSchema.parse(job)) : [],
    ...(typeof raw.error === "string" ? { error: raw.error } : {}),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString()
  };
}

export async function saveTurnRecord(
  spindle: SpindleAPI,
  path: string,
  record: StoredTurnRecord,
  userId?: string
): Promise<void> {
  await serializedWrite(scopedKey(userId, path), () => spindle.userStorage.setJson(path, record, {
    indent: 2,
    ...(userOptions(userId) ?? {})
  }));
}
