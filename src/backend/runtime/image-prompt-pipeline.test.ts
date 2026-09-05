import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../config.js";
import { type SceneState, type VisualCue } from "../../shared/contracts.js";
import { POSE_EXPRESSION_CATALOGUE, poseById } from "../../shared/character.js";
import {
  applyAttireOverride,
  classifySubject,
  compileImagePrompt
} from "./images.js";
import { renderPrompt } from "../inlay-prompt/index.js";

const scene: SceneState = {
  sceneId: "scene-audit",
  revision: 0,
  startParagraph: 0,
  environment: {
    location: "Library",
    timeOfDay: "night",
    weather: null,
    lighting: "lamplight",
    description: "A quiet library.",
    persistentElements: []
  },
  cast: ["Mira"],
  continuity: { revision: 0, characters: {}, facts: {} },
  basePrompt: "quiet library at night",
  identityPrompt: "silver hair, green eyes, red coat",
  cameraLock: {
    framing: "upper body",
    angle: "eye level",
    perspective: "straight-on",
    lens: "50mm",
    subjectAnchor: "center",
    horizon: "upper third",
    safeDialogueRegion: "lower third",
    aspectRatio: "16:9"
  },
  compositionLock: "Mira centered",
  activeAssetId: null,
  priorSceneId: null
};

function cue(poseExpressionId = "idle", attire?: string): VisualCue {
  return {
    cueId: `cue-${poseExpressionId}`,
    paragraphIndex: 0,
    sceneId: "scene-audit",
    sceneRevision: 0,
    kind: "flattened_scene",
    action: null,
    expression: null,
    promptDelta: "",
    poseExpressionId,
    ...(attire ? { attire } : {}),
    assetJobId: `job-${poseExpressionId}`
  };
}

describe("Finding #4: Attire override and permanent identity", () => {
  test("preserves permanent traits and inferred gender when mixed with wearing clause", () => {
    const overridden = applyAttireOverride(
      "a tall man with silver hair wearing a red coat, green eyes",
      "white blouse"
    );
    expect(overridden).toContain("a tall man with silver hair");
    expect(overridden).toContain("green eyes");
    expect(overridden).toContain("white blouse");
    expect(overridden).not.toContain("red coat");

    const compiled = compileImagePrompt(
      DEFAULT_CONFIG,
      { ...scene, identityPrompt: "a tall man with silver hair wearing a red coat, green eyes" },
      cue("smile", "white blouse")
    );
    expect(compiled).toContain("1boy, solo");
    expect(compiled).not.toContain("1girl, solo");
    expect(compiled).toContain("silver hair");
  });

  test("removes compound garments and equipment without deleting facial anatomy", () => {
    const overridden = applyAttireOverride(
      "woman, silver hair, white sundress, blue sweatshirt, red dress_shirt, leather breastplate, bow-shaped lips",
      "black kimono"
    );
    expect(overridden).toContain("woman");
    expect(overridden).toContain("silver hair");
    expect(overridden).toContain("bow-shaped lips");
    expect(overridden).toContain("black kimono");
    expect(overridden).not.toContain("sundress");
    expect(overridden).not.toContain("sweatshirt");
    expect(overridden).not.toContain("dress_shirt");
    expect(overridden).not.toContain("breastplate");
  });

  test("removes underscore garment tags while keeping physical traits", () => {
    const overridden = applyAttireOverride(
      "woman, silver_hair, knee_high_boots, pleated_skirt",
      "black kimono"
    );
    expect(overridden).toContain("silver_hair");
    expect(overridden).toContain("black kimono");
    expect(overridden).not.toContain("knee_high_boots");
    expect(overridden).not.toContain("pleated_skirt");
  });

  test("appends known attire even when base identity is empty", () => {
    const overridden = applyAttireOverride("", "yellow raincoat");
    expect(overridden).toBe("yellow raincoat");

    const compiled = compileImagePrompt(
      DEFAULT_CONFIG,
      { ...scene, identityPrompt: "" },
      cue("smile", "yellow raincoat")
    );
    expect(compiled).toContain("yellow raincoat");
  });
});

describe("Finding #8: Subject classification and compound visibility", () => {
  test("classifies adversarial subjects separately from clothing and relational prose", () => {
    expect(classifySubject("adult person, nonbinary, silver hair")[1]).toBe("1other, solo");
    expect(classifySubject("man, maid uniform, black hair")[1]).toBe("1boy, solo");
    expect(classifySubject("woman, fake mustache, silver hair")[1]).toBe("1girl, solo");
    expect(classifySubject("male android, sister's scarf")[1]).toBe("1boy, solo");
    expect(classifySubject("golden retriever, four legs, fur")[1]).toBe("1other, solo");
    expect(classifySubject("1boy, green_eyes, blue_hair")[1]).toBe("1boy, solo");

    const manMaid = compileImagePrompt(
      DEFAULT_CONFIG,
      { ...scene, identityPrompt: "man, maid uniform, black hair" },
      cue("smile")
    );
    expect(manMaid).toContain("1boy, solo");
    expect(manMaid).not.toContain("1girl, solo");

    const dog = compileImagePrompt(
      DEFAULT_CONFIG,
      { ...scene, identityPrompt: "golden retriever, four legs, fur" },
      cue("smile")
    );
    expect(dog).toContain("1other, solo");
    expect(dog).not.toContain("1girl, solo");
  });

  test("decomposes compound tags so upper-body facts survive while lower-body facts are cropped", () => {
    const compiled = compileImagePrompt(
      DEFAULT_CONFIG,
      { ...scene, identityPrompt: "woman, silver hair and knee-high boots, red eyes, green jacket with a waist belt" },
      cue("smile")
    );
    expect(compiled).toContain("silver hair");
    expect(compiled).toContain("green jacket");
    expect(compiled).toContain("red eyes");
    expect(compiled).not.toContain("knee-high boots");
    expect(compiled).not.toContain("waist belt");
  });

  test("normalizes underscored tags so knee_high_boots are properly cropped out under upper-body framing", () => {
    const compiled = compileImagePrompt(
      DEFAULT_CONFIG,
      { ...scene, identityPrompt: "woman, silver_hair, knee_high_boots, pleated_skirt" },
      cue("smile")
    );
    expect(compiled).toContain("silver_hair");
    expect(compiled).not.toContain("knee_high_boots");
    expect(compiled).not.toContain("pleated_skirt");
  });
});

