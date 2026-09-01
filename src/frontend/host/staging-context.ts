import type { SpindleFrontendContext } from "lumiverse-spindle-types";

export type OverrideHost = "BubbleMessage" | "MinimalMessage" | "MessageEditArea" | "InputArea";

export type ComponentOverrideHandle = { destroy(): void };

export type StagingFrontendContext = Omit<SpindleFrontendContext, "ui"> & {
  ui: Omit<SpindleFrontendContext["ui"], "registerComponentOverride"> & {
    registerComponentOverride?: (options: {
      host: OverrideHost;
      mode: "wrap" | "replace";
      priority?: number;
      component: (props: Record<string, unknown>) => unknown;
    }) => ComponentOverrideHandle;
  };
};

export function stagingContext(ctx: SpindleFrontendContext): StagingFrontendContext {
  return ctx as StagingFrontendContext;
}

export function supportsVisualNovelOverlay(ctx: StagingFrontendContext): boolean {
  return typeof ctx.ui.mountApp === "function"
    && typeof ctx.ui.registerComponentOverride === "function";
}
