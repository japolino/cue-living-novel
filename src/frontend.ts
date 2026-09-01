import type { SpindleFrontendContext } from "lumiverse-spindle-types";
import { setupVisualNovelFrontend } from "./frontend/host/controller.js";

export function setup(ctx: SpindleFrontendContext): () => void {
  return setupVisualNovelFrontend(ctx);
}
