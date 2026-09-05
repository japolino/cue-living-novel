/**
 * Optional SimTracker-side adapter. Copy into SimTracker and call setup once.
 * The producer must return markup for the requested chat/message/swipe only.
 * Call refresh() after SimTracker finishes rendering a secondary-model update.
 * No DOM ownership is transferred and no tracker data is sent over the network.
 */
export type VnPanelRequest = { version: 1; chatId: string; messageId: string; swipeId: number; sourceFingerprint: string };
export type SimTrackerCard = { cardId: string; title: string; html: string };

export function connectSimTrackerToVn(
  getCards: (request: VnPanelRequest) => Promise<SimTrackerCard[]> | SimTrackerCard[],
): { refresh(): Promise<void>; destroy(): void } {
  let active: VnPanelRequest | null = null;
  let generation = 0;
  let revision = 0;
  let previous = new Set<string>();
  let destroyed = false;
  const refresh = async () => {
    if (!active || destroyed) return;
    const request = active;
    const run = ++generation;
    const cards = await getCards(request);
    if (destroyed || run !== generation) return;
    const next = new Set<string>();
    for (const card of cards.slice(0, 12)) {
      if (!card.cardId || card.cardId.length > 100 || card.title.length > 120 || card.html.length > 100_000) continue;
      next.add(card.cardId);
      window.dispatchEvent(new CustomEvent("vn-panel-export-v1", { detail: { ...request, provider: "simtracker", ...card, revision: ++revision, status: "ready" } }));
    }
    for (const cardId of previous) if (!next.has(cardId)) {
      window.dispatchEvent(new CustomEvent("vn-panel-export-v1", { detail: { ...request, provider: "simtracker", cardId, revision: ++revision, status: "removed" } }));
    }
    previous = next;
  };
  const receive = (event: Event) => {
    const data = (event as CustomEvent).detail;
    if (data?.version !== 1 || typeof data.chatId !== "string" || typeof data.messageId !== "string" || typeof data.sourceFingerprint !== "string" || !Number.isSafeInteger(data.swipeId)) return;
    if (active?.chatId !== data.chatId || active?.messageId !== data.messageId || active?.sourceFingerprint !== data.sourceFingerprint) previous.clear();
    active = { version: 1, chatId: data.chatId, messageId: data.messageId, swipeId: data.swipeId, sourceFingerprint: data.sourceFingerprint };
    void refresh().catch(() => { /* Producer keeps its last valid state on transient failure. */ });
  };
  window.addEventListener("vn-panel-request-v1", receive);
  return { refresh, destroy() { destroyed = true; generation++; window.removeEventListener("vn-panel-request-v1", receive); } };
}
