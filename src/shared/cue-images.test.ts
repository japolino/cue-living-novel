import { expect, test } from "bun:test";
import { parseImageRequest, parseImageResult, type CueImageRequest } from "./cue-images.js";
const request: CueImageRequest = { version: 1, provider: "warp", chatId: "c", requestId: "r", characterName: "Mira", venue: "Cafe", timeOfDay: "evening", mood: "happy" };
test("scene requests reject appearance, prompts, poses and connection overrides", () => {
  expect(parseImageRequest(request)).toEqual(request);
  for (const key of ["traits", "description", "tags", "pose", "attire", "prompt", "imageConnectionId"])
    expect(parseImageRequest({ ...request, [key]: "external override" })).toBeNull();
  expect(parseImageRequest({ ...request, provider: "other" })).toBeNull();
  expect(parseImageRequest({ ...request, characterName: "" })).toBeNull();
});
test("results support all Cue image fits and reject executable URLs", () => {
  for (const fit of ["cover", "contain", "fill", "none", "scale-down"])
    expect(parseImageResult({ ...request, status: "ready", imageUrl: "/api/v1/images/a", fit })?.status).toBe("ready");
  expect(parseImageResult({ ...request, status: "ready", imageUrl: "javascript:alert(1)", fit: "cover" })).toBeNull();
  expect(parseImageResult({ ...request, status: "ready", imageUrl: "/api/v1/images/a", fit: "stretch" })).toBeNull();
});

test("generated Lumiverse result URLs cross the image bridge", () => {
  expect(parseImageResult({ ...request, status: "ready", imageUrl: "/api/v1/image-gen/results/generated-image", fit: "contain" })?.status).toBe("ready");
  for (const imageUrl of ["/api/v1/image-gen/connections/a", "/api/v1/image-gen/results-evil/a", "data:text/html,evil", "//evil.test/a"])
    expect(parseImageResult({ ...request, status: "ready", imageUrl, fit: "cover" })).toBeNull();
});
