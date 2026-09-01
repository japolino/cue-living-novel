import { describe, expect, test } from "bun:test";
import {
  POSE_EXPRESSION_CATALOGUE,
  POSE_EXPRESSION_CATALOGUE_MAX_SIZE,
  poseById,
  selectPoseExpression,
  tagBlockFor,
  type PoseExpressionDefinition,
  type SingleCharacterIdentity
} from "./character.js";

describe("POSE_EXPRESSION_CATALOGUE integrity", () => {
  test("is a non-empty closed set", () => {
    expect(POSE_EXPRESSION_CATALOGUE.length).toBeGreaterThan(0);
  });

  test("is bounded at <= 16 entries", () => {
    expect(POSE_EXPRESSION_CATALOGUE.length).toBeLessThanOrEqual(POSE_EXPRESSION_CATALOGUE_MAX_SIZE);
  });

  test("every id is unique and non-empty", () => {
    const ids = new Set(POSE_EXPRESSION_CATALOGUE.map((entry) => entry.id));
    expect(ids.size).toBe(POSE_EXPRESSION_CATALOGUE.length);
    for (const entry of POSE_EXPRESSION_CATALOGUE) {
      expect(entry.id.trim()).not.toBe("");
    }
  });

  test("every suffix is non-empty and trimmed", () => {
    for (const entry of POSE_EXPRESSION_CATALOGUE) {
      expect(entry.suffix.trim()).not.toBe("");
      expect(entry.suffix).toBe(entry.suffix.trim());
    }
  });
});

describe("selectPoseExpression", () => {
  const catalogue = POSE_EXPRESSION_CATALOGUE;

  test("is deterministic: same inputs yield the same pose", () => {
    const first = selectPoseExpression(catalogue, 2, "She smiles warmly at the viewer.");
    const second = selectPoseExpression(catalogue, 2, "She smiles warmly at the viewer.");
    expect(first).toEqual(second);
    expect(first).toBe(second);
  });

  test("keyword wins over the index fallback", () => {
    // "laugh" is the first keyword match in the map.
    expect(selectPoseExpression(catalogue, 0, "They all laugh together.").id).toBe("laugh");
    expect(selectPoseExpression(catalogue, 5, "A wave of relief washes over her.").id).toBe("wave");
    expect(selectPoseExpression(catalogue, 3, "He shouts in anger.").id).toBe("angry");
  });

  test("keyword matching is case-insensitive", () => {
    expect(selectPoseExpression(catalogue, 1, "SHE SMILES.").id).toBe("smile");
    expect(selectPoseExpression(catalogue, 2, "she BLUSHES.").id).toBe("shy");
  });

  test("falls back through the closed set on empty text", () => {
    for (let index = 0; index < catalogue.length; index += 1) {
      const selected = selectPoseExpression(catalogue, index, "");
      const expected = catalogue[index % catalogue.length] ?? catalogue[0]!;
      expect(selected).toBe(expected);
    }
    // The result always belongs to the closed catalogue.
    expect(catalogue).toContain(selectPoseExpression(catalogue, 13, ""));
  });

  test("cycling is stable: index larger than the catalogue wraps around", () => {
    expect(selectPoseExpression(catalogue, catalogue.length, "neutral prose").id)
      .toBe(selectPoseExpression(catalogue, 0, "neutral prose").id);
  });

  test("never returns a pose outside the closed set", () => {
    const texts = ["", "A neutral sentence with no cue words.", "He wonders what to do.", "Sad.", "Surprising turn!"];
    for (const text of texts) {
      for (let index = 0; index < 20; index += 1) {
        const selected = selectPoseExpression(catalogue, index, text);
        expect(catalogue.some((entry) => entry.id === selected.id)).toBe(true);
      }
    }
  });

  test("returns the fallback pose for an empty catalogue", () => {
    const empty: readonly PoseExpressionDefinition[] = [];
    expect(selectPoseExpression(empty, 0, "hello").id).toBe("idle");
  });
});

describe("poseById", () => {
  test("resolves a known id", () => {
    expect(poseById(POSE_EXPRESSION_CATALOGUE, "smile").id).toBe("smile");
  });

  test("falls back to the first entry for unknown or absent ids", () => {
    const first = POSE_EXPRESSION_CATALOGUE[0]!;
    expect(poseById(POSE_EXPRESSION_CATALOGUE, "not-a-real-pose")).toBe(first);
    expect(poseById(POSE_EXPRESSION_CATALOGUE, undefined)).toBe(first);
  });
});

describe("tagBlockFor", () => {
  test("joins tags with a comma separator", () => {
    const identity: SingleCharacterIdentity = { name: "Mira", tags: ["silver hair", "green eyes", "red coat"] };
    expect(tagBlockFor(identity)).toBe("silver hair, green eyes, red coat");
  });

  test("renders an empty identity as an empty string", () => {
    expect(tagBlockFor({ name: "", tags: [] })).toBe("");
  });
});
