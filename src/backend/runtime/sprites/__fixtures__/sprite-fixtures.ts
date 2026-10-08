import type { SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../../../../config.js";
import type { SpriteCastMember, SpriteStaging } from "../../../../shared/sprites.js";
import { plateKeyFor } from "../../../../shared/sprites.js";

/** A minimal PNG header (signature + IHDR); the bridge only reads the header. */
export function fakePng(width = 832, height = 1216, extraBytes = 64): Uint8Array {
  const bytes = new Uint8Array(33 + extraBytes);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  for (let index = 33; index < bytes.length; index += 1) bytes[index] = index % 251;
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export const CUT_META = { width: 832, height: 1216, bbox: [0.1, 0.02, 0.8, 0.98] as [number, number, number, number], quality: "best" as const, durationMs: 900 };

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise<void>((resolve) => setTimeout(resolve, 2));
  }
}

export type GenerateCall = { prompt: string; negativePrompt?: string; model?: string; parameters: Record<string, unknown>; includeDataUrl?: boolean; userId?: string; connection_id?: string };

export type MockSpindleOptions = {
  provider?: string;
  /** Hold every generate call until the test releases it. */
  gated?: boolean;
  failGenerate?: (call: GenerateCall) => string | null;
  failUpload?: boolean;
  /** Connection metadata (ComfyUI workflow config); a function that throws simulates a failed read. */
  metadata?: Record<string, unknown> | (() => Record<string, unknown>);
};

/** A spindle double for the sprite service: storage, image generation, upload/delete and frontend messages. */
export function mockSpindle(options: MockSpindleOptions = {}) {
  const data = new Map<string, unknown>();
  const sent: Array<Record<string, unknown> & { userId?: string }> = [];
  const calls: GenerateCall[] = [];
  const gates: Array<{ call: GenerateCall; release: () => void; fail: (message: string) => void }> = [];
  const uploads: Array<{ filename?: string; bytes: number; userId?: string }> = [];
  const deleted: string[] = [];
  let seq = 0;
  let failUpload = options.failUpload ?? false;
  const withMetadata = (connection: Record<string, unknown>): Record<string, unknown> => {
    const metadata = options.metadata;
    if (typeof metadata === "function") Object.defineProperty(connection, "metadata", { get: metadata, enumerable: true });
    else if (metadata) connection.metadata = metadata;
    return connection;
  };
  const spindle = {
    userStorage: {
      getJson: async (path: string, readOptions: { fallback: unknown; userId?: string }) => {
        const value = data.get(`${readOptions.userId ?? "owner"}:${path}`);
        return value === undefined ? readOptions.fallback : JSON.parse(JSON.stringify(value));
      },
      setJson: async (path: string, value: unknown, writeOptions: { userId?: string } = {}) => {
        data.set(`${writeOptions.userId ?? "owner"}:${path}`, JSON.parse(JSON.stringify(value)));
      },
    },
    imageGen: {
      getConnection: async () => withMetadata({ provider: options.provider ?? "comfyui", model: options.provider === "novelai" ? "nai-diffusion-4-5-full" : "sdxl" }),
      listConnections: async () => [withMetadata({ provider: options.provider ?? "comfyui", model: "m", is_default: true })],
      generate: async (input: GenerateCall) => {
        calls.push(input);
        seq += 1;
        const id = `raw-${seq}`;
        const result = {
          imageId: id,
          imageUrl: `/api/v1/images/${id}`,
          imageDataUrl: `data:image/png;base64,${toBase64(fakePng(8, 8, 4))}`,
          model: "m",
          provider: options.provider ?? "comfyui",
        };
        const failure = options.failGenerate?.(input);
        if (options.gated) {
          const gate = deferred<typeof result>();
          gates.push({ call: input, release: () => failure ? gate.reject(new Error(failure)) : gate.resolve(result), fail: (message) => gate.reject(new Error(message)) });
          return gate.promise;
        }
        if (failure) throw new Error(failure);
        return result;
      },
    },
    images: {
      upload: async (input: { data: Uint8Array; filename?: string }, userId?: string) => {
        if (failUpload) throw new Error("disk full");
        seq += 1;
        uploads.push({ ...(input.filename ? { filename: input.filename } : {}), bytes: input.data.length, ...(userId ? { userId } : {}) });
        return { id: `cut-${seq}`, url: `/api/v1/images/cut-${seq}` };
      },
      delete: async (imageId: string) => {
        deleted.push(imageId);
        return true;
      },
    },
    sendToFrontend: (message: Record<string, unknown>, userId?: string) => { sent.push({ ...message, ...(userId ? { userId } : {}) }); },
    log: { warn() {}, error() {}, info() {} },
  } as unknown as SpindleAPI;
  return {
    spindle, data, sent, calls, gates, uploads, deleted,
    setFailUpload: (value: boolean) => { failUpload = value; },
    of: <T extends string>(type: T) => sent.filter((message) => message.type === type),
  };
}

export function spriteConfig(patch: Partial<VisualNovelConfig> = {}): VisualNovelConfig {
  // The whole 12 set unless a test asks for another size (the default is 4).
  return { ...DEFAULT_CONFIG, presentationMode: "sprites", referenceAnchoring: false, imageConcurrency: 1, spriteExpressionCount: 12, ...patch };
}

export const MIRA: SpriteCastMember = { characterKey: "mira", name: "Mira", identity: "1girl, silver hair, green eyes", attire: "school uniform", subjectCategory: "female" };
export const KAI: SpriteCastMember = { characterKey: "kai", name: "Kai", identity: "1boy, black hair", attire: null, subjectCategory: "male" };

/** Two paragraphs: Mira smiles, then sheds happy tears (a rare expression); two places. */
export function sampleStaging(styleKey: string, cast: SpriteCastMember[] = [MIRA]): SpriteStaging {
  const observatory = plateKeyFor({ location: "Observatory", timeOfDay: "night" }, styleKey);
  const garden = plateKeyFor({ location: "Garden", timeOfDay: "night" }, styleKey);
  return {
    version: 1,
    source: "planner",
    cast,
    plates: [
      { plateKey: observatory, location: "Observatory", timeOfDay: "night", weather: null, description: "brass telescope" },
      { plateKey: garden, location: "Garden", timeOfDay: "night", weather: null, description: "rose garden" },
    ],
    paragraphs: [
      { actors: [{ characterKey: "mira", expression: "smile", slot: "center", facing: "viewer", focus: true, motion: "none", emote: "none", intensity: 3 }], plateKey: observatory, light: "night" },
      { actors: [{ characterKey: "mira", expression: "happy_tears", slot: "center", facing: "viewer", focus: true, motion: "none", emote: "none", intensity: 3 }], plateKey: garden, light: "night" },
    ],
  };
}
