import type { SpindleAPI } from "lumiverse-spindle-types";

export type AudioCategory = "bgm" | "sfx";

export type AudioCatalogEntry = {
  id: string;
  name: string;
  filePath: string;
  relativePath: string;
  category: AudioCategory;
  tags: string[];
  url?: string;
};

export type AudioCatalog = {
  bgm: AudioCatalogEntry[];
  sfx: AudioCatalogEntry[];
  all: AudioCatalogEntry[];
};

export const SUPPORTED_AUDIO_EXTENSIONS = [".mp3", ".ogg", ".wav", ".m4a", ".flac"] as const;
const AUDIO_EXT_SET = new Set<string>(SUPPORTED_AUDIO_EXTENSIONS);

const BGM_KEYWORDS = new Set([
  "bgm", "music", "ost", "soundtrack", "theme", "song", "melody",
  "instrumental", "background", "ambient", "ambience",
]);

const SFX_KEYWORDS = new Set([
  "sfx", "sound", "effect", "effects", "se", "foley", "hit", "impact",
  "step", "footstep", "click", "whoosh", "woosh", "blast", "explosion",
  "ui", "chime", "bell", "beep", "punch", "slash", "door", "creak", "gunshot",
]);

const NOISE_TOKENS = new Set(["audio", "track", "sound", "file", "media", "lumiverse", "preview"]);

function normalizedPath(input: string): string {
  return input.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}

