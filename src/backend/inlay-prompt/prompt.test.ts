// vendored from japolino/inlay-illustrator@2247423
import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "./inlay-config.js";
import { resolveIllustrationPlan } from "./shot-resolution.js";
import {
  assemblePrompt,
  compilePrompt,
  normalizePromptSection,
  renderNegativeWithCurrentSelection,
  renderPrompt,
  renderPromptWithCurrentAffixes
} from "./prompt.js";
import type { IllustrationInput, PlannedShot } from "./domain.js";

describe("ordered Anima prompt composition (vendored golden)", () => {
  test("renders a multi-character sofa scene in exact hybrid order with ComfyUI blank lines", () => {
    const config = {
      ...DEFAULT_CONFIG,
      promptSyntax: "comfyui" as const,
      customPositivePrefix: "<lora:sofa:0.8>;;",
      customPositiveSuffix: "cinematic finish!",
      customNegative: "extra fingers; malformed hands?",
      promptPresets: [{
        id: "quality",
        name: "Quality",
        positivePrefix: "score_9; (detail:1.25).",
        negativePrefix: "lowres; bad anatomy."
      }],
      activePromptPresetId: "quality"
    };
    const entry = assemblePrompt({
      environment: {
        location: ["sunken living room", "discarded second location"],
        timeWeather: ["rainy evening", "discarded second time"],
        lightingMood: ["warm lamp light", "soft shadows", "intimate mood", "discarded fourth light"],
        backgroundElements: ["green velvet sofa", "low coffee table", "rainy window", "bookshelf", "cream rug", "discarded sixth prop"]
      }
    }, {
      paragraph: 1,
      situation: "2girls",
      action: "holding hands, leaning together",
      camera: { framing: "wide shot", angle: "", perspective: "from side", focus: [] },
      sharedComposition: { interaction: ["holding hands"], spatialRelation: "leaning together on the sofa" },
      characters: [{
        name: "Alice",
        label: "girl",
        appearance: "blonde hair, blue eyes",
        attire: "red dress",
        expression: "smiling",
        action: "reclining, looking at the other girl",
        composition: {
          position: "left side of the sofa",
          pose: "reclining into the cushions",
          actions: [],
          gaze: "looking toward the other girl"
        }
      }, {
        name: "Beth",
        label: "girl",
        appearance: "black hair, green eyes",
        attire: "white blouse, black skirt",
        expression: "gentle smile",
        action: "sitting upright, looking left",
        composition: {
          position: "right side of the sofa",
          pose: "sitting upright",
          actions: [],
          gaze: "looking left"
        }
      }],
      negative: "text; watermark!"
    }, config, 1, 1);

    expect(renderPrompt(entry.prompt, config.promptSyntax)).toBe([
      "score_9, (detail:1.25)",
      "<lora:sofa:0.8>",
      "2girls",
      "left side of the sofa, reclining into the cushions, looking toward the other girl",
      "girl, blonde hair, blue eyes, red dress, smiling",
      "right side of the sofa, sitting upright, looking left",
      "girl, black hair, green eyes, white blouse, black skirt, gentle smile",
      "holding hands, leaning together on the sofa",
      "sunken living room, rainy evening, warm lamp light, soft shadows, intimate mood, green velvet sofa, low coffee table, rainy window, bookshelf, cream rug",
      "wide shot, from side",
      "cinematic finish"
    ].join(",\n\n"));
    expect(entry.negative).toBe("lowres, bad anatomy, extra fingers, malformed hands, text, watermark");
    expect(renderPrompt(entry.corePrompt, config.promptSyntax)).toBe([
      "2girls",
      "left side of the sofa, reclining into the cushions, looking toward the other girl",
      "girl, blonde hair, blue eyes, red dress, smiling",
      "right side of the sofa, sitting upright, looking left",
      "girl, black hair, green eyes, white blouse, black skirt, gentle smile",
      "holding hands, leaning together on the sofa",
      "sunken living room, rainy evening, warm lamp light, soft shadows, intimate mood, green velvet sofa, low coffee table, rainy window, bookshelf, cream rug",
      "wide shot, from side"
    ].join(",\n\n"));
    expect(entry.shotNegative).toBe("text; watermark!");
    expect(renderPrompt(entry.prompt, config.promptSyntax).match(/holding hands/g)).toHaveLength(1);
    expect(renderPrompt(entry.prompt, config.promptSyntax).match(/sitting upright/g)).toHaveLength(1);
  });


  test("keeps character composition and location/time when natural/shared detail is disabled", () => {
    const config = { ...DEFAULT_CONFIG, promptSyntax: "nai" as const, supplement: false };
    const entry = assemblePrompt({ environment: {
      location: "railway platform",
      timeWeather: "foggy dawn",
      lightingMood: ["cold blue light"],
      backgroundElements: ["station clock"]
    } }, {
      situation: "1girl",
      action: "reaching for another",
      sharedComposition: { interaction: ["reaching for another"], spatialRelation: "hands nearly touching across the gap" },
      camera: { framing: "close-up", angle: "", perspective: "", focus: [] },
      characters: [{
        label: "girl",
        appearance: "black hair",
        action: "leaning forward",
        composition: {
          position: "foreground",
          pose: "leaning across the platform edge",
          actions: [],
          gaze: ""
        }
      }]
    }, config, 1, 1);

    expect(renderPrompt(entry.prompt, config.promptSyntax)).toBe(
      "1girl, foreground, leaning across the platform edge, girl, black hair, reaching for another, railway platform, foggy dawn, upper body"
    );
  });
});

