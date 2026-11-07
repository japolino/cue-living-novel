import { afterEach, describe, expect, test } from "bun:test";
import type { TurnView } from "../../protocol.js";
import { bootHost, flush, type HostHarness } from "./__fixtures__/host.js";

/** States the stage must be able to leave without a reopen or a reload. */

const texts = ["The door creaks open.", "Wind howls."];
const turn = (overrides: Partial<TurnView> = {}): TurnView => ({
  chatId: "chat", messageId: "m1", swipeId: 0, sourceFingerprint: "fp", revision: 1,
  speaker: "Mira", userSpeaker: "You", paragraphs: texts, choices: [], assets: [], status: "ready",
  paragraphSpeakers: ["Mira", ""], ...overrides,
});

let host: HostHarness | null = null;
afterEach(() => { host?.destroy(); host = null; });

async function open(): Promise<HostHarness> {
  host = bootHost();
  host.state(null);
  host.toggle();
  host.state(turn());
  await flush();
  return host;
}

const phase = (h: HostHarness) => h.root.querySelector("[data-vn-root]")?.getAttribute("data-vn-phase") ?? null;

/** Read to the end of the turn and send a reply. */
async function replyAtTheEnd(h: HostHarness): Promise<void> {
  for (let step = 0; step < 6 && phase(h) !== "awaiting-input"; step += 1) {
    h.next();
    await flush();
  }
  expect(phase(h)).toBe("awaiting-input");
  h.reply("Hello?");
  await flush();
}

describe("a reply generation that brings no reply", () => {
  for (const outcome of ["stopped", "empty"] as const) test(`${outcome}: the stage stops waiting and gives the turn back`, async () => {
    const h = await open();
    await replyAtTheEnd(h);
    h.next();
    h.receive({ type: "vn_generation", chatId: "chat", active: true });
    expect(phase(h)).toBe("waiting-for-response");
    h.receive({ type: "vn_generation", chatId: "chat", active: false, outcome });
    expect(phase(h)).toBe("awaiting-input");
  });

  test("a reader still on their own line gets the turn back when they read past it", async () => {
    const h = await open();
    await replyAtTheEnd(h);
    h.receive({ type: "vn_generation", chatId: "chat", active: true });
    h.receive({ type: "vn_generation", chatId: "chat", active: false, outcome: "stopped" });
    expect(phase(h)).toBe("revealing");
    h.next();
    expect(phase(h)).toBe("awaiting-input");
  });

  test("an end that brings a reply keeps waiting for its plan", async () => {
    const h = await open();
    await replyAtTheEnd(h);
    h.next();
    h.receive({ type: "vn_generation", chatId: "chat", active: true });
    h.receive({ type: "vn_generation", chatId: "chat", active: false });
    expect(phase(h)).toBe("waiting-for-response");
  });
});
