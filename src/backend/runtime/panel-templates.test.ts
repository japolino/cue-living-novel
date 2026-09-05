import { expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { resolvePanelTemplate } from "./panel-templates.js";

test("panel macros use host context without committing variable changes", async () => {
  let options: unknown;
  const spindle = { macros: { resolve: async (_text: string, input: unknown) => { options = input; return { text: "<div>Date</div>", diagnostics: [] }; } } } as unknown as SpindleAPI;
  expect(await resolvePanelTemplate(spindle, "{{#when}}", "chat", "owner", "card")).toBe("<div>Date</div>");
  expect(options).toEqual({ chatId: "chat", userId: "owner", characterId: "card", commit: false });
});
test("panel macro diagnostics and oversized inputs are reported", async () => {
  const spindle = { macros: { resolve: async () => ({ text: "", diagnostics: [{ message: "Unknown macro" }] }) } } as unknown as SpindleAPI;
  expect(resolvePanelTemplate(spindle, "{{bad}}", "chat", "owner")).rejects.toThrow("Unknown macro");
  expect(resolvePanelTemplate(spindle, "x".repeat(100_001), "chat", "owner")).rejects.toThrow("Invalid");
});
