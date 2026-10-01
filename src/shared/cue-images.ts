// Versioned window bridge. Scene data only: character appearance belongs to Cue.
export const CUE_IMAGE_REQUEST = "vn-scene-image-request-v1";
export const CUE_IMAGE_RESULT = "vn-scene-image-result-v1";
export const CUE_IMAGE_CANCEL = "vn-scene-image-cancel-v1";
export const CUE_IMAGE_FIT = "vn-scene-image-fit-v1";
export const IMAGE_FITS = ["cover", "contain", "fill", "none", "scale-down"] as const;
export type ImageFit = (typeof IMAGE_FITS)[number];
export interface CueImageRequest {
  version: 1; provider: "warp"; chatId: string; requestId: string;
  characterName: string; venue: string | null; timeOfDay: string | null; mood: string | null;
}
export type CueImageResult = Pick<CueImageRequest, "version" | "provider" | "chatId" | "requestId"> & (
  { status: "accepted" } | { status: "ready"; imageUrl: string; fit: ImageFit } | { status: "error"; error: string }
);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, n: number): v is string => typeof v === "string" && !!v.trim() && v.length <= n;
export function imageIdentity(v: unknown): v is Record<string, unknown> & Pick<CueImageRequest, "version" | "provider" | "chatId" | "requestId"> {
  return record(v) && v.version === 1 && v.provider === "warp" && text(v.chatId, 128) && text(v.requestId, 128);
}
export function parseImageRequest(v: unknown): CueImageRequest | null {
  if (!imageIdentity(v) || !record(v)) return null;
  if (Object.keys(v).some((k) => !["version", "provider", "chatId", "requestId", "characterName", "venue", "timeOfDay", "mood"].includes(k))) return null;
  if (!text(v.characterName, 160)) return null;
  for (const k of ["venue", "timeOfDay", "mood"]) if (v[k] !== null && !text(v[k], 160)) return null;
  return v as unknown as CueImageRequest;
}
export function parseImageResult(v: unknown): CueImageResult | null {
  if (!imageIdentity(v) || !record(v)) return null;
  if (v.status === "accepted") return v as unknown as CueImageResult;
  if (v.status === "error" && text(v.error, 1000)) return v as unknown as CueImageResult;
  if (v.status === "ready" && text(v.imageUrl, 4000) && /^(https?:\/\/|\/api\/v1\/images\/)/i.test(v.imageUrl)
      && IMAGE_FITS.includes(v.fit as ImageFit)) return v as unknown as CueImageResult;
  return null;
}