function extensionOf(input: string): string {
  const name = normalizedPath(input).split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function stemOf(input: string): string {
  const name = normalizedPath(input).split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function joinStoragePath(prefix: string, relativePath: string): string {
  return [prefix.replace(/^\/+|\/+$/g, ""), relativePath.replace(/^\/+/, "")]
    .filter(Boolean)
    .join("/");
}

/**
 * Lumiverse extensions cannot access arbitrary host paths. Audio lives under
 * the extension's scoped storage root. Absolute legacy values fall back to the
 * conventional `audio/` storage prefix.
 */
export function normalizeAudioStoragePrefix(input: string): string {
  const value = normalizedPath(input.trim()).replace(/^\/+|\/+$/g, "");
  if (!value || /^[A-Za-z]:\//.test(normalizedPath(input.trim())) || input.trim().startsWith("/")) {
    return "audio";
  }
  if (value.split("/").some((part) => part === "..")) return "audio";
  return value;
}

export function tokenizeText(input: string): string[] {
  const decamel = input.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return decamel.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function categorizeAudioFile(_filePath: string, relativePath: string): AudioCategory {
  const normRel = normalizedPath(relativePath);
  const segments = normRel.split("/").filter(Boolean);
  const dirTokens = segments.slice(0, -1).flatMap(tokenizeText);
  const fileTokens = tokenizeText(stemOf(normRel));
  const fileHasSfx = fileTokens.some((token) => SFX_KEYWORDS.has(token));
  const fileHasBgm = fileTokens.some((token) => BGM_KEYWORDS.has(token));
  if (fileHasSfx && !fileHasBgm) return "sfx";
  if (fileHasBgm && !fileHasSfx) return "bgm";
  const dirHasSfx = dirTokens.some((token) => SFX_KEYWORDS.has(token));
  const dirHasBgm = dirTokens.some((token) => BGM_KEYWORDS.has(token));
  if (dirHasSfx && !dirHasBgm) return "sfx";
  if (dirHasBgm && !dirHasSfx) return "bgm";
  return fileHasSfx ? "sfx" : "bgm";
}

export function extractAudioTags(relativePath: string, category: AudioCategory): string[] {
  const normRel = normalizedPath(relativePath);
  const segments = normRel.split("/").filter(Boolean);
  const tokens = [...segments.slice(0, -1), stemOf(normRel)].flatMap(tokenizeText);
  const tags = new Set<string>([category]);
  for (const token of tokens) {
    if (token.length < 2 || /^\d+$/.test(token) || NOISE_TOKENS.has(token)) continue;
    if (category === "sfx" && (token === "sfx" || token === "se")) continue;
    if (category === "bgm" && (token === "bgm" || token === "ost")) continue;
    tags.add(token);
  }
  return [...tags].sort();
}

function mimeForExtension(extension: string): string {
  switch (extension) {
    case ".mp3": return "audio/mpeg";
    case ".ogg": return "audio/ogg";
    case ".wav": return "audio/wav";
    case ".m4a": return "audio/mp4";
    case ".flac": return "audio/flac";
    default: return "application/octet-stream";
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const parts: string[] = [];
  const chunk: string[] = [];
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const packed = (first << 16) | (second << 8) | third;
    chunk.push(
      alphabet[(packed >>> 18) & 63]!,
      alphabet[(packed >>> 12) & 63]!,
      index + 1 < bytes.length ? alphabet[(packed >>> 6) & 63]! : "=",
      index + 2 < bytes.length ? alphabet[packed & 63]! : "=",
    );
    if (chunk.length >= 8192) {
      parts.push(chunk.join(""));
      chunk.length = 0;
    }
  }
  if (chunk.length > 0) parts.push(chunk.join(""));
  return parts.join("");
}

let cachedCatalog: AudioCatalog = { bgm: [], sfx: [], all: [] };
let cachedPrefix = "";

type PackTrackMeta = {
  name?: string | undefined;
  tags?: string[] | undefined;
  category?: AudioCategory | undefined;
};

/**
 * Scan audio files through Lumiverse's scoped storage API. No host filesystem
 * module or Bun.file access is used. The binary is converted to a browser-safe
 * data URL once during catalog creation.
 */
export async function scanAudioCatalog(spindle: SpindleAPI, requestedPrefix = "audio"): Promise<AudioCatalog> {
  const prefix = normalizeAudioStoragePrefix(requestedPrefix);
  if (cachedPrefix === prefix && cachedCatalog.all.length > 0) return cachedCatalog;

  let files: string[];
  try {
    files = await spindle.storage.list(prefix);
  } catch {
    cachedCatalog = { bgm: [], sfx: [], all: [] };
    cachedPrefix = prefix;
    return cachedCatalog;
  }

  // Attempt to read pack.json for rich English names, mood descriptions, and tags
  const packMetadata: Record<string, PackTrackMeta> = {};
  try {
    const packJsonPath = joinStoragePath(prefix, "pack.json");
    let rawPack: string | undefined;
    if (typeof spindle.storage.read === "function") {
      rawPack = await spindle.storage.read(packJsonPath);
    } else if (typeof spindle.storage.readBinary === "function") {
      const bytes = await spindle.storage.readBinary(packJsonPath);
      rawPack = new TextDecoder().decode(bytes);
    }
    const parsed = rawPack ? JSON.parse(rawPack) as { tracks?: { bgm?: unknown[]; sfx?: unknown[] } } : null;
    if (parsed && typeof parsed === "object" && parsed.tracks) {
      for (const cat of ["bgm", "sfx"] as const) {
        const list = parsed.tracks[cat];
        if (Array.isArray(list)) {
          for (const item of list) {
            if (item && typeof item === "object") {
              const rec = item as Record<string, unknown>;
              const fileKey = typeof rec.file === "string" ? normalizedPath(rec.file).toLowerCase() : "";
              const idKey = typeof rec.id === "string" ? rec.id.toLowerCase() : "";
              const nameKey = typeof rec.name === "string" ? rec.name.toLowerCase() : "";
              const meta: PackTrackMeta = {
                name: typeof rec.name === "string" ? rec.name : undefined,
                tags: Array.isArray(rec.tags) ? rec.tags.filter((t): t is string => typeof t === "string") : [],
                category: cat
              };
              if (fileKey) packMetadata[fileKey] = meta;
              if (idKey) packMetadata[idKey] = meta;
              if (nameKey) packMetadata[nameKey] = meta;
            }
          }
        }
      }
    }
  } catch {
    // pack.json is optional; continue if missing or invalid
  }

  const entries: AudioCatalogEntry[] = [];
  for (const listedPath of files) {
    const relativePath = normalizedPath(listedPath);
    const extension = extensionOf(relativePath);
    if (!AUDIO_EXT_SET.has(extension)) continue;
    const storagePath = joinStoragePath(prefix, relativePath);
    try {
      const bytes = await spindle.storage.readBinary(storagePath);
      const relLower = relativePath.toLowerCase();
      const stemLower = stemOf(relativePath).toLowerCase();
      const meta = packMetadata[relLower] ?? packMetadata[stemLower];
      const category = meta?.category ?? categorizeAudioFile(storagePath, relativePath);
      const name = meta?.name ?? stemOf(relativePath);
      const tags = Array.from(new Set([
        ...extractAudioTags(relativePath, category),
        ...(meta?.tags ?? []).map((t) => t.toLowerCase())
      ])).sort();

      entries.push({
        id: relativePath.replace(/\.[^.]+$/, ""),
        name,
        filePath: storagePath,
        relativePath,
        category,
        tags,
        url: `data:${mimeForExtension(extension)};base64,${bytesToBase64(bytes)}`,
      });
    } catch {
      // A single unreadable file must not prevent the rest of the pack loading.
    }
  }

  entries.sort((left, right) => left.id.localeCompare(right.id));
  cachedCatalog = {
    bgm: entries.filter((entry) => entry.category === "bgm"),
    sfx: entries.filter((entry) => entry.category === "sfx"),
    all: entries,
  };
  cachedPrefix = prefix;
  return cachedCatalog;
}

export function getAudioCatalog(): AudioCatalog {
  return cachedCatalog;
}

export function clearAudioCatalogCache(): void {
  cachedCatalog = { bgm: [], sfx: [], all: [] };
  cachedPrefix = "";
}

function cleanAudioToken(input: string): string {
  return input
    .toLowerCase()
    .replace(/^[0-9]+[_\-=]/, "")
    .replace(/（[^）]*）|\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Resolve an audio query to a catalog entry. Supports exact id/name matching,
 * normalized titles (stripping leading indices and Japanese parentheticals),
 * substring matching, and semantic mood/action tag scoring.
 */
export function findAudioEntry(query: string, preferredCategory?: AudioCategory): AudioCatalogEntry | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const normalized = normalizedPath(trimmed).toLowerCase();
  const withoutExtension = normalized.replace(/\.[a-z0-9]+$/i, "");
  const pool = cachedCatalog.all;
  if (pool.length === 0) return null;

  // 1. Exact match on id, name, relativePath, or stem
  const exact = pool.find((entry) => {
    return entry.id.toLowerCase() === normalized
      || entry.id.toLowerCase() === withoutExtension
      || entry.name.toLowerCase() === normalized
      || entry.name.toLowerCase() === withoutExtension
      || entry.relativePath.toLowerCase() === normalized
      || stemOf(entry.relativePath).toLowerCase() === normalized
      || stemOf(entry.relativePath).toLowerCase() === withoutExtension;
  });
  if (exact) return exact;

  // 2. Normalized match (ignoring numeric prefixes, parentheticals, punctuation)
  const cleanedQuery = cleanAudioToken(withoutExtension);
  if (cleanedQuery.length >= 2) {
    const candidate = pool.find((entry) => {
      if (preferredCategory && entry.category !== preferredCategory) return false;
      const cleanName = cleanAudioToken(entry.name);
      const cleanId = cleanAudioToken(entry.id);
      return cleanName === cleanedQuery || cleanId === cleanedQuery;
    });
    if (candidate) return candidate;
  }

  // 3. Substring match
  if (normalized.length >= 3) {
    const subMatch = pool.find((entry) => {
      if (preferredCategory && entry.category !== preferredCategory) return false;
      const entryNameLower = entry.name.toLowerCase();
      const entryIdLower = entry.id.toLowerCase();
      return entryNameLower.includes(normalized) || normalized.includes(entryNameLower)
        || entryIdLower.includes(normalized) || normalized.includes(entryIdLower);
    });
    if (subMatch) return subMatch;
  }

  // 4. Semantic / mood tag scoring match
  const tokens = cleanedQuery ? cleanedQuery.split(/\s+/).filter(Boolean) : tokenizeText(normalized);
  if (tokens.length > 0) {
    let bestScore = 0;
    let bestEntry: AudioCatalogEntry | null = null;
    for (const entry of pool) {
      let score = 0;
      for (const token of tokens) {
        if (token.length < 2) continue;
        if (entry.tags.includes(token)) {
          score += 4;
        } else if (entry.tags.some((t) => t.includes(token) || token.includes(t))) {
          score += 2;
        }
        if (entry.name.toLowerCase().includes(token)) {
          score += 2;
        }
      }
      if (score > 0) {
        if (preferredCategory && entry.category === preferredCategory) {
          score += 3;
        }
        if (score > bestScore) {
          bestScore = score;
          bestEntry = entry;
        }
      }
    }
    if (bestScore >= 3 && bestEntry) {
      return bestEntry;
    }
  }

  return null;
}

export function resolveAudioUrl(query: string, category?: AudioCategory): string | null {
  if (!query) return null;
  const entry = findAudioEntry(query, category);
  if (entry?.url) return entry.url;
  return /^(?:https?:|data:|blob:)/i.test(query) ? query : null;
}

/**
 * Build a concise, mood-categorized summary of the audio catalog suitable for
 * inclusion in planner prompting.
 */
export function getAudioCatalogPromptSummary(): { bgmLines: string[]; sfxSamples: string[] } {
  const catalog = getAudioCatalog();
  const moodBuckets: Record<string, string[]> = {
    "peaceful / daily / cozy": ["peaceful", "daily", "calm", "home", "cozy", "gentle", "ambient", "day"],
    "romantic / intimate / tender": ["romantic", "love", "tender", "intimate", "acoustic", "night", "warm"],
    "emotional / melancholy / sad": ["melancholy", "sad", "emotional", "tears", "lonely", "sorrow", "rain"],
    "playful / cheerful / comedic": ["playful", "comedic", "cheerful", "fun", "panic", "bright", "summer"],
    "suspense / tension / mystery": ["tension", "suspense", "mystery", "dark", "unease", "ominous", "eerie"],
    "action / battle / dramatic": ["battle", "action", "epic", "intense", "confrontation", "speed", "duel"]
  };

  const assigned: Record<string, string[]> = {};
  for (const mood of Object.keys(moodBuckets)) assigned[mood] = [];

  for (const entry of catalog.bgm) {
    const entryTags = new Set(entry.tags);
    for (const [mood, keywords] of Object.entries(moodBuckets)) {
      if (keywords.some((kw) => entryTags.has(kw) || entry.name.toLowerCase().includes(kw))) {
        if (assigned[mood] && assigned[mood].length < 4 && !assigned[mood].includes(entry.name)) {
          assigned[mood].push(entry.name);
        }
        break;
      }
    }
  }

  const bgmLines: string[] = [];
  for (const [mood, tracks] of Object.entries(assigned)) {
    if (tracks.length > 0) {
      bgmLines.push(`  * ${mood}: [${tracks.join(", ")}]`);
    }
  }
  if (bgmLines.length === 0 && catalog.bgm.length > 0) {
    bgmLines.push(`  * Available BGM: [${catalog.bgm.slice(0, 20).map((e) => e.name).join(", ")}]`);
  }

  const sfxSamples = catalog.sfx.slice(0, 25).map((e) => e.name);
  return { bgmLines, sfxSamples };
}
