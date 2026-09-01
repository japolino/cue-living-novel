import type { SpindleAPI } from "lumiverse-spindle-types";
import { registerVisualNovelBackend } from "./backend/runtime/controller.js";

declare const spindle: SpindleAPI;

registerVisualNovelBackend(spindle);
