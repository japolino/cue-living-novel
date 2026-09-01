import type { SpindleAPI } from "lumiverse-spindle-types";
import type { VisualNovelConfig } from "../config.js";

export type CueGeneratedImage = {
  paragraph: number;
  imageId: string;
  imageUrl: string;
  prompt: string;
  negativePrompt: string;
  status: "pending" | "generating" | "completed" | "failed" | "cancelled";
  placement: "cover" | "paragraph";
  error?: string;
};

export type InlayConfigLike = Record<string, unknown>;

export function generateInlayImages(
  real: SpindleAPI,
  cueConfig: VisualNovelConfig,
  chatId: string,
  messageId: string,
  content: string,
  userId?: string
): Promise<CueGeneratedImage[]>;

export function buildInlayConfig(cue: VisualNovelConfig, userId?: string): InlayConfigLike;

export function mapInlaySlotsToCue(record: unknown): CueGeneratedImage[];
