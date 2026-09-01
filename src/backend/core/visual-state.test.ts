import { describe, expect, test } from "bun:test";
import {
  emptyProfiles,
  parseProfiles,
  profileFor,
  profilesForPrompt,
  upsertProfiles
} from "./visual-state.js";

describe("visual-state", () => {
  test("emptyProfiles returns an empty record", () => {
    expect(emptyProfiles()).toEqual({});
  });

  test("upsertProfiles keys by lowercase name and keeps stable traits", () => {
    const base = upsertProfiles({}, [{ name: "Mira", description: "silver hair, green eyes" }]);
    expect(base.mira).toEqual({ name: "Mira", description: "silver hair, green eyes" });

    // update clothing, keep the same stable profile
    const next = upsertProfiles(base, [{ name: "Mira", description: "silver hair, green eyes, red coat" }]);
    expect(next.mira?.description).toBe("silver hair, green eyes, red coat");
    // base is immutable
    expect(base.mira?.description).toBe("silver hair, green eyes");
  });

  test("upsertProfiles ignores blank entries", () => {
    const next = upsertProfiles({}, [
      { name: " ", description: "x" },
      { name: "Theo", description: "  " }
    ]);
    expect(Object.keys(next)).toHaveLength(0);
  });

  test("profileFor does a case-insensitive match", () => {
    const profiles = upsertProfiles({}, [{ name: "Mira", description: "silver hair" }]);
    expect(profileFor(profiles, "MIRA")?.description).toBe("silver hair");
  });

  test("profilesForPrompt renders one line per profile", () => {
    const profiles = upsertProfiles({}, [
      { name: "Mira", description: "silver hair" },
      { name: "Theo", description: "round glasses" }
    ]);
    const prompt = profilesForPrompt(profiles);
    expect(prompt).toContain("Mira: silver hair");
    expect(prompt).toContain("Theo: round glasses");
    expect(prompt.split("\n")).toHaveLength(2);
  });

  test("parseProfiles tolerates bad payloads", () => {
    expect(parseProfiles(null)).toEqual({});
    expect(parseProfiles("nope")).toEqual({});
    const parsed = parseProfiles({ mira: { name: "Mira", description: "tall" }, bad: { name: "x" } });
    expect(parsed.mira?.name).toBe("Mira");
    expect(parsed.bad).toBeUndefined();
  });
});
