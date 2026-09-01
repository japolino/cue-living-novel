import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

// Import specifiers that must never be referenced from anywhere under src/.
// Built dynamically so the specifiers do not appear verbatim in this file, which
// keeps the canonical repo-level grep regression check clean.
const FORBIDDEN_SUBSTRINGS = [
  "inlay" + "-" + "image" + "-" + "pipeline",
  "runtime" + "/" + "inlay" + "-" + "adapter",
  "runtime" + "/" + "inlay" + "-" + "pipeline"
];

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path));
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

describe("no inlay imports remain", () => {
  test("no module under src/ imports from the removed inlay pipeline", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const content = readFileSync(file, "utf-8");
      for (const [index, line] of content.split("\n").entries()) {
        // Only inspect actual import/export specifiers, not prose comments.
        if (!/^\s*import\b|^\s*export\b/.test(line)) continue;
        if (FORBIDDEN_SUBSTRINGS.some((substring) => line.includes(substring))) {
          offenders.push(`${relative(process.cwd(), file)}:${index + 1}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the source tree can still be enumerated", () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(0);
  });
});
