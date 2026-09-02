import { readdir, stat } from "node:fs/promises";
import path from "node:path";

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
  "bgm",
  "music",
  "ost",
  "soundtrack",
  "theme",
  "song",
  "melody",
  "instrumental",
  "background",
  "ambient",
  "ambience",
]);

const SFX_KEYWORDS = new Set([
  "sfx",
  "sound",
  "effect",
  "effects",
  "se",
  "foley",
  "hit",
  "impact",
  "step",
  "footstep",
  "click",
  "whoosh",
  "woosh",
  "blast",
  "explosion",
  "ui",
  "chime",
  "bell",
  "beep",
  "punch",
  "slash",
  "door",
  "creak",
  "gunshot",
]);

const NOISE_TOKENS = new Set([
  "audio",
  "track",
  "sound",
  "file",
  "media",
  "lumiverse",
  "preview",
]);

/**
 * Split text into lowercase tokens on whitespace, underscores, hyphens, dots,
 * slashes, and camelCase transitions.
 */
export function tokenizeText(input: string): string[] {
  // Split on camelCase transitions first
  const decamel = input.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  // Split on punctuation, separators, and spaces
  const rawTokens = decamel.toLowerCase().split(/[^a-z0-9]+/);
  return rawTokens.filter((token) => token.length > 0);
}

/**
 * Categorize an audio file into 'bgm' or 'sfx' based on directory and file name keywords.
 */
export function categorizeAudioFile(filePath: string, relativePath: string): AudioCategory {
  const normRel = relativePath.replace(/\\/g, "/");
  const segments = normRel.split("/").filter(Boolean);
  const dirSegments = segments.slice(0, -1);
  const fileName = path.parse(normRel).name;

  const dirTokens = dirSegments.flatMap(tokenizeText);
  const fileTokens = tokenizeText(fileName);

  // Check explicit filename indicators first if high confidence
  const fileHasSfx = fileTokens.some((t) => SFX_KEYWORDS.has(t));
  const fileHasBgm = fileTokens.some((t) => BGM_KEYWORDS.has(t));

  if (fileHasSfx && !fileHasBgm) return "sfx";
  if (fileHasBgm && !fileHasSfx) return "bgm";

  // Check directory tokens
  const dirHasSfx = dirTokens.some((t) => SFX_KEYWORDS.has(t));
  const dirHasBgm = dirTokens.some((t) => BGM_KEYWORDS.has(t));

  if (dirHasSfx && !dirHasBgm) return "sfx";
  if (dirHasBgm && !dirHasSfx) return "bgm";

  // If both or neither match, check filename again or default to bgm
  if (fileHasSfx) return "sfx";
  return "bgm";
}

/**
 * Extract semantic tags from an audio file's relative path, directory names, and file name.
 */
export function extractAudioTags(relativePath: string, category: AudioCategory): string[] {
  const normRel = relativePath.replace(/\\/g, "/");
  const fileName = path.parse(normRel).name;
  const segments = normRel.split("/").filter(Boolean);
  const dirSegments = segments.slice(0, -1);

  const tokens = [...dirSegments, fileName].flatMap(tokenizeText);
  const tags = new Set<string>();

  tags.add(category);

  for (const token of tokens) {
    if (token.length < 2) continue;
    if (/^\d+$/.test(token)) continue; // ignore pure numbers like 01, 02
    if (NOISE_TOKENS.has(token)) continue;
    if (category === "sfx" && (token === "sfx" || token === "se")) continue;
    if (category === "bgm" && (token === "bgm" || token === "ost")) continue;
    tags.add(token);
  }

  return Array.from(tags).sort();
}

let cachedCatalog: AudioCatalog = { bgm: [], sfx: [], all: [] };
let cachedDirectory: string = "";

/**
 * Recursively find all files in directory.
 */
async function collectFiles(currentDir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await collectFiles(fullPath);
        results.push(...subFiles);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  } catch {
    // If directory cannot be read, return what we have so far without crashing
  }
  return results;
}