describe("Finding #9: Weight awareness and provider serialization", () => {
  test("replaces attire inside a weighted group without breaking group weight or delimiter balance", () => {
    const overridden = applyAttireOverride("man, (red coat, green eyes:1.2)", "black kimono");
    expect(overridden).toContain("(green eyes:1.2)");
    expect(overridden).toContain("black kimono");
    expect(overridden).not.toContain("red coat");

    // Parentheses balance check
    const openParen = (overridden.match(/\(/g) || []).length;
    const closeParen = (overridden.match(/\)/g) || []).length;
    expect(openParen).toBe(closeParen);
  });

  test("crops lower-body tags inside weighted groups without leaving unmatched parentheses", () => {
    const compiled = compileImagePrompt(
      DEFAULT_CONFIG,
      { ...scene, identityPrompt: "woman, (silver hair, black boots:1.2)" },
      cue("smile")
    );
    expect(compiled).toContain("(silver hair:1.2)");
    expect(compiled).not.toContain("black boots");

    const openParen = (compiled.match(/\(/g) || []).length;
    const closeParen = (compiled.match(/\)/g) || []).length;
    expect(openParen).toBe(closeParen);
  });

  test("serializes catalogue pose expressions for ComfyUI using round parens and numeric weights", () => {
    const coyPose = poseById(POSE_EXPRESSION_CATALOGUE, "acting_coy");
    expect(coyPose.suffix).toContain("{{blush}}");

    const rendered = compileImagePrompt(DEFAULT_CONFIG, scene, cue("acting_coy"));
    expect(rendered).toContain("(blush:1.1)");
    expect(rendered).not.toContain("{{blush}}");
    expect(rendered).not.toContain("[[");
    expect(rendered).not.toContain("]]");

    // Check balance for all catalogue poses rendered in ComfyUI
    for (const p of POSE_EXPRESSION_CATALOGUE) {
      const output = compileImagePrompt(DEFAULT_CONFIG, scene, cue(p.id));
      const braces = (output.match(/[{}]/g) || []).length;
      expect(braces).toBe(0);
      const openP = (output.match(/\(/g) || []).length;
      const closeP = (output.match(/\)/g) || []).length;
      expect(openP).toBe(closeP);
    }
  });

  test("serializes prompt weights for NAI syntax when requested", () => {
    const coyPose = poseById(POSE_EXPRESSION_CATALOGUE, "acting_coy");
    const renderedNai = compileImagePrompt(
      { ...DEFAULT_CONFIG, promptSyntax: "nai" } as any,
      scene,
      cue("acting_coy"),
      undefined,
      "nai"
    );
    expect(renderedNai).toContain("blush");
    expect(renderedNai).not.toContain("(blush:");
  });
});

describe("Finding #10: Environment truncation and description preservation", () => {
  test("does not truncate comma-bearing location or weather/time facts", () => {
    const compiled = compileImagePrompt(
      DEFAULT_CONFIG,
      {
        ...scene,
        environment: {
          ...scene.environment,
          location: "Library, flooded with ankle-deep water",
          timeOfDay: "night, heavy rain",
          weather: "lightning",
          description: "Distinct spiral staircase"
        }
      },
      cue("smile")
    );
    expect(compiled).toContain("Library, flooded with ankle-deep water");
    expect(compiled).toContain("flooded");
    expect(compiled).toContain("rain");
    expect(compiled).toContain("lightning");
    expect(compiled).toContain("Distinct spiral staircase");
  });
});

describe("Original creation reference tag injection", () => {
  test("injects Character \\(Creation\\) when originalReference is enabled", () => {
    const prompt = compileImagePrompt(
      {
        ...DEFAULT_CONFIG,
        originalReference: true,
        originalCreationName: "doki doki literature club"
      },
      scene,
      cue("idle")
    );
    expect(prompt).toContain("Mira \\(doki doki literature club\\)");
  });

  test("does not inject Character \\(Creation\\) when originalReference is disabled", () => {
    const prompt = compileImagePrompt(
      {
        ...DEFAULT_CONFIG,
        originalReference: false,
        originalCreationName: "doki doki literature club"
      },
      scene,
      cue("idle")
    );
    expect(prompt).not.toContain("doki doki literature club");
    expect(prompt).not.toContain("Mira \\(");
  });
});
