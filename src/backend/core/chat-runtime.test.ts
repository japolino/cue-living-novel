import { describe, expect, test } from "bun:test";
import type { TurnKey } from "../../shared/contracts.js";
import type { TurnView } from "../../protocol.js";
import { ChatRuntime, ChatRuntimes, type AssetBatch, type ChatPhase } from "./chat-runtime.js";

/** A turn of the chat: one per message name ("T1", "T2"); each call is a new, equal key object. */
function turn(name: string): TurnKey {
  return { chatId: "chat", assistantMessageId: name, swipeId: 0, sourceFingerprint: "fingerprint", revision: 1 };
}

type Event =
  | ["plan", string]
  | ["planSettled", string]
  | ["claim", string]
  | ["release", string, "first" | "last"]
  | ["batch", string]
  | ["finish", string]
  | ["interrupt"]
  | ["abort"]
  | ["generationStarted"]
  | ["generationEnded"];

type Row = {
  name: string;
  events: Event[];
  /** "idle", "planning:<op>", "owned:<turn>" or "owned:<turn>+batch", then " generating" while a reply is generated. */
  phase: string;
  /** Each startBatch as "<turn>:ok" or "<turn>:<refusal>". */
  starts?: string[];
  /** Batches aborted by the end, as "<turn>#<n>" (n counts that turn's started batches). */
  aborted?: string[];
  /** How many times the chat's plans were cancelled. */
  planCancels?: number;
};

function describePhase(phase: ChatPhase): string {
  if (phase.kind === "idle") return "idle";
  if (phase.kind === "planning") return `planning:${phase.opId}`;
  return `owned:${phase.turnKey.assistantMessageId}${phase.batch ? "+batch" : ""}`;
}

function run(events: Event[]) {
  let planCancels = 0;
  const runtime = new ChatRuntime({ cancelPlanning: () => { planCancels += 1; } });
  const claims = new Map<string, TurnKey[]>();
  const batches: Array<{ label: string; batch: AssetBatch; finish: () => void }> = [];
  const starts: string[] = [];
  for (const event of events) {
    switch (event[0]) {
      case "plan": runtime.planningStarted(event[1]); break;
      case "planSettled": runtime.planningSettled(event[1]); break;
      case "claim": {
        const key = turn(event[1]);
        claims.set(event[1], [...(claims.get(event[1]) ?? []), key]);
        runtime.claim(key);
        break;
      }
      case "release": {
        const made = claims.get(event[1]) ?? [];
        const key = event[2] === "first" ? made[0] : made.at(-1);
        if (key) runtime.release(key);
        break;
      }
      case "batch": {
        const start = runtime.startBatch(turn(event[1]));
        starts.push(`${event[1]}:${start.ok ? "ok" : start.reason}`);
        if (start.ok) {
          const count = batches.filter((entry) => entry.batch.turnKey.assistantMessageId === event[1]).length + 1;
          batches.push({ label: `${event[1]}#${count}`, batch: start.batch, finish: start.finish });
        }
        break;
      }
      case "finish": {
        // "T1" finishes that turn's latest batch; "T1#1" a given one.
        const entry = event[1].includes("#")
          ? batches.find((candidate) => candidate.label === event[1])
          : [...batches].reverse().find((candidate) => candidate.batch.turnKey.assistantMessageId === event[1]);
        entry?.finish();
        break;
      }
      case "interrupt": runtime.interrupt("Retrying turn."); break;
      case "abort": runtime.abort("Cancelled."); break;
      case "generationStarted": runtime.onGenerationStarted("A new generation started."); break;
      case "generationEnded": runtime.onGenerationEnded(); break;
    }
  }
  return {
    runtime,
    phase: `${describePhase(runtime.phase)}${runtime.generating ? " generating" : ""}`,
    starts,
    aborted: batches.filter((entry) => entry.batch.signal.aborted).map((entry) => entry.label),
    planCancels
  };
}

