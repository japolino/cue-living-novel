// vendored from japolino/inlay-illustrator@2247423
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function keysOf(value: unknown): string[] {
  return Object.keys(asRecord(value));
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.round(parsed))) : fallback;
}

export function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function cleanArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function compactBlock(value: string, maxLength: number): string {
  const clean = value.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength).trim()}\n...[truncated]` : clean;
}

export function splitTopLevelCsv(text: string): string[] {
  const results: string[] = [];
  const current: string[] = [];
  let depthParen = 0;
  let depthBrace = 0;
  let depthBracket = 0;

  for (const char of text) {
    if (char === "(") {
      depthParen++;
      current.push(char);
    } else if (char === ")") {
      depthParen = Math.max(0, depthParen - 1);
      current.push(char);
    } else if (char === "{") {
      depthBrace++;
      current.push(char);
    } else if (char === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
      current.push(char);
    } else if (char === "[") {
      depthBracket++;
      current.push(char);
    } else if (char === "]") {
      depthBracket = Math.max(0, depthBracket - 1);
      current.push(char);
    } else if (char === "," && depthParen === 0 && depthBrace === 0 && depthBracket === 0) {
      const token = current.join("").trim();
      if (token) results.push(token);
      current.length = 0;
    } else {
      current.push(char);
    }
  }
  const token = current.join("").trim();
  if (token) results.push(token);
  return results;
}

export function csvParts(...values: unknown[]): string[] {
  return values.flatMap((value) => splitTopLevelCsv(String(value || ""))).map((value) => value.trim()).filter(Boolean);
}

export type ParsedWeightedGroup =
  | { type: "comfy"; items: string[]; weight: string; prefix: "("; suffix: string }
  | { type: "nai_brace"; items: string[]; level: number; prefix: string; suffix: string }
  | { type: "nai_bracket"; items: string[]; level: number; prefix: string; suffix: string }
  | { type: "paren"; items: string[]; level: number; prefix: string; suffix: string };

export function parseWeightedGroup(tag: string): ParsedWeightedGroup | null {
  const trimmed = tag.trim();
  const comfyMatch = /^\((.*):([0-9.]+)\)$/.exec(trimmed);
  if (comfyMatch) {
    const inner = comfyMatch[1]!;
    const weight = comfyMatch[2]!;
    const items = splitTopLevelCsv(inner);
    return { type: "comfy", items, weight, prefix: "(", suffix: `:${weight})` };
  }

  const braceMatch = /^(\{+)(.*?)(\}+)$/.exec(trimmed);
  if (braceMatch && braceMatch[1]!.length === braceMatch[3]!.length) {
    const prefix = braceMatch[1]!;
    const suffix = braceMatch[3]!;
    const items = splitTopLevelCsv(braceMatch[2]!);
    return { type: "nai_brace", items, level: prefix.length, prefix, suffix };
  }

  const bracketMatch = /^(\[+)(.*?)(\]+)$/.exec(trimmed);
  if (bracketMatch && bracketMatch[1]!.length === bracketMatch[3]!.length) {
    const prefix = bracketMatch[1]!;
    const suffix = bracketMatch[3]!;
    const items = splitTopLevelCsv(bracketMatch[2]!);
    return { type: "nai_bracket", items, level: prefix.length, prefix, suffix };
  }

  const parenMatch = /^(\()+([^:]*?)(\))+$/.exec(trimmed);
  if (parenMatch && parenMatch[1]!.length === parenMatch[3]!.length) {
    const prefix = parenMatch[1]!;
    const suffix = parenMatch[3]!;
    const items = splitTopLevelCsv(parenMatch[2]!);
    return { type: "paren", items, level: prefix.length, prefix, suffix };
  }

  return null;
}

export function validateAndRepairDelimiters(text: string): string {
  const chars = Array.from(text);
  const removeIndices = new Set<number>();

  const checkPairs = (openChar: string, closeChar: string) => {
    const stack: number[] = [];
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      if (!char) continue;
      if (char === openChar) {
        stack.push(i);
      } else if (char === closeChar) {
        if (stack.length > 0) {
          stack.pop();
        } else {
          removeIndices.add(i);
        }
      }
    }
    for (const idx of stack) {
      removeIndices.add(idx);
    }
  };

  checkPairs("(", ")");
  checkPairs("{", "}");
  checkPairs("[", "]");

  const repaired = chars.filter((_, i) => !removeIndices.has(i)).join("");
  return repaired
    .replace(/\(\s*\)/g, "")
    .replace(/\{\s*\}/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/\(\s*:\s*[0-9.]+\s*\)/g, "")
    .replace(/\s*,\s*,+/g, ", ")
    .replace(/^\s*,+\s*/, "")
    .replace(/\s*,+\s*$/, "");
}

export function serializePromptWeights(text: string, syntax: "comfyui" | "nai"): string {
  if (syntax === "comfyui") {
    let result = text;
    let prev = "";
    while (result !== prev && /\{[^{}]*\}/.test(result)) {
      prev = result;
      result = result.replace(/(\{+)([^{}]+?)(\}+)/g, (_match, openB: string, content: string, closeB: string) => {
        const level = Math.min(openB.length, closeB.length);
        const weight = Math.round(Math.pow(1.05, level) * 100) / 100;
        const weightStr = weight.toFixed(2).replace(/\.?0+$/, "");
        const leftoverOpen = openB.slice(0, openB.length - level);
        const leftoverClose = closeB.slice(level);
        return `${leftoverOpen}(${content.trim()}:${weightStr})${leftoverClose}`;
      });
    }

    prev = "";
    while (result !== prev && /\[[^\[\]]*\]/.test(result)) {
      prev = result;
      result = result.replace(/(\[+)([^[\]]+?)(\]+)/g, (_match, openB: string, content: string, closeB: string) => {
        const level = Math.min(openB.length, closeB.length);
        const weight = Math.round(Math.pow(1 / 1.05, level) * 100) / 100;
        const weightStr = weight.toFixed(2).replace(/\.?0+$/, "");
        const leftoverOpen = openB.slice(0, openB.length - level);
        const leftoverClose = closeB.slice(level);
        return `${leftoverOpen}(${content.trim()}:${weightStr})${leftoverClose}`;
      });
    }
    return result;
  } else if (syntax === "nai") {
    return text.replace(/\(([^():]+):([0-9.]+)\)/g, (_match, content: string, weightStr: string) => {
      const weight = parseFloat(weightStr);
      if (Number.isNaN(weight) || Math.abs(weight - 1.0) < 0.02) return content.trim();
      if (weight > 1.0) {
        const count = Math.max(1, Math.min(10, Math.round(Math.log(weight) / Math.log(1.05))));
        const b = "{".repeat(count);
        const eb = "}".repeat(count);
        return `${b}${content.trim()}${eb}`;
      } else {
        const count = Math.max(1, Math.min(10, Math.round(Math.log(weight) / Math.log(1 / 1.05))));
        const b = "[".repeat(count);
        const eb = "]".repeat(count);
        return `${b}${content.trim()}${eb}`;
      }
    });
  }
  return text;
}

export function unique(parts: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(part);
  }
  return output;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