describe("prompt compatibility and normalization (vendored golden)", () => {
  test("reapplies current preset layers around an unchanged generated prompt for rerolls", () => {
    const config = {
      ...DEFAULT_CONFIG,
      promptSyntax: "comfyui" as const,
      customPositivePrefix: "current custom; prefix",
      customPositiveSuffix: "current suffix!",
      customNegative: "current custom negative;",
      promptPresets: [{
        id: "current",
        name: "Current",
        positivePrefix: "current preset; quality",
        negativePrefix: "current preset negative;"
      }],
      activePromptPresetId: "current"
    };
    const core = "1girl,\n\ncenter frame, turning toward the viewer,\n\ngirl, blonde hair";

    expect(renderPromptWithCurrentAffixes(core, "ordered", config)).toBe([
      "current preset, quality",
      "current custom, prefix",
      core,
      "current suffix"
    ].join(",\n\n"));
    expect(renderNegativeWithCurrentSelection("text, watermark", "ordered", config)).toBe(
      "current preset negative, current custom negative, text, watermark"
    );
  });


  test("restores stable Default formatting without experimental punctuation normalization", () => {
    const config = {
      ...DEFAULT_CONFIG,
      promptStyle: "default" as const,
      promptSyntax: "comfyui" as const,
      customPositivePrefix: "<lora:ink:0.75>; (quality:1.5); 1.2::sharp focus::",
      customPositiveSuffix: "finish?",
      customNegative: "bad hands; lowres!"
    };
    const entry = assemblePrompt({ place: "studio; night." }, {
      camera: "portrait;",
      situation: "1girl",
      action: "standing!",
      characters: [{ label: "girl", appearance: "blue hair" }],
      supplement: "Centered against a tall canvas; soft rim light!",
      negative: "text;"
    }, config, 1, 1);

    expect(renderPrompt(entry.prompt, config.promptSyntax)).toBe([
      "<lora:ink:0.75>; (quality:1.5); 1.2::sharp focus::",
      "portrait;, 1girl, standing!",
      "studio; night.",
      "girl, blue hair",
      "Centered against a tall canvas, soft rim light",
      "finish?"
    ].join(",\n"));
    expect(entry.negative).toBe("bad hands; lowres!, text;");
  });
});

