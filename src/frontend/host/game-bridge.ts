/**
 * Game-engine bridge: another extension (a rules engine such as Warp) can put
 * its own choices on the stage while the overlay hides the chat.
 *
 *   vn-game-state-v1   provider → Cue   latest choices for a chat (replaces the previous set)
 *   vn-game-request-v1 Cue → provider   "send me your state for this chat"
 *   vn-game-pick-v1    Cue → provider   the player picked one of the provider's choices
 *
 * Events travel on `window` as CustomEvents, like the panel bridge. Payloads are
 * validated and capped; nothing here is sent over the network.
 */

export const GAME_STATE_EVENT = "vn-game-state-v1";
export const GAME_REQUEST_EVENT = "vn-game-request-v1";
export const GAME_PICK_EVENT = "vn-game-pick-v1";

const MAX_CHOICES = 12;

export interface GameChoice {
  provider: string;
  id: string;
  label: string;
  /** Section heading ("Talk", "Travel"). */
  group: string | null;
  /** Tooltip text. */
  detail: string | null;
  /** 0–1 chance of success, shown as a badge. */
  odds: number | null;
}

export interface GameState {
  provider: string;
  chatId: string;
  choices: GameChoice[];
  busy: boolean;
  busyLabel: string | null;
}

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;

/** Validate one `vn-game-state-v1` detail. Returns null for anything malformed. */
export function parseGameState(detail: unknown): GameState | null {
  if (!detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  const provider = text(d.provider, 40);
  const chatId = text(d.chatId, 200);
  if (d.version !== 1 || !provider || !chatId || !Array.isArray(d.choices)) return null;
  const choices: GameChoice[] = [];
  const seen = new Set<string>();
  for (const raw of d.choices.slice(0, MAX_CHOICES)) {
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const id = text(c.id, 200);
    const label = text(c.label, 160);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    const odds = typeof c.odds === "number" && Number.isFinite(c.odds) ? Math.max(0, Math.min(1, c.odds)) : null;
    choices.push({ provider, id, label, group: text(c.group, 60), detail: text(c.detail, 400), odds });
  }
  return { provider, chatId, choices, busy: d.busy === true, busyLabel: text(d.busyLabel, 120) };
}

/** Keeps the latest state per provider and tells the host when the active chat's choices change. */
export class GameBridge {
  private states = new Map<string, GameState>();
  private dead = false;

  constructor(
    private readonly target: Pick<Window, "addEventListener" | "removeEventListener" | "dispatchEvent">,
    private readonly onChange: () => void,
  ) {
    target.addEventListener(GAME_STATE_EVENT, this.receive);
  }

  private receive = (event: Event): void => {
    if (this.dead) return;
    const state = parseGameState((event as CustomEvent).detail);
    if (!state) return;
    this.states.set(state.provider, state);
    this.onChange();
  };

  /** Every provider's choices for this chat, in arrival order. */
  choicesFor(chatId: string): GameChoice[] {
    if (!chatId) return [];
    return [...this.states.values()].filter((s) => s.chatId === chatId).flatMap((s) => s.choices);
  }

  /** A provider is busy resolving the last pick (its buttons should wait). */
  busyFor(chatId: string): boolean {
    return [...this.states.values()].some((s) => s.chatId === chatId && s.busy);
  }

  /** Ask providers to (re)send their state, e.g. after a chat switch or reopening the stage. */
  request(chatId: string): void {
    if (this.dead || !chatId) return;
    this.target.dispatchEvent(new CustomEvent(GAME_REQUEST_EVENT, { detail: { version: 1, chatId } }));
  }

  pick(chatId: string, choice: GameChoice): void {
    if (this.dead) return;
    // Picked choices are spent until the provider sends a fresh set.
    const state = this.states.get(choice.provider);
    if (state?.chatId === chatId) this.states.set(choice.provider, { ...state, choices: [], busy: true });
    this.target.dispatchEvent(new CustomEvent(GAME_PICK_EVENT, { detail: { version: 1, provider: choice.provider, chatId, id: choice.id } }));
    this.onChange();
  }

  clear(): void {
    this.states.clear();
  }

  destroy(): void {
    this.dead = true;
    this.states.clear();
    this.target.removeEventListener(GAME_STATE_EVENT, this.receive);
  }
}
