import type { SpindleAPI } from "lumiverse-spindle-types";

export async function resolvePanelTemplate(spindle: SpindleAPI, template: string, chatId: string, userId: string, characterId?: string): Promise<string> {
  if (typeof template !== "string" || template.length > 100_000 || typeof chatId !== "string" || !chatId) throw new Error("Invalid panel template or chat.");
  if (!spindle.macros?.resolve) throw new Error("This host does not provide template macro resolution. Paste rendered HTML instead.");
  const result = await spindle.macros.resolve(template, { chatId, userId, commit: false, ...(characterId ? { characterId } : {}) });
  if (result.text.length > 100_000) throw new Error("Resolved template exceeds 100 KB.");
  if (result.diagnostics?.length) throw new Error(result.diagnostics.map((d) => d.message).join("; ").slice(0, 500));
  return result.text;
}
