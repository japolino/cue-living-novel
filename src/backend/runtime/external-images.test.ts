import { expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../config.js";
import { createExternalImages } from "./external-images.js";
import { CUE_IMAGE_REQUEST, CUE_IMAGE_RESULT, type CueImageRequest } from "../../shared/cue-images.js";
import { connectImageBridge } from "../../frontend/host/image-bridge.js";

const request: CueImageRequest = { version: 1, provider: "warp", chatId: "c", requestId: "r", characterName: "Mira", venue: "Cafe", timeOfDay: "evening", mood: "happy" };
function fixture(patch: Record<string, unknown> = {}) {
  const sent: any[] = [], planner: any[] = [], images: any[] = [], writes: string[] = [];
  const store = new Map<string, any>([
    ["config.json", { ...DEFAULT_CONFIG, parserConnectionId: "cue-helper", imageConnectionId: "cue-images::workflow",
      imageModel: "cue-model", imageParameters: { width: 1024 }, referenceAnchoring: false, systemOneMode: "off",
      promptPrefix: "CUE_STYLE", negativePrompt: "CUE_NEGATIVE", sceneImageFit: "contain", ...patch }],
    ["chats/c/characters.json", { Mira: "girl, silver hair, green eyes, red coat" }],
  ]);
  const f: any = { sent, planner, images, writes, store, image: async () => ({ imageId: "image", imageUrl: "/api/v1/images/image" }) };
  f.host = {
    chats: { get: async () => ({ character_id: "card" }) },
    characters: { get: async () => ({ name: "Mira", description: "Mira has silver hair and green eyes.", tags: [], world_book_ids: [] }) },
    chat: { getMessages: async () => [] },
    connections: { get: async (id: string) => ({ id, provider: "openai", model: "cue-helper-model" }) },
    generate: { raw: async (r: any) => {
      planner.push(r);
      if (f.planGate) await f.planGate;
      return { content: JSON.stringify({
        scenes: [{ startParagraph: 0, environment: { location: "Cafe", timeOfDay: "evening" },
          boundary: { claimedNewScene: true, reason: "initial", location: "Cafe", timeOfDay: "evening", majorTimeJump: false, environmentReplacement: false, forced: false },
          cast: ["Mira"], character: f.subject ?? "Mira", basePrompt: "Cafe at evening" }],
        cues: [{ paragraphIndex: 0, character: f.subject ?? "Mira", action: null, expression: "smile", promptDelta: "" }],
      }) };
    } },
    userStorage: {
      getJson: async (path: string, opts: any) => structuredClone(store.get(path) ?? opts?.fallback ?? null),
      setJson: async (path: string, value: any) => { writes.push(path); store.set(path, structuredClone(value)); },
    },
    imageGen: {
      getConnection: async () => ({ provider: "comfyui", model: "cue-model" }),
      generate: async (r: any) => { images.push(r); return f.image(); },
    },
    images: { get: async () => ({ imageUrl: "/api/v1/images/image" }) },
    sendToFrontend: (r: any) => sent.push(r),
    log: { warn() {}, info() {}, error() {} },
  } as unknown as SpindleAPI;
  f.service = createExternalImages(f.host);
  return f;
}

test("real Cue planner and image compiler use Cue settings and its authoritative identity", async () => {
  const f = fixture();
  await f.service.request(request, "user");
  expect(f.sent.at(-1).result).toMatchObject({ status: "ready", fit: "contain", imageUrl: "/api/v1/images/image" });
  expect(f.planner[0].connection_id).toBe("cue-helper");
  expect(f.images).toHaveLength(1);
  expect(f.images[0]).toMatchObject({ connection_id: "cue-images", model: "cue-model", owner_chat_id: "c", userId: "user" });
  expect(f.images[0].parameters).toMatchObject({ width: 1024, workflow_id: "workflow" });
  expect(f.images[0].prompt).toContain("silver hair");
  expect(f.images[0].prompt).toContain("CUE_STYLE");
  expect(f.images[0].negativePrompt).toContain("CUE_NEGATIVE");
  expect(f.images[0].prompt).toContain("gentle smile"); // Cue's deterministic pose catalogue.
  expect(f.writes).not.toContain("chats/c/state.json");
  expect(f.writes.some((path: string) => path.startsWith("turns/"))).toBe(false);
  await f.service.request(request, "user");
  expect(f.images).toHaveLength(1); expect(f.planner).toHaveLength(1);
});

test("disabled Cue, disabled generation and a zero budget never call the model or provider", async () => {
  for (const patch of [{ enabled: false }, { generateImages: false }, { maxImagesPerTurn: 0 }]) {
    const f = fixture(patch); await f.service.request(request, "user");
    expect(f.sent.at(-1).result.status).toBe("error");
    expect(f.planner).toEqual([]); expect(f.images).toEqual([]);
  }
});

test("traits and pose overrides are rejected before planning; the wrong subject cannot be generated", async () => {
  const f = fixture();
  await f.service.request({ ...request, traits: "blonde hair", pose: "hugging" }, "user");
  expect(f.sent.at(-1).result.status).toBe("error"); expect(f.planner).toHaveLength(0);
  f.subject = "Other";
  await f.service.request(request, "user");
  expect(f.images).toHaveLength(0); expect(f.sent.at(-1).result.status).toBe("error");
});

test("duplicate requests join one operation and cancellation drops a late provider result", async () => {
  const f = fixture();
  let release!: () => void;
  f.planGate = new Promise<void>((resolve) => { release = resolve; });
  const running = f.service.request(request, "user");
  while (!f.planner.length) await new Promise((resolve) => setTimeout(resolve, 1));
  await f.service.request(request, "user");
  expect(f.planner).toHaveLength(1);
  f.service.cancel({ ...request, requestId: "wrong" }, "user");
  f.service.cancel(request, "other-user");
  f.service.cancel(request, "user");
  release(); await running;
  expect(f.images).toHaveLength(0);
  expect(f.sent.some((m: any) => m.result.status === "ready")).toBe(false);
  expect(f.writes).toEqual([]);
});

test("window bridge routes the real pipeline without Cue's view being open", async () => {
  const f = fixture(), bus = new EventTarget(), results: any[] = [], work: Promise<void>[] = [];
  f.image = async () => ({ imageId: "generated", imageUrl: "/api/v1/image-gen/results/generated" });
  const bridge = connectImageBridge(bus, () => "c", (r) => {
    if (r.type === "vn_external_image") work.push(f.service.request(r.request, "user").then(() => {
      for (const m of f.sent) bridge.result(m.result);
    }));
  });
  bus.addEventListener(CUE_IMAGE_RESULT, (e) => results.push((e as CustomEvent).detail));
  bus.dispatchEvent(new CustomEvent(CUE_IMAGE_REQUEST, { detail: request }));
  await Promise.all(work);
  expect(results[0].status).toBe("accepted");
  expect(results.at(-1).status).toBe("ready");
  expect(results.at(-1).imageUrl).toBe("/api/v1/image-gen/results/generated");
  expect(f.images).toHaveLength(1);
  bridge.destroy();
});

test("a canceled provider completion cannot publish, and retry uses the current fit", async () => {
  const f = fixture();
  let entered!: () => void, release!: (value: any) => void;
  const called = new Promise<void>((resolve) => { entered = resolve; });
  f.image = () => { entered(); return new Promise((resolve) => { release = resolve; }); };
  const running = f.service.request(request, "user");
  await called;
  f.service.cancel(request, "user");
  release({ imageId: "old", imageUrl: "/api/v1/images/old" }); await running;
  expect(f.sent.some((m: any) => m.result.status === "ready")).toBe(false);
  f.image = async () => {
    f.store.set("config.json", { ...f.store.get("config.json"), sceneImageFit: "fill" });
    return { imageId: "new", imageUrl: "/api/v1/images/new" };
  };
  await f.service.request({ ...request, requestId: "retry" }, "user");
  expect(f.sent.at(-1).result).toMatchObject({ status: "ready", fit: "fill" });
});

test("the window bridge forwards live fit changes without another generation", () => {
  const bus = new EventTarget(), seen: any[] = [];
  bus.addEventListener("vn-scene-image-fit-v1", (e) => seen.push((e as CustomEvent).detail));
  const bridge = connectImageBridge(bus, () => "c", () => { throw new Error("No generation expected"); });
  bridge.fit("scale-down");
  expect(seen).toEqual([{ version: 1, chatId: "c", fit: "scale-down" }]);
  bridge.destroy();
});

test("a named secondary character uses Cue's identity instead of the card protagonist", async () => {
  const f = fixture();
  f.store.set("chats/c/characters.json", { Mira: "girl, silver hair, green eyes, red coat", Jo: "boy, brown hair, blue eyes, blue jacket" });
  f.subject = "Jo";
  await f.service.request({ ...request, characterName: "Jo" }, "user");
  expect(f.sent.at(-1).result.status).toBe("ready");
  expect(f.images[0].prompt).toContain("brown hair");
  expect(f.images[0].prompt).not.toContain("silver hair");
});

test("native-card mode uses the selected card image and refuses a different character's avatar", async () => {
  const f = fixture({ useNativeCardImages: true, generateImages: false });
  f.host.characters.get = async () => ({ name: "Mira", tags: [], description: "", world_book_ids: [], image_id: "native-avatar" });
  await f.service.request(request, "user");
  expect(f.sent.at(-1).result).toMatchObject({ status: "ready", imageUrl: "/api/v1/images/native-avatar" });
  expect(f.images).toHaveLength(0);
  f.subject = "Jo";
  f.store.set("chats/c/characters.json", { Mira: "girl, silver hair, green eyes", Jo: "boy, brown hair, blue eyes" });
  await f.service.request({ ...request, requestId: "jo", characterName: "Jo" }, "user");
  expect(f.sent.at(-1).result.status).toBe("error");
  expect(f.sent.at(-1).result.error).toContain("cannot confirm");
  expect(f.images).toHaveLength(0);
});
