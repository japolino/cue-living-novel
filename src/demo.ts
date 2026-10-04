/**
 * Standalone preview entry (`bun run serve:demo`).
 * Default: scene mode (src/demo-scene.ts). `?sprites`: sprite mode with the
 * committed fixture sprites and plates (src/demo-sprites.ts).
 */
if (new URLSearchParams(location.search).has("sprites")) {
  await import("./demo-sprites.js");
} else {
  await import("./demo-scene.js");
}

export {};