/**
 * Recursively scan directory for audio files, categorize them into BGM/SFX,
 * extract tags, and cache in memory.
 */
export async function scanAudioCatalog(dir: string): Promise<AudioCatalog> {
  const trimmedDir = dir ? dir.trim() : "";
  if (!trimmedDir) {
    cachedCatalog = { bgm: [], sfx: [], all: [] };
    cachedDirectory = "";
    return cachedCatalog;
  }

  try {
    const dirStat = await stat(trimmedDir);
    if (!dirStat.isDirectory()) {
      cachedCatalog = { bgm: [], sfx: [], all: [] };
      cachedDirectory = trimmedDir;
      return cachedCatalog;
    }
  } catch {
    cachedCatalog = { bgm: [], sfx: [], all: [] };
    cachedDirectory = trimmedDir;
    return cachedCatalog;
  }

  const allFiles = await collectFiles(trimmedDir);
  const entries: AudioCatalogEntry[] = [];

  for (const fullPath of allFiles) {
    const ext = path.extname(fullPath).toLowerCase();
    if (!AUDIO_EXT_SET.has(ext)) continue;

    const relativePath = path.relative(trimmedDir, fullPath).replace(/\\/g, "/");
    const parsed = path.parse(relativePath);
    const name = parsed.name;
    const id = relativePath.replace(/\.[^.]+$/, "");

    const category = categorizeAudioFile(fullPath, relativePath);
    const tags = extractAudioTags(relativePath, category);

    entries.push({
      id,
      name,
      filePath: fullPath,
      relativePath,
      category,
      tags,
      url: fullPath,
    });
  }

  // Sort deterministically by id
  entries.sort((a, b) => a.id.localeCompare(b.id));

  const bgm = entries.filter((e) => e.category === "bgm");
  const sfx = entries.filter((e) => e.category === "sfx");

  cachedCatalog = { bgm, sfx, all: entries };
  cachedDirectory = trimmedDir;

  return cachedCatalog;
}

/**
 * Return currently cached audio catalog.
 */
export function getAudioCatalog(): AudioCatalog {
  return cachedCatalog;
}

/**
 * Clear in-memory catalog cache.
 */
export function clearAudioCatalogCache(): void {
  cachedCatalog = { bgm: [], sfx: [], all: [] };
  cachedDirectory = "";
}

/**
 * Find an entry in the catalog by exact id, name, or relative path (case-insensitive).
 */
export function findAudioEntry(query: string): AudioCatalogEntry | null {
  if (!query) return null;
  const normalized = query.trim().toLowerCase();
  const normalizedWithoutExt = normalized.replace(/\.[a-z0-9]+$/i, "");

  // 1. Check exact id match
  for (const entry of cachedCatalog.all) {
    if (entry.id.toLowerCase() === normalized || entry.id.toLowerCase() === normalizedWithoutExt) {
      return entry;
    }
  }

  // 2. Check name match
  for (const entry of cachedCatalog.all) {
    if (entry.name.toLowerCase() === normalized || entry.name.toLowerCase() === normalizedWithoutExt) {
      return entry;
    }
  }

  // 3. Check relative path match
  for (const entry of cachedCatalog.all) {
    if (entry.relativePath.toLowerCase() === normalized) {
      return entry;
    }
  }

  return null;
}

/**
 * Resolve an audio URL or file path for a given audio identifier or path.
 */
export function resolveAudioUrl(query: string): string | null {
  if (!query) return null;
  const entry = findAudioEntry(query);
  if (entry) return entry.filePath;

  // If already an absolute path, URL, or data URI, return as-is
  if (
    query.startsWith("http:") ||
    query.startsWith("https:") ||
    query.startsWith("data:") ||
    query.startsWith("file:") ||
    path.isAbsolute(query)
  ) {
    return query;
  }

  return null;
}