describe("normalizePromptSection weight-safety (vendored)", () => {
  test("normalizePromptSection preserves double-colon weights and normalizes separators", () => {
    // Danbooru/NovelAI weight syntax uses `::`; normalization must not break it.
    expect(normalizePromptSection("(masterpiece:1.2), high detail")).toBe("(masterpiece:1.2), high detail");
    expect(normalizePromptSection("1.2::sharp focus::")).toBe("1.2::sharp focus::");
    // Semicolons become commas; multiple commas collapse; a `?`/`!` drops only right before a comma.
    expect(normalizePromptSection("a;;; b?,  c")).toBe("a, b, c");
    // Weights survive comma normalization around them.
    expect(normalizePromptSection("(score_9:1.2),;; (quality:1.4)")).toBe("(score_9:1.2), (quality:1.4)");
  });

});

describe("canonical compilePrompt boundary", () => {
  const input: IllustrationInput = {
    initialContinuity: {
      characters: [{
        name: "Asha Fen",
        label: "woman",
        age: "adult woman",
        appearance: "dark skin, curly black hair",
        body: "slim",
        attire: "purple travel coat",
        attireInferred: false
      }],
      environment: {
        location: "forest clearing",
        timeWeather: "moonlit twilight",
        lightingMood: ["soft moonlight"],
        backgroundElements: ["ancient trees"]
      },
      place: "beside an ancient oak"
    },
    shots: [{
      paragraph: 1,
      plan: {
        mode: "dynamic",
        primaryAction: "woman raises a crystal seed",
        staging: "woman centered in the clearing"
      },
      camera: { framing: "medium shot", angle: "eye level", perspective: "three-quarter view", focus: [] },
      situation: "1girl, solo, forest",
      characters: [{
        name: "Asha Fen",
        expression: "focused",
        composition: {
          position: "center frame",
          pose: "standing upright",
          actions: ["raising a crystal seed"],
          gaze: "looking at crystal seed"
        },
        renderScope: "upper body visible",
        visibleTags: ["dark skin", "curly black hair", "purple travel coat"]
      }],
      sharedComposition: { interaction: [], spatialRelation: "" },
      negative: ""
    } satisfies PlannedShot]
  };

  test("compiles a resolved shot to the same prompt as the legacy assembler", () => {
    const plan = resolveIllustrationPlan(input);
    const resolved = plan.shots[0]!;
    const legacy = assemblePrompt(
      {
        place: resolved.place,
        environment: resolved.environment,
        shots: [{
          paragraph: resolved.paragraph,
          perspectiveMode: "dynamic",
          camera: resolved.camera,
          shotPlan: { primaryAction: "woman raises a crystal seed", staging: "woman centered in the clearing" },
          situation: resolved.situation,
          characters: resolved.characters.map((character) => ({
            ...character,
            visibleTags: character.visibleTags.join(", ")
          })),
          sharedComposition: resolved.sharedComposition,
          negative: resolved.negative
        }]
      },
      { paragraph: resolved.paragraph, perspectiveMode: "dynamic", camera: resolved.camera, shotPlan: { primaryAction: "woman raises a crystal seed", staging: "woman centered in the clearing" }, situation: resolved.situation, characters: resolved.characters.map((character) => ({ ...character, visibleTags: character.visibleTags.join(", ") })), sharedComposition: resolved.sharedComposition, negative: resolved.negative },
      { ...DEFAULT_CONFIG, promptStyle: "anima" },
      resolved.paragraph,
      resolved.paragraph
    );

    const compiled = compilePrompt(resolved, { ...DEFAULT_CONFIG, promptStyle: "anima" });
    expect(renderPrompt(compiled.prompt, "nai")).toBe(renderPrompt(legacy.prompt, "nai"));
    expect(compiled.paragraph).toBe(resolved.paragraph);
  });
});
