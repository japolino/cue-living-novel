// Runtime shim for the build boundary. The strict TS program reads the sibling
// inlay-pipeline.d.ts for types; bun bundles this re-export into the real loose
// adapter (and its imported Inlay pipeline) at build time. Deliberately a .js so
// TS (allowJs off) never pulls the loose Inlay source into the strict program.
export { generateInlayImages, buildInlayConfig, mapInlaySlotsToCue } from "./inlay-adapter.js";
