import { describe, expect, test } from "bun:test";
import { registerVisualNovelBackend } from "./controller.js";
import { SYSTEM_ONE_KEY } from "./system-one.js";

/** The backend with an in-memory config, an in-memory enclave and a scripted System One. */
function harness(options: { mode?: "off" | "compare" | "on"; status?: number; body?: string } = {}) {
  const data = new Map<string, unknown>();
  if (options.mode) data.set("config.json", { systemOneMode: options.mode });
  const secrets = new Map<string, string>();
  const sent: Array<Record<string, unknown>> = [];
  const requests: Array<{ url: string; init: { headers: Record<string, string>; body: string } }> = [];
  let frontendHandler: (message: unknown, userId?: string) => Promise<void> = async () => {};
  const spindle = {
    on: () => {},
    onFrontendMessage: (fn: typeof frontendHandler) => { frontendHandler = fn; },
    userStorage: {
      getJson: async (path: string, opts: { fallback: unknown }) => data.get(path) ?? opts.fallback,
      setJson: async (path: string, value: unknown) => { data.set(path, value); },
    },
    enclave: {
      put: async (name: string, value: string) => { secrets.set(name, value); },
      get: async (name: string) => secrets.get(name) ?? null,
      has: async (name: string) => secrets.has(name),
      delete: async (name: string) => { secrets.delete(name); },
    },
    cors: async (url: string, init: { headers: Record<string, string>; body: string }) => {
      requests.push({ url, init });
      return { status: options.status ?? 200, body: options.body ?? JSON.stringify({ model: "jev-latest", answers: { key_check: { type: "noul", noul: 0.97 } } }) };
    },
    sendToFrontend: (message: Record<string, unknown>) => { sent.push(message); },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  } as any;
  registerVisualNovelBackend(spindle);
  const savedMode = () => (data.get("config.json") as { systemOneMode?: string } | undefined)?.systemOneMode;
  /** Sends a frontend message and waits for the key status that ends its handling. */
  const send = async (message: unknown) => {
    const before = sent.length;
    await frontendHandler(message, "user");
    for (let i = 0; i < 100 && !sent.slice(before).some((entry) => entry.type === "vn_system_one_key_status" || entry.type === "vn_error"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  };
  return { send, sent, requests, secrets, savedMode };
}

describe("System One key: save turns it on, remove turns it off", () => {
  test("saving a key makes one test call, then turns System One on", async () => {
    const h = harness();
    await h.send({ type: "vn_set_system_one_key", key: "  sk-test  " });
    expect(h.secrets.get(SYSTEM_ONE_KEY)).toBe("sk-test");
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]!.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(h.requests[0]!.init.headers.Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(h.requests[0]!.init.body).model).toBe("jev-latest");
    expect(h.savedMode()).toBe("on");
    const config = h.sent.find((message) => message.type === "vn_config") as { config: { systemOneMode: string } } | undefined;
    expect(config?.config.systemOneMode).toBe("on");
    expect(h.sent.at(-1)).toEqual({ type: "vn_system_one_key_status", saved: true, test: "passed" });
  });

  test("a failed test call keeps the key but leaves System One off, with the reason", async () => {
    const h = harness({ status: 401, body: "unauthorized" });
    await h.send({ type: "vn_set_system_one_key", key: "sk-wrong" });
    expect(h.secrets.has(SYSTEM_ONE_KEY)).toBe(true);
    expect(h.savedMode()).toBeUndefined();
    expect(h.sent.some((message) => message.type === "vn_config")).toBe(false);
    expect(h.sent.at(-1)).toEqual({ type: "vn_system_one_key_status", saved: true, test: "failed", error: "System One request failed (401)" });
  });

  test("an answer that does not parse fails the test", async () => {
    const h = harness({ body: "{\"nope\":true}" });
    await h.send({ type: "vn_set_system_one_key", key: "sk-test" });
    expect(h.sent.at(-1)).toMatchObject({ saved: true, test: "failed", error: "System One answered in a form Cue does not understand. Check the URL and model." });
    expect(h.savedMode()).toBeUndefined();
  });

  test("an explicit Compare stays Compare after a new key", async () => {
    const h = harness({ mode: "compare" });
    await h.send({ type: "vn_set_system_one_key", key: "sk-test" });
    expect(h.savedMode()).toBe("compare");
    expect(h.sent.at(-1)).toMatchObject({ test: "passed" });
  });

  test("removing the key turns System One off", async () => {
    const h = harness({ mode: "on" });
    h.secrets.set(SYSTEM_ONE_KEY, "sk-test");
    await h.send({ type: "vn_clear_system_one_key" });
    expect(h.secrets.has(SYSTEM_ONE_KEY)).toBe(false);
    expect(h.savedMode()).toBe("off");
    expect(h.sent.at(-1)).toEqual({ type: "vn_system_one_key_status", saved: false });
    expect(h.requests).toHaveLength(0);
  });
});
