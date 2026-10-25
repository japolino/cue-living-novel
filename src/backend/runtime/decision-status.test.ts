import { describe, expect, test } from "bun:test";
import { registerVisualNovelBackend } from "./controller.js";
import { LEGACY_SYSTEM_ONE_KEY } from "./system-one.js";

type Connection = { id: string; name: string; provider: string; model: string; is_default: boolean; has_api_key: boolean };

/** The backend with an in-memory config and enclave, and Lumiverse's Decision connections and UI. */
function harness(options: { connections?: Connection[]; decisions?: false; listError?: string; ui?: false } = {}) {
  const data = new Map<string, unknown>();
  const secrets = new Map<string, string>();
  const sent: Array<Record<string, unknown>> = [];
  const navigation: string[] = [];
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
    ...(options.decisions === false ? {} : {
      decisions: {
        listConnections: async (opts?: { userId?: string }) => {
          navigation.push(`list:${opts?.userId ?? ""}`);
          if (options.listError) throw new Error(options.listError);
          return options.connections ?? [];
        },
      },
    }),
    ...(options.ui === false ? {} : {
      ui: {
        closeSettings: async () => { navigation.push("closeSettings"); },
        openDrawerTab: async (tab: string) => { navigation.push(`drawer:${tab}`); },
      },
    }),
    sendToFrontend: (message: Record<string, unknown>) => { sent.push(message); },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  } as any;
  registerVisualNovelBackend(spindle);
  const send = async (message: unknown) => {
    const before = sent.length;
    await frontendHandler(message, "user");
    for (let i = 0; i < 100 && !sent.slice(before).some((entry) => entry.type === "vn_decision_status" || entry.type === "vn_error"); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  };
  return { send, sent, secrets, navigation, handle: (message: unknown) => frontendHandler(message, "user") };
}

const jev: Connection = { id: "d1", name: "Jev", provider: "typesafe", model: "jev-latest", is_default: true, has_api_key: true };
const other: Connection = { ...jev, id: "d0", name: "Other", model: "jev-mini", is_default: false };
const listed = (...connections: Connection[]) => connections.map(({ id, name, provider, model, is_default }) => ({ id, name, provider, model, isDefault: is_default }));

describe("the Decision connection: the chosen one, else Lumiverse's default one", () => {
  test("the status names the default Decision connection and lists every one, for this user", async () => {
    const h = harness({ connections: [other, jev] });
    await h.send({ type: "vn_get_decision_status" });
    expect(h.sent.at(-1)).toEqual({ type: "vn_decision_status", status: { state: "ready", name: "Jev", model: "jev-latest", chosen: false, connections: listed(other, jev) } });
    expect(h.navigation).toEqual(["list:user"]);
  });

  test("a chosen Decision connection is the one named; a chosen one that is gone says so", async () => {
    const h = harness({ connections: [other, jev] });
    const choose = async (decisionConnectionId: string) => {
      const saved = h.sent.filter((entry) => entry.type === "vn_config").length;
      await h.handle({ type: "vn_set_config", patch: { decisionConnectionId } });
      for (let i = 0; i < 100 && h.sent.filter((entry) => entry.type === "vn_config").length === saved; i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
    };
    const status = () => h.sent.filter((entry) => entry.type === "vn_decision_status").at(-1);
    await choose("d0");
    await h.send({ type: "vn_get_decision_status" });
    expect(status()).toEqual({ type: "vn_decision_status", status: { state: "ready", name: "Other", model: "jev-mini", chosen: true, connections: listed(other, jev) } });
    await choose("gone");
    await h.send({ type: "vn_get_decision_status" });
    expect(status()).toEqual({
      type: "vn_decision_status",
      status: { state: "missing", error: "The chosen Decision connection is no longer in Lumiverse. Choose another, or Lumiverse default.", connections: listed(other, jev) },
    });
  });

  test("no default Decision connection points to Lumiverse's setting", async () => {
    const h = harness({ connections: [{ ...jev, is_default: false }] });
    await h.send({ type: "vn_get_decision_status" });
    expect(h.sent.at(-1)).toEqual({
      type: "vn_decision_status",
      status: { state: "missing", error: "No default Decision connection. In Lumiverse, open Connections → Decision models, add a connection and set it as default, or choose one in Cue.", connections: listed({ ...jev, is_default: false }) },
    });
  });

  test("a default without a key, a Lumiverse without Decision models, or a missing permission says what to do", async () => {
    const noKey = harness({ connections: [{ ...jev, has_api_key: false }] });
    await noKey.send({ type: "vn_get_decision_status" });
    expect(noKey.sent.at(-1)).toMatchObject({ status: { state: "unavailable", name: "Jev", error: 'The default Decision connection "Jev" has no API key. Add it in Lumiverse: Connections → Decision models.' } });
    const old = harness({ decisions: false });
    await old.send({ type: "vn_get_decision_status" });
    expect(old.sent.at(-1)).toMatchObject({ status: { state: "unavailable", error: "This Lumiverse has no Decision models. Update Lumiverse to use a Decision connection." } });
    const denied = harness({ listError: "PERMISSION_DENIED: decisions — Decision model permission not granted" });
    await denied.send({ type: "vn_get_decision_status" });
    expect(denied.sent.at(-1)).toMatchObject({ status: { state: "unavailable", error: "Cue needs the Decision models permission. Grant it to Cue in Lumiverse's Extensions panel." } });
  });

  test("the key Cue kept before is removed on the first check", async () => {
    const h = harness({ connections: [jev] });
    h.secrets.set(LEGACY_SYSTEM_ONE_KEY, "sk-old");
    await h.send({ type: "vn_get_decision_status" });
    expect(h.secrets.has(LEGACY_SYSTEM_ONE_KEY)).toBe(false);
    expect(h.sent.at(-1)).toMatchObject({ status: { state: "ready" } });
  });

  test("Open Lumiverse Connections closes Lumiverse's Settings and opens the Connections drawer", async () => {
    const h = harness();
    await h.handle({ type: "vn_open_decision_connections" });
    expect(h.navigation).toEqual(["closeSettings", "drawer:connections"]);
    expect(h.sent.some((message) => message.type === "vn_error")).toBe(false);
    const old = harness({ ui: false });
    await old.send({ type: "vn_open_decision_connections" });
    expect(old.sent.at(-1)).toEqual({ type: "vn_error", operation: "vn_open_decision_connections", error: "this Lumiverse cannot open it for Cue" });
  });
});
