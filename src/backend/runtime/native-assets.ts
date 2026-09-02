import type { CharacterDTO, ImageDTO, SpindleAPI } from "lumiverse-spindle-types";
import type { AssetJob, TurnPlan } from "../../shared/contracts.js";
import { extractInlineCardImagesWithParagraphs } from "../core/paragraphs.js";

/**
 * Resolve an image ID from a character's card extensions using the asset or expression name.
 * Checks:
 * 1. char.extensions.risu_asset_map
 * 2. char.extensions.lumirealm.asset_index
 * 3. char.extensions.lumirealm.emotion_index
 * 4. char.extensions.expressions.mappings
 */
export function resolveCharacterAssetImageId(character: CharacterDTO, assetName: string): string | null {
  if (!assetName || !character.extensions) return null;
  const normalized = assetName.trim().toLowerCase();
  const nameWithoutExt = normalized.replace(/\.[a-zA-Z0-9]+$/, "");

  // 1. Check risu_asset_map
  const risuMap = character.extensions["risu_asset_map"] as Record<string, string> | undefined;
  if (risuMap && typeof risuMap === "object") {
    for (const [key, id] of Object.entries(risuMap)) {
      if (typeof id !== "string" || !id) continue;
      const normKey = key.trim().toLowerCase();
      const keyWithoutExt = normKey.replace(/\.[a-zA-Z0-9]+$/, "");
      if (normKey === normalized || keyWithoutExt === nameWithoutExt) {
        return id;
      }
    }
  }

  // 2. Check lumirealm asset_index & emotion_index
  const lumirealm = character.extensions["lumirealm"] as Record<string, unknown> | undefined;
  if (lumirealm && typeof lumirealm === "object") {
    for (const indexKey of ["asset_index", "emotion_index"] as const) {
      const index = lumirealm[indexKey] as Record<string, unknown> | undefined;
      if (!index || typeof index !== "object") continue;

      for (const [key, val] of Object.entries(index)) {
        const normKey = key.trim().toLowerCase();
        const keyWithoutExt = normKey.replace(/\.[a-zA-Z0-9]+$/, "");
        if (normKey === normalized || keyWithoutExt === nameWithoutExt) {
          if (typeof val === "string" && val) return val;
          if (val && typeof val === "object" && "imageIds" in val) {
            const ids = (val as { imageIds?: string[] }).imageIds;
            if (Array.isArray(ids) && ids[0]) return ids[0];
          }
        }
      }
    }
  }

  // 3. Check expressions mappings
  const expressions = character.extensions["expressions"] as Record<string, unknown> | undefined;
  if (expressions && typeof expressions === "object") {
    const mappings = expressions["mappings"] as Record<string, string> | undefined;
    if (mappings && typeof mappings === "object") {
      for (const [key, id] of Object.entries(mappings)) {
        if (typeof id !== "string" || !id) continue;
        const normKey = key.trim().toLowerCase();
        const keyWithoutExt = normKey.replace(/\.[a-zA-Z0-9]+$/, "");
        if (normKey === normalized || keyWithoutExt === nameWithoutExt) {
          return id;
        }
      }
    }
  }

  return null;
}

/**
 * Resolve a fallback image ID for a character (default expression, avatar image, or first available asset).
 */
export function resolveCharacterFallbackImageId(character: CharacterDTO): string | null {
  // 1. Explicit character image_id (avatar)
  if (character.image_id) return character.image_id;

  // 2. Default expression from expressions extension
  const expressions = character.extensions?.["expressions"] as Record<string, unknown> | undefined;
  if (expressions && typeof expressions === "object") {
    const defaultExpr = expressions["defaultExpression"];
    const mappings = expressions["mappings"] as Record<string, string> | undefined;
    if (typeof defaultExpr === "string" && mappings && typeof mappings === "object" && mappings[defaultExpr]) {
      return mappings[defaultExpr];
    }
    if (mappings && typeof mappings === "object") {
      const firstExpr = Object.values(mappings)[0];
      if (firstExpr) return firstExpr;
    }
  }

  // 3. First asset from risu_asset_map
  const risuMap = character.extensions?.["risu_asset_map"] as Record<string, string> | undefined;
  if (risuMap && typeof risuMap === "object") {
    const firstId = Object.values(risuMap).find((id) => typeof id === "string" && id.length > 0);
    if (firstId) return firstId;
  }

  // 4. First asset from lumirealm asset_index
  const lumirealm = character.extensions?.["lumirealm"] as Record<string, unknown> | undefined;
  const assetIndex = lumirealm?.["asset_index"] as Record<string, unknown> | undefined;
  if (assetIndex && typeof assetIndex === "object") {
    for (const val of Object.values(assetIndex)) {
      if (typeof val === "string" && val) return val;
      if (val && typeof val === "object" && "imageIds" in val) {
        const ids = (val as { imageIds?: string[] }).imageIds;
        if (Array.isArray(ids) && ids[0]) return ids[0];
      }
    }
  }

  return null;
}

