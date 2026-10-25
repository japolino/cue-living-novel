/**
 * Settings saved per character, end to end in one page: the real backend
 * (`registerVisualNovelBackend`) on an in-memory Spindle, and the real
 * frontend host (`setupVisualNovelFrontend`) with its Settings tab, joined by
 * a fake message bridge. Three chats: two character cards and a group chat.
 */
import type { SpindleAPI } from "lumiverse-spindle-types";
import { registerVisualNovelBackend } from "../src/backend/runtime/controller.js";
import { setupVisualNovelFrontend } from "../src/frontend/host/controller.js";

const USER = "reader";
const storage = new Map<string, unknown>();
storage.set("config.json", { themePreset: "golden-hour", generateImages: false, openingCard: "off", textSpeed: 0 });

const chats: Record<string, { id: string; character_id?: string; name: string }> = {
  "chat-mira": { id: "chat-mira", character_id: "card-mira", name: "With Mira" },
  "chat-theo": { id: "chat-theo", character_id: "card-theo", name: "With Theo" },
  "chat-group": { id: "chat-group", name: "Group" },
};
const cards: Record<string, { id: string; name: string }> = {
  "card-mira": { id: "card-mira", name: "Mira" },
  "card-theo": { id: "card-theo", name: "Theo" },
};

const backendLog: string[] = [];
const backendErrors: string[] = [];
const toBackend: Array<Record<string, unknown>> = [];
const toFrontend: Array<Record<string, unknown>> = [];
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/* ---- Backend side ---------------------------------------------------- */

const backendEvents = new Map<string, Array<(payload: unknown, userId?: string) => void>>();
let backendHandler: (payload: unknown, userId: string) => void = () => {};
let frontendHandlers: Array<(payload: unknown) => void> = [];

const spindle = {
  on: (event: string, handler: (payload: unknown, userId?: string) => void) => {
    backendEvents.set(event, [...(backendEvents.get(event) ?? []), handler]);
  },
  onFrontendMessage: (handler: (payload: unknown, userId: string) => void) => { backendHandler = handler; },
  sendToFrontend: (message: Record<string, unknown>) => {
    toFrontend.push(clone(message));
    // Like the host bridge: asynchronous and copied.
    setTimeout(() => { for (const handler of frontendHandlers) handler(clone(message)); }, 0);
  },
  userStorage: {
    getJson: async (path: string, options: { fallback: unknown }) => storage.has(path) ? clone(storage.get(path)) : options.fallback,
    setJson: async (path: string, value: unknown) => { storage.set(path, clone(value)); },
  },
  storage: {
    list: async () => [],
    exists: async () => false,
    mkdir: async () => {},
  },
  chats: { get: async (chatId: string) => (chats[chatId] ? clone(chats[chatId]) : null) },
  characters: { get: async (id: string) => (cards[id] ? clone(cards[id]) : null) },
  chat: { getMessages: async () => [] },
  connections: { list: async () => [] },
  imageGen: { listConnections: async () => [], getConnection: async () => null },
  enclave: { has: async () => false },
  personas: { getActive: async () => null },
  log: {
    info: (message: string) => { backendLog.push(message); },
    warn: (message: string) => { backendLog.push(`warn: ${message}`); },
    error: (message: string) => { backendErrors.push(message); },
  },
} as unknown as SpindleAPI;
registerVisualNovelBackend(spindle);

/* ---- Frontend side --------------------------------------------------- */

const appRoot = document.createElement("div");
appRoot.setAttribute("data-app-root", "");
document.body.append(appRoot);
const settingsRoot = document.createElement("div");
settingsRoot.setAttribute("data-settings-root", "");
Object.assign(settingsRoot.style, { maxWidth: "1000px", minHeight: "100vh", background: "#08090d" });
document.body.style.background = "#08090d";
document.body.append(settingsRoot);
document.body.style.margin = "0";

let activeChat = "chat-mira";
const frontendEvents = new Map<string, Array<(payload: unknown) => void>>();

const ctx = {
  ui: {
    mountApp: () => ({ root: appRoot, setVisible: (visible: boolean) => { appRoot.hidden = !visible; }, destroy() {} }),
    mount: () => {
      const element = document.createElement("div");
      document.body.append(element);
      return element;
    },
    registerComponentOverride: () => ({ destroy() {} }),
    registerInputBarAction: () => ({ setLabel() {}, destroy() {}, onClick: () => () => {} }),
    registerSettingsTab: () => ({ root: settingsRoot, destroy() {} }),
  },
  events: {
    on: (event: string, handler: (payload: unknown) => void) => {
      frontendEvents.set(event, [...(frontendEvents.get(event) ?? []), handler]);
      return () => {};
    },
  },
  getActiveChat: () => ({ chatId: activeChat, characterId: chats[activeChat]?.character_id ?? null }),
  dom: { findMessageElement: () => null },
  messages: { getLatestMessageId: () => null },
  ready: () => {},
  onBackendMessage: (handler: (payload: unknown) => void) => {
    frontendHandlers.push(handler);
    return () => { frontendHandlers = frontendHandlers.filter((candidate) => candidate !== handler); };
  },
  sendToBackend: (message: Record<string, unknown>) => {
    toBackend.push(clone(message));
    setTimeout(() => backendHandler(clone(message), USER), 0);
  },
};
setupVisualNovelFrontend(ctx as never);

/** Open another chat, as Lumiverse does: the host event to both sides. */
function switchChat(chatId: string): void {
  activeChat = chatId;
  for (const handler of backendEvents.get("CHAT_SWITCHED") ?? []) handler({ chatId }, USER);
  for (const handler of frontendEvents.get("CHAT_SWITCHED") ?? []) handler({ chatId });
}

/** The first match, looking inside open shadow roots too (the stage nests two). */
function findDeep(root: ParentNode, selector: string): HTMLElement | null {
  const direct = root.querySelector<HTMLElement>(selector);
  if (direct) return direct;
  for (const element of root.querySelectorAll("*")) {
    const found = element.shadowRoot ? findDeep(element.shadowRoot, selector) : null;
    if (found) return found;
  }
  return null;
}

/** The theme the stage shows right now. */
function stagePreset(): string | null {
  return findDeep(appRoot, "[data-vn-root]")?.dataset.vnPreset ?? null;
}

(window as unknown as { characterSettings: unknown }).characterSettings = {
  storage: () => Object.fromEntries([...storage].map(([path, value]) => [path, clone(value)])),
  toBackend,
  toFrontend,
  backendLog,
  backendErrors,
  switchChat,
  stagePreset,
  activeChat: () => activeChat,
};
document.body.setAttribute("data-fixture-ready", "1");