const rows: Row[] = [
  { name: "a chat starts idle", events: [], phase: "idle" },
  // Planning
  { name: "a plan in flight", events: [["plan", "op1"]], phase: "planning:op1" },
  { name: "a newer plan is the one in flight", events: [["plan", "op1"], ["plan", "op2"], ["planSettled", "op1"]], phase: "planning:op2" },
  { name: "a plan that settles without claiming leaves the chat idle", events: [["plan", "op1"], ["planSettled", "op1"]], phase: "idle" },
  { name: "a plan claims its turn", events: [["plan", "op1"], ["claim", "T1"], ["planSettled", "op1"]], phase: "owned:T1" },
  { name: "a plan for another message leaves the owner and its batch alone", events: [["claim", "T1"], ["batch", "T1"], ["plan", "op1"]], phase: "owned:T1+batch", starts: ["T1:ok"], aborted: [] },
  // Batches
  { name: "the owner starts its batch", events: [["claim", "T1"], ["batch", "T1"]], phase: "owned:T1+batch", starts: ["T1:ok"] },
  { name: "a finished batch leaves the owner with the turn", events: [["claim", "T1"], ["batch", "T1"], ["finish", "T1"]], phase: "owned:T1", aborted: [] },
  { name: "no batch starts without an owner", events: [["batch", "T1"]], phase: "idle", starts: ["T1:not_owner"] },
  { name: "no batch starts for a turn that does not own the chat", events: [["claim", "T1"], ["batch", "T2"]], phase: "owned:T1", starts: ["T2:not_owner"] },
  { name: "a second batch of the same turn replaces the first", events: [["claim", "T1"], ["batch", "T1"], ["batch", "T1"]], phase: "owned:T1+batch", starts: ["T1:ok", "T1:ok"], aborted: ["T1#1"] },
  { name: "the replaced batch finishing late leaves the new one in place", events: [["claim", "T1"], ["batch", "T1"], ["batch", "T1"], ["finish", "T1#1"]], phase: "owned:T1+batch", aborted: ["T1#1"] },
  // (c) The owner moves only with its batch
  { name: "(c) claiming another turn aborts the batch it replaces", events: [["claim", "T1"], ["batch", "T1"], ["claim", "T2"]], phase: "owned:T2", aborted: ["T1#1"] },
  { name: "(c) the aborted batch finishing late leaves the new owner alone", events: [["claim", "T1"], ["batch", "T1"], ["claim", "T2"], ["finish", "T1#1"]], phase: "owned:T2", aborted: ["T1#1"] },
  { name: "claiming the same turn again keeps its batch", events: [["claim", "T1"], ["batch", "T1"], ["claim", "T1"]], phase: "owned:T1+batch", aborted: [] },
  // (d) An abort before the batch starts
  { name: "(d) a cancel before the batch starts refuses it", events: [["claim", "T1"], ["abort"], ["batch", "T1"]], phase: "idle", starts: ["T1:not_owner"], planCancels: 1 },
  { name: "(d) a new generation before the batch starts refuses it", events: [["claim", "T1"], ["generationStarted"], ["batch", "T1"]], phase: "idle generating", starts: ["T1:not_owner"] },
  { name: "(d) another turn claiming before the batch starts refuses it", events: [["claim", "T1"], ["claim", "T2"], ["batch", "T1"]], phase: "owned:T2", starts: ["T1:not_owner"] },
  // Aborts
  { name: "an abort stops the batch and drops the owner", events: [["claim", "T1"], ["batch", "T1"], ["abort"]], phase: "idle", aborted: ["T1#1"], planCancels: 1 },
  { name: "an abort cancels the plan in flight", events: [["plan", "op1"], ["abort"], ["planSettled", "op1"]], phase: "idle", planCancels: 1 },
  { name: "Retry stops the batch but keeps the owner", events: [["claim", "T1"], ["batch", "T1"], ["interrupt"]], phase: "owned:T1", aborted: ["T1#1"], planCancels: 1 },
  { name: "Retry cancels the plan in flight", events: [["plan", "op1"], ["interrupt"]], phase: "idle", planCancels: 1 },
  { name: "Retry then claims the same turn and starts its batch", events: [["claim", "T1"], ["batch", "T1"], ["interrupt"], ["claim", "T1"], ["batch", "T1"]], phase: "owned:T1+batch", starts: ["T1:ok", "T1:ok"], aborted: ["T1#1"] },
  // Generation
  { name: "a new generation stops the batch, drops the owner and cancels plans", events: [["plan", "op1"], ["claim", "T1"], ["batch", "T1"], ["generationStarted"]], phase: "idle generating", aborted: ["T1#1"], planCancels: 1 },
  { name: "the generation ending leaves the chat idle", events: [["claim", "T1"], ["batch", "T1"], ["generationStarted"], ["generationEnded"]], phase: "idle" },
  { name: "a claim while a reply is generated starts no batch and gives the claim back", events: [["generationStarted"], ["claim", "T1"], ["batch", "T1"]], phase: "idle generating", starts: ["T1:generating"] },
  { name: "(e) once the generation ends without a reply the turn is claimed again and its batch starts", events: [["claim", "T1"], ["batch", "T1"], ["generationStarted"], ["generationEnded"], ["claim", "T1"], ["batch", "T1"]], phase: "owned:T1+batch", starts: ["T1:ok", "T1:ok"], aborted: ["T1#1"] },
  // Release
  { name: "a released claim gives the chat back", events: [["claim", "T1"], ["release", "T1", "last"]], phase: "idle" },
  { name: "releasing an older claim leaves a newer claim of the same turn", events: [["claim", "T1"], ["claim", "T1"], ["release", "T1", "first"]], phase: "owned:T1" },
  { name: "a claim whose batch runs is not released", events: [["claim", "T1"], ["batch", "T1"], ["release", "T1", "last"]], phase: "owned:T1+batch" }
];

