import type { VisualNovelConfig } from "./config.js";
import type { PanelArtifact } from "./shared/panels.js";
import type { CueImageRequest, CueImageResult } from "./shared/cue-images.js";
import type { PlateView, SpriteCutMeta, SpriteImageView, SpriteSetView, SpriteTurnView } from "./shared/sprites.js";

export type FrontendRequest =
  | { type: "vn_external_image"; request: CueImageRequest }
  | { type: "vn_external_image_cancel"; request: Pick<CueImageRequest, "version" | "provider" | "chatId" | "requestId"> }
  | { type: "vn_resolve_panel_template"; chatId: string; characterId?: string; requestId: string; template: string }
  /**
   * Announce whether the Cue view is open for a chat. The backend only plans
   * turns and generates images for chats whose view is open; closing the view
   * aborts the in-flight batch. Idempotent; repeats are no-ops.
   */
  | { type: "vn_view"; chatId: string; open: boolean }
  /**
   * `viewOpen` repeats the view announcement on the state request itself.
   * True opens the view, false closes it; absent changes nothing (a state
   * request that says nothing about the view never opens it).
   */
  | { type: "vn_get_state"; chatId?: string; viewOpen?: boolean }
  | { type: "vn_get_connection_catalog" }
  | { type: "vn_get_system_one_key_status" }
  | { type: "vn_set_system_one_key"; key: string }
  | { type: "vn_clear_system_one_key" }
  | { type: "vn_set_config"; patch: Partial<VisualNovelConfig>; chatId?: string }
  | { type: "vn_submit"; chatId: string; content: string; requestId: string }
  | { type: "vn_asset_ready"; chatId: string; messageId: string; jobId: string; sourceFingerprint: string }
  | { type: "vn_cancel"; chatId: string }
  | { type: "vn_retry_turn"; chatId: string; messageId: string }
  /** Re-check the chat's latest assistant message (macro selection may have changed). */
  | { type: "vn_refresh"; chatId: string }
  | { type: "vn_scan_audio"; directory?: string }
  | {
      type: "vn_import_audio_file";
      relativePath: string;
      dataBase64: string;
      /** Set when a file is split to fit the host's 4 MB message limit. */
      transferId?: string;
      chunkIndex?: number;
      chunkCount?: number;
    }
  | { type: "vn_import_audio_done"; fileCount: number }
  | {
      /**
       * Reply to a `vn_reference_fetch`: the frontend fetched the card asset
       * bytes and relays them as a base64 data URL. Exactly one of `dataUrl`
       * and `error` is set. The backend cannot read image bytes itself
       * (`spindle.images.get` only returns a URL), so the logged-in frontend
       * does the fetch.
       */
      type: "vn_reference_image";
      requestId: string;
      dataUrl?: string;
      error?: string;
    }
  /**
   * Sprite mode: reply to `vn_sprite_cut`. The cut-out PNG (base64, no data
   * URL prefix) arrives in ordered chunks of at most SPRITE_CUT_CHUNK_CHARS;
   * `meta` rides on chunk 0. A failure is one message with `error` set.
   */
  | {
      type: "vn_sprite_cut_result";
      requestId: string;
      chunkIndex: number;
      chunkCount: number;
      dataBase64?: string;
      meta?: SpriteCutMeta;
      error?: string;
    }
  /** Sprite mode: ask for the whole sprite library (sets and plates). */
  | { type: "vn_get_sprite_library" }
  /** Sprite mode: library actions from settings or the stage. */
  | {
      type: "vn_sprite_action";
      action: "prepare_chat" | "regenerate" | "recut" | "delete_set" | "regenerate_plate" | "delete_plate";
      chatId?: string;
      setKey?: string;
      expression?: string;
      plateKey?: string;
    };

/** Upper bound for a relayed reference image (decoded bytes, checked on both sides). */
export const REFERENCE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const REFERENCE_IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/avif"]);

export type AssetView = {
  jobId: string;
  cueId: string;
  paragraphIndex: number;
  status: "queued" | "generating" | "generated" | "browser_ready" | "failed" | "cancelled";
  imageId?: string;
  imageUrl?: string;
  error?: string;
  /**
   * "cache": an extra swap beyond the image cap, served from the temporary
   * scene-image cache without a provider request. Such assets are always
   * terminal; they never count toward generation progress or retry wording.
   */
  source?: "cache";
};

