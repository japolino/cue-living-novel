import { describe, expect, test } from "bun:test";
import { buildTurnFromInlay } from "./controller.js";
import { prepareNarrative } from "../core/paragraphs.js";
import type { CueGeneratedImage } from "../../runtime/inlay-pipeline.js";
import { TurnPlanSchema } from "../../shared/contracts.js";

function key() {
  return { chatId: "chat-1", assistantMessageId: "msg-1", swipeId: 0, sourceFingerprint: "abcdef1234567890", revision: 1 } as const;
}

describe("buildTurnFromInlay", () => {
  test("produces a valid TurnPlan and TurnView from narrative + images", () => {
    const narrative = prepareNarrative("Yukari stands frozen.\n\nMichael steps forward.\n\nWait, who are you?");
    const images: CueGeneratedImage[] = [
      { paragraph: 0, imageId: "img-0", imageUrl: "/0.png", prompt: "p0", negativePrompt: "n0", status: "completed", placement: "paragraph" },
      { paragraph: 2, imageId: "img-1", imageUrl: "/2.png", prompt: "p1", negativePrompt: "n1", status: "completed", placement: "paragraph" }
    ];
    const record = buildTurnFromInlay(key(), "Yukari", narrative, images);
    // The TurnPlan must validate against the strict schema (would throw if not).
    expect(TurnPlanSchema.safeParse(record.plan).success).toBe(true);
    expect(record.plan.paragraphs).toHaveLength(3);
    expect(record.jobs).toHaveLength(2);
    expect(record.jobs[0]?.status).toBe("generated");
    expect(record.jobs[0]?.startedAt).toBeTruthy();
    expect(record.jobs[0]?.generatedAt).toBeTruthy();
    expect(record.jobs[0]?.finishedAt).toBeNull();
    expect(record.jobs[0]?.readyAt).toBeNull();
    // TurnView assets
    expect(record.plan.visualCues[0]?.paragraphIndex).toBe(0);
    expect(record.plan.visualCues[1]?.paragraphIndex).toBe(2);
    // Standard mode: no authored choices means the input unlocks after the last paragraph.
    expect(record.plan.choices).toHaveLength(0);
    expect(record.status).toBe("ready");
  });

  test("produces a valid turn with no images (greeting)", () => {
    const narrative = prepareNarrative("Hi, I am your new companion.");
    const record = buildTurnFromInlay(key(), "Companion", narrative, []);
    expect(record.jobs).toHaveLength(0);
    expect(record.plan.paragraphs).toHaveLength(1);
    expect(TurnPlanSchema.safeParse(record.plan).success).toBe(true);
  });
});