export type ResolveNativeCardJobsParams = {
  spindle: SpindleAPI;
  chatId: string;
  plan: TurnPlan;
  content: string;
  speakerName?: string | undefined;
  userId?: string | undefined;
};

/**
 * Build AssetJobs from native card assets matching inline markers or character avatar/expression fallback.
 */
export async function resolveNativeCardJobs(params: ResolveNativeCardJobsParams): Promise<AssetJob[]> {
  const { spindle, chatId, plan, content, speakerName, userId } = params;
  const now = new Date().toISOString();

  // 1. Locate character for this turn
  let character: CharacterDTO | null = null;
  try {
    const chat = await spindle.chats.get(chatId, userId);
    if (chat?.character_id) {
      character = await spindle.characters.get(chat.character_id, userId);
    }
  } catch {
    // Non-fatal, fallback to listing characters
  }

  if (!character) {
    try {
      const charRes = await spindle.characters.list(userId ? { userId } : undefined);
      const characters = Array.isArray(charRes) ? charRes : charRes.data;
      character = characters.find((c) => c.name.toLowerCase() === (speakerName || "").toLowerCase())
        || characters[0]
        || null;
    } catch {
      // Non-fatal
    }
  }

  if (!character) return [];

  // Helper to fetch ImageDTO or fallback to standard path
  async function getImage(id: string): Promise<Pick<ImageDTO, "id" | "url">> {
    try {
      const found = await spindle.images.get(id, userId);
      if (found?.url) return found;
    } catch {
      // Non-fatal
    }
    return { id, url: `/api/v1/images/${id}` };
  }

  const jobs: AssetJob[] = [];
  const inlineImages = extractInlineCardImagesWithParagraphs(content, plan.paragraphs);

  // Map each inline image reference to a job
  for (const [idx, item] of inlineImages.entries()) {
    const resolvedId = resolveCharacterAssetImageId(character, item.name);
    if (!resolvedId) continue;

    const img = await getImage(resolvedId);
    jobs.push({
      jobId: `native-${plan.key.sourceFingerprint.slice(0, 8)}-${idx}`,
      ownerTurnKey: plan.key,
      sceneId: plan.scenes[0]?.sceneId ?? "scene-0",
      sceneRevision: 1,
      paragraphIndex: item.paragraphIndex,
      promptFingerprint: plan.key.sourceFingerprint,
      provider: "native_card",
      priority: idx === 0 ? "visible" : "next",
      status: "browser_ready",
      imageId: img.id,
      imageUrl: img.url,
      error: null,
      queuedAt: now,
      startedAt: now,
      generatedAt: now,
      readyAt: now,
      finishedAt: now,
    });
  }

  // If no inline images were found or matched, fallback to default expression or avatar at paragraph 0
  if (jobs.length === 0) {
    const fallbackId = resolveCharacterFallbackImageId(character);
    if (fallbackId) {
      const img = await getImage(fallbackId);
      jobs.push({
        jobId: `native-${plan.key.sourceFingerprint.slice(0, 8)}-fallback`,
        ownerTurnKey: plan.key,
        sceneId: plan.scenes[0]?.sceneId ?? "scene-0",
        sceneRevision: 1,
        paragraphIndex: 0,
        promptFingerprint: plan.key.sourceFingerprint,
        provider: "native_card",
        priority: "visible",
        status: "browser_ready",
        imageId: img.id,
        imageUrl: img.url,
        error: null,
        queuedAt: now,
        startedAt: now,
        generatedAt: now,
        readyAt: now,
        finishedAt: now,
      });
    }
  }

  return jobs;
}