export type AudioCueView = {
  paragraphIndex: number;
  bgm?: string | null;
  sfx?: string | null;
  bgmUrl?: string | null;
  sfxUrl?: string | null;
};

export type TurnView = {
  chatId: string;
  messageId: string;
  swipeId: number;
  sourceFingerprint: string;
  revision: number;
  speaker: string;
  userSpeaker?: string;
  paragraphs: string[];
  panels?: PanelArtifact[];
  panelSource?: string;
  /** Per-paragraph nameplate override; null entries fall back to `speaker`. */
  paragraphSpeakers?: Array<string | null>;
  /** Per-paragraph one-shot stage effect ids; null entries mean no effect. */
  effects?: Array<string | null>;
  /** Per-paragraph persistent ambient effect ids; null entries mean no ambient. */
  ambients?: Array<string | null>;
  choices: Array<{ id: string; label: string; value: string }>;
  assets: AssetView[];
  audioCues?: AudioCueView[];
  /** Sprite mode only: per-paragraph staging plus the sprite sets and plates it uses. */
  sprites?: SpriteTurnView;
  status: "planning" | "ready" | "failed" | "cancelled";
  error?: string;
};

export type ConnectionCatalogOption = {
  id: string;
  name: string;
  provider: string;
  model: string;
  isDefault: boolean;
};

export type ConnectionCatalogErrors = {
  planner?: string;
  image?: string;
};

export type BackendResponse =
  | { type: "vn_external_image"; result: CueImageResult }
  | { type: "vn_panel_template"; requestId: string; chatId: string; template?: string; error?: string }
  | { type: "vn_state"; chatId: string; config: VisualNovelConfig; turn: TurnView | null }
  | { type: "vn_config"; config: VisualNovelConfig }
  | { type: "vn_system_one_key_status"; saved: boolean }
  | {
    type: "vn_connection_catalog";
    planner: ConnectionCatalogOption[];
    image: ConnectionCatalogOption[];
    errors?: ConnectionCatalogErrors;
  }
  | { type: "vn_turn"; turn: TurnView }
  | { type: "vn_asset"; chatId: string; messageId: string; asset: AssetView }
  | { type: "vn_planning"; chatId: string }
  /**
   * The latest assistant message has no narrative left after macro
   * resolution (an unselected multi-scene greeting). Nothing was planned and
   * no images were made; the user picks a scene in the chat first.
   */
  | { type: "vn_waiting"; chatId: string; messageId: string; reason: "greeting_unselected" }
  | { type: "vn_generation"; chatId: string; active: boolean; error?: string }
  | { type: "vn_permission"; permission: string; granted: boolean }
  | { type: "vn_audio_scanned"; bgmCount: number; sfxCount: number }
  | {
      /**
       * Ask the frontend to fetch `/api/v1/images/<imageId>` (same origin,
       * with credentials) and reply with `vn_reference_image` carrying the
       * matching `requestId`. Used only when `referenceSource` is "card".
       */
      type: "vn_reference_fetch";
      chatId: string;
      requestId: string;
      imageId: string;
      characterKey: string;
    }
  /**
   * Sprite mode: cut a generated sprite. The frontend fetches
   * `/api/v1/images/<imageId>` (same origin), removes the white background,
   * and answers with `vn_sprite_cut_result` chunks carrying `requestId`.
   */
  | { type: "vn_sprite_cut"; requestId: string; imageId: string; setKey: string; expression: string }
  /** Sprite mode: one sprite image changed state (any chat; apply when the set is on stage). */
  | { type: "vn_sprite_update"; setKey: string; image: SpriteImageView }
  /** Sprite mode: one background plate changed state. */
  | { type: "vn_plate_update"; plate: PlateView }
  /** Sprite mode: the whole library, answering `vn_get_sprite_library` or after a library action. */
  | { type: "vn_sprite_library"; sets: SpriteSetView[]; plates: PlateView[] }
  | { type: "vn_error"; chatId?: string; operation: string; error: string };

export function isFrontendRequest(value: unknown): value is FrontendRequest {
  if (value === null || typeof value !== "object") return false;
  return typeof (value as { type?: unknown }).type === "string"
    && String((value as { type: string }).type).startsWith("vn_");
}
