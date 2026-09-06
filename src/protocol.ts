import type { VisualNovelConfig } from "./config.js";
import type { PanelArtifact } from "./shared/panels.js";

export type FrontendRequest =
  | { type: "vn_resolve_panel_template"; chatId: string; characterId?: string; requestId: string; template: string }
  | { type: "vn_get_state"; chatId?: string }
  | { type: "vn_get_connection_catalog" }
  | { type: "vn_set_config"; patch: Partial<VisualNovelConfig>; chatId?: string }
  | { type: "vn_submit"; chatId: string; content: string; requestId: string }
  | { type: "vn_asset_ready"; chatId: string; messageId: string; jobId: string; sourceFingerprint: string }
  | { type: "vn_cancel"; chatId: string }
  | { type: "vn_retry_turn"; chatId: string; messageId: string }
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
  | { type: "vn_import_audio_done"; fileCount: number };

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
  | { type: "vn_panel_template"; requestId: string; chatId: string; template?: string; error?: string }
  | { type: "vn_state"; chatId: string; config: VisualNovelConfig; turn: TurnView | null }
  | { type: "vn_config"; config: VisualNovelConfig }
  | {
    type: "vn_connection_catalog";
    planner: ConnectionCatalogOption[];
    image: ConnectionCatalogOption[];
    errors?: ConnectionCatalogErrors;
  }
  | { type: "vn_turn"; turn: TurnView }
  | { type: "vn_asset"; chatId: string; messageId: string; asset: AssetView }
  | { type: "vn_planning"; chatId: string }
  | { type: "vn_generation"; chatId: string; active: boolean; error?: string }
  | { type: "vn_permission"; permission: string; granted: boolean }
  | { type: "vn_audio_scanned"; bgmCount: number; sfxCount: number }
  | { type: "vn_error"; chatId?: string; operation: string; error: string };

export function isFrontendRequest(value: unknown): value is FrontendRequest {
  if (value === null || typeof value !== "object") return false;
  return typeof (value as { type?: unknown }).type === "string"
    && String((value as { type: string }).type).startsWith("vn_");
}
