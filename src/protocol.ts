import type { VisualNovelConfig } from "./config.js";

export type FrontendRequest =
  | { type: "vn_get_state"; chatId?: string }
  | { type: "vn_get_connection_catalog" }
  | { type: "vn_set_config"; patch: Partial<VisualNovelConfig>; chatId?: string }
  | { type: "vn_submit"; chatId: string; content: string; requestId: string }
  | { type: "vn_asset_ready"; chatId: string; messageId: string; jobId: string; sourceFingerprint: string }
  | { type: "vn_cancel"; chatId: string }
  | { type: "vn_retry_turn"; chatId: string; messageId: string };

export type AssetView = {
  jobId: string;
  cueId: string;
  paragraphIndex: number;
  status: "queued" | "generating" | "generated" | "browser_ready" | "failed" | "cancelled";
  imageId?: string;
  imageUrl?: string;
  error?: string;
};

export type TurnView = {
  chatId: string;
  messageId: string;
  swipeId: number;
  sourceFingerprint: string;
  revision: number;
  speaker: string;
  paragraphs: string[];
  choices: Array<{ id: string; label: string; value: string }>;
  assets: AssetView[];
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
  | { type: "vn_error"; chatId?: string; operation: string; error: string };

export function isFrontendRequest(value: unknown): value is FrontendRequest {
  if (value === null || typeof value !== "object") return false;
  return typeof (value as { type?: unknown }).type === "string"
    && String((value as { type: string }).type).startsWith("vn_");
}