describe("ChatRuntime: event sequence -> phase", () => {
  for (const row of rows) {
    test(row.name, () => {
      const result = run(row.events);
      expect(result.phase).toBe(row.phase);
      if (row.starts) expect(result.starts).toEqual(row.starts);
      if (row.aborted) expect(result.aborted).toEqual(row.aborted);
      if (row.planCancels !== undefined) expect(result.planCancels).toBe(row.planCancels);
    });
  }
});

describe("ChatRuntime", () => {
  test("a batch saves only while it is the owner's live batch", () => {
    const runtime = new ChatRuntime();
    runtime.claim(turn("T1"));
    const start = runtime.startBatch(turn("T1"));
    if (!start.ok) throw new Error("the batch should start");
    expect(start.owns(turn("T1"))).toBe(true);
    expect(start.owns(turn("T2"))).toBe(false);
    runtime.claim(turn("T2"));
    expect(start.owns(turn("T1"))).toBe(false);
    expect(start.batch.signal.aborted).toBe(true);
  });

  test("a batch replaced by the same turn's next batch no longer saves", () => {
    const runtime = new ChatRuntime();
    runtime.claim(turn("T1"));
    const first = runtime.startBatch(turn("T1"));
    const second = runtime.startBatch(turn("T1"));
    if (!first.ok || !second.ok) throw new Error("both batches should start");
    expect(first.owns(turn("T1"))).toBe(false);
    expect(second.owns(turn("T1"))).toBe(true);
  });

  test("abort and a new generation report the owner they dropped", () => {
    const runtime = new ChatRuntime();
    expect(runtime.abort("Cancelled.")).toBeNull();
    runtime.claim(turn("T1"));
    expect(runtime.abort("Cancelled.")?.assistantMessageId).toBe("T1");
    runtime.claim(turn("T2"));
    expect(runtime.onGenerationStarted("A new generation started.")?.assistantMessageId).toBe("T2");
  });

  test("settling waits for every batch and tracked cleanup, then clears", async () => {
    const runtime = new ChatRuntime();
    expect(runtime.settling).toBeNull();
    runtime.claim(turn("T1"));
    const start = runtime.startBatch(turn("T1"));
    if (!start.ok) throw new Error("the batch should start");
    let releaseCleanup!: () => void;
    runtime.track(new Promise<void>((resolve) => { releaseCleanup = resolve; }));
    // An aborted batch is still out until it returns.
    runtime.abort("Cancelled.");
    const settling = runtime.settling;
    expect(settling).not.toBeNull();
    let settled = false;
    void settling!.then(() => { settled = true; });
    start.finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseCleanup();
    await settling;
    await Promise.resolve();
    expect(settled).toBe(true);
    expect(runtime.settling).toBeNull();
  });

  test("a failed cleanup still settles", async () => {
    const runtime = new ChatRuntime();
    runtime.track(Promise.reject(new Error("storage failed")));
    await runtime.settling;
    await Promise.resolve();
    expect(runtime.settling).toBeNull();
  });

  test("a new generation and an explicit bump both make an intake in flight stale", () => {
    const runtime = new ChatRuntime();
    const epoch = runtime.intakeEpoch;
    runtime.bumpIntakeEpoch();
    expect(runtime.intakeEpoch).toBe(epoch + 1);
    runtime.onGenerationStarted("A new generation started.");
    expect(runtime.intakeEpoch).toBe(epoch + 2);
  });

  test("the provisional text belongs to its plan", () => {
    const runtime = new ChatRuntime();
    const view = { messageId: "T1" } as unknown as TurnView;
    runtime.showProvisional({ operationId: "op1", view });
    expect(runtime.provisionalOf("op1")?.view).toBe(view);
    expect(runtime.provisionalOf("op2")).toBeNull();
    runtime.dropProvisional("op2");
    expect(runtime.provisional).not.toBeNull();
    runtime.dropProvisional("op1");
    expect(runtime.provisional).toBeNull();
  });
});

describe("ChatRuntimes", () => {
  test("one runtime per user and chat; aborts cancel that chat's plans", () => {
    const cancelled: string[] = [];
    const runtimes = new ChatRuntimes((userId, chatId, reason) => { cancelled.push(`${userId ?? "owner"}/${chatId}: ${reason}`); });
    const a = runtimes.get("u1", "c1");
    expect(runtimes.get("u1", "c1")).toBe(a);
    expect(runtimes.get("u2", "c1")).not.toBe(a);
    expect(runtimes.get(undefined, "c1")).not.toBe(a);
    a.abort("Cancelled.");
    runtimes.get(undefined, "c2").onGenerationStarted("A new generation started.");
    expect(cancelled).toEqual(["u1/c1: Cancelled.", "owner/c2: A new generation started."]);
  });
});
