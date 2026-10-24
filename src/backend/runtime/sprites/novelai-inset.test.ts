import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG } from "../../../config.js";
import { NOVELAI_INSET_LAYOUTS } from "../../../shared/novelai-inset.js";
import { KAI, MIRA, spriteConfig } from "./__fixtures__/sprite-fixtures.js";
import {
  compileNovelAiInsetRequest,
  insetNegative,
  insetPrompt,
  mergeNovelAiRawOverride,
  novelAiInsetKey,
  novelAiInsetModelFor,
  novelAiInsetRejected,
  parseRawOverride,
} from "./novelai-inset.js";
import { compileSpriteRequest, SPRITE_NEGATIVE_TAGS } from "./prompts.js";

const CANVAS = { image: "SU1BR0U=", mask: "TUFTSw==" };
const SIZE = { width: 1216, height: 832 };
const layout = NOVELAI_INSET_LAYOUTS.sprite;

function v5Request(expression = "smile") {
  const config = spriteConfig({ imageModel: "nai-diffusion-5-full", referenceAnchoring: true });
  return compileSpriteRequest({ config, provider: "novelai", member: MIRA, expression, seed: 1234 });
}

describe("NovelAI V5 inset: detection", () => {
  test("only NovelAI V5 models get an inset; the model name is <model>-inpainting", () => {
    expect(novelAiInsetModelFor("novelai", "nai-diffusion-5-full")).toEqual({ model: "nai-diffusion-5-full-inpainting", verified: true });
    // Curated: the same rule, but nobody has confirmed the name yet.
    expect(novelAiInsetModelFor("novelai", "nai-diffusion-5-curated")).toEqual({ model: "nai-diffusion-5-curated-inpainting", verified: false });
    expect(novelAiInsetModelFor("novelai", "nai-diffusion-5-full-inpainting")).toEqual({ model: "nai-diffusion-5-full-inpainting", verified: true });
    // V4.5 keeps Precise Reference; other providers keep their references.
    expect(novelAiInsetModelFor("novelai", "nai-diffusion-4-5-full")).toBeNull();
    expect(novelAiInsetModelFor("novelai", "nai-diffusion-4-5-curated")).toBeNull();
    expect(novelAiInsetModelFor("novelai", "nai-diffusion-50")).toBeNull();
    expect(novelAiInsetModelFor("novelai", "")).toBeNull();
    expect(novelAiInsetModelFor("novelai", null)).toBeNull();
    expect(novelAiInsetModelFor("comfyui", "nai-diffusion-5-full")).toBeNull();
    expect(novelAiInsetModelFor(null, "nai-diffusion-5-full")).toBeNull();
  });

  test("only a rejected request turns the inset off; passing errors do not", () => {
    const model = "nai-diffusion-5-curated-inpainting";
    for (const status of [400, 404, 422]) expect(novelAiInsetRejected(new Error(`NovelAI image generate failed (${status}): Bad Request`), model)).toBe(true);
    for (const status of [401, 402, 408, 409, 429, 500, 502, 503]) expect(novelAiInsetRejected(new Error(`NovelAI image generate failed (${status}): busy model`), model)).toBe(false);
    expect(novelAiInsetRejected(Object.assign(new Error("Unprocessable"), { status: 422 }), model)).toBe(true);
    expect(novelAiInsetRejected(Object.assign(new Error("unknown model"), { status: 429 }), model)).toBe(false);
    // Without a status: only a message about the model or the inpainting.
    expect(novelAiInsetRejected(new Error("unknown model"), model)).toBe(true);
    expect(novelAiInsetRejected(new Error(`${model} is not available`), model)).toBe(true);
    expect(novelAiInsetRejected(new Error("NovelAI image generate failed: infill is not supported here"), model)).toBe(true);
    expect(novelAiInsetRejected(new Error("fetch failed"), model)).toBe(false);
    expect(novelAiInsetRejected(new Error("The image provider completed without a persisted image ID."), model)).toBe(false);
    expect(novelAiInsetRejected("socket hang up", model)).toBe(false);
  });

  test("the session key separates users, connections and models", () => {
    const keys = new Set([
      novelAiInsetKey("u1", "c1", "nai-diffusion-5-full-inpainting"),
      novelAiInsetKey("u2", "c1", "nai-diffusion-5-full-inpainting"),
      novelAiInsetKey("u1", "c2", "nai-diffusion-5-full-inpainting"),
      novelAiInsetKey("u1", "c1", "nai-diffusion-5-curated-inpainting"),
      novelAiInsetKey(undefined, null, "nai-diffusion-5-full-inpainting"),
    ]);
    expect(keys.size).toBe(5);
  });
});

describe("NovelAI V5 inset: prompt and negative", () => {
  test("`split screen` goes first in the base prompt, once", () => {
    expect(insetPrompt("anime coloring, 1girl, solo")).toBe("split screen, anime coloring, 1girl, solo");
    expect(insetPrompt("split screen, anime coloring")).toBe("split screen, anime coloring");
    expect(insetPrompt("Split_Screen, anime coloring")).toBe("Split_Screen, anime coloring");
    expect(insetPrompt("")).toBe("split screen");
  });

  test("the negative loses `split screen`, keeps `multiple views` and gains `comic`", () => {
    expect(SPRITE_NEGATIVE_TAGS).toContain("split screen");
    const negative = insetNegative(`lowres, ${SPRITE_NEGATIVE_TAGS}`);
    const tags = negative.split(", ");
    expect(tags).not.toContain("split screen");
    expect(tags).toContain("multiple views");
    expect(tags.at(-1)).toBe("comic");
    expect(tags.filter((tag) => tag === "multiple views")).toHaveLength(1);
    expect(insetNegative("lowres, comic, split_screen")).toBe("lowres, comic");
    // Weighted groups are left as they are.
    expect(insetNegative("1.2::text, logo::, lowres")).toBe("1.2::text, logo::, lowres, comic");
  });

  test("a weighted or bracketed `split screen` leaves the negative too; the rest of its group stays", () => {
    expect(insetNegative("lowres, 1.2::split screen::, text")).toBe("lowres, text, comic");
    expect(insetNegative("lowres, -1::split_screen::")).toBe("lowres, comic");
    expect(insetNegative("{split screen}, lowres")).toBe("lowres, comic");
    expect(insetNegative("[[Split Screen]], lowres")).toBe("lowres, comic");
    expect(insetNegative("(split screen:1.3), text")).toBe("text, comic");
    expect(insetNegative("lowres, 1.5::text, split screen, logo::")).toBe("lowres, 1.5::text, logo::, comic");
    expect(insetNegative("1.2::split screen, multiple views::, lowres")).toBe("1.2::multiple views::, lowres, comic");
    expect(insetNegative("{text, split screen}, lowres")).toBe("{text}, lowres, comic");
    // Other tags that only start with it stay; an emphasized `comic` counts.
    expect(insetNegative("split screen view, lowres")).toBe("split screen view, lowres, comic");
    expect(insetNegative("lowres, 1.3::comic::")).toBe("lowres, 1.3::comic::");
    expect(insetPrompt("{split screen}, anime coloring")).toBe("{split screen}, anime coloring");
    expect(insetPrompt("1.2::split screen::, anime coloring")).toBe("1.2::split screen::, anime coloring");
  });
});

describe("NovelAI V5 inset: raw request override", () => {
  test("action infill, image and mask, the canvas size, noise 0", () => {
    expect(JSON.parse(mergeNovelAiRawOverride([], CANVAS, SIZE))).toEqual({ action: "infill", parameters: { noise: 0, width: 1216, height: 832, image: CANVAS.image, mask: CANVAS.mask } });
  });

  test("a user size cannot change the canvas size (it would not match the image and mask)", () => {
    const merged = JSON.parse(mergeNovelAiRawOverride(['{"parameters":{"width":832,"height":1216,"steps":20}}'], CANVAS, SIZE));
    expect(merged.parameters).toMatchObject({ width: 1216, height: 832, steps: 20 });
  });

  test("a nested null is written, as Lumiverse merges it; a top-level null changes nothing", () => {
    const merged = JSON.parse(mergeNovelAiRawOverride(['{"parameters":{"noise":null,"sm":null},"extra":null}', null], CANVAS, SIZE));
    expect(merged.parameters.noise).toBeNull();
    expect(merged.parameters.sm).toBeNull();
    expect(merged.extra).toBeNull();
    expect(merged.parameters.image).toBe(CANVAS.image);
  });

  test("the user's overrides are merged, not replaced; the inset wins for action, image and mask", () => {
    const connection = JSON.stringify({ parameters: { steps: 14, scale: 6.7, noise: 0.1, image: "user-image" }, action: "generate", extra: { a: 1 } });
    const cue = { parameters: { sampler: "k_euler_ancestral", scale: 7 }, extra: { b: 2 } };
    const merged = JSON.parse(mergeNovelAiRawOverride([connection, cue], CANVAS, SIZE));
    expect(merged).toEqual({
      action: "infill",
      extra: { a: 1, b: 2 },
      parameters: { noise: 0.1, steps: 14, scale: 7, sampler: "k_euler_ancestral", width: 1216, height: 832, image: CANVAS.image, mask: CANVAS.mask },
    });
  });

  test("empty overrides are ignored; invalid ones throw (as Lumiverse would)", () => {
    expect(parseRawOverride(undefined)).toBeNull();
    expect(parseRawOverride("  ")).toBeNull();
    expect(parseRawOverride('{"steps":20}')).toEqual({ steps: 20 });
    expect(() => parseRawOverride("{steps:20}")).toThrow();
    expect(() => parseRawOverride("[1]")).toThrow();
    expect(() => parseRawOverride(5)).toThrow();
    expect(() => mergeNovelAiRawOverride(["not json"], CANVAS, SIZE)).toThrow();
  });

  test("prototype keys in a user override never reach the merge", () => {
    const merged = JSON.parse(mergeNovelAiRawOverride(['{"__proto__":{"polluted":true},"parameters":{"steps":20}}'], CANVAS, SIZE));
    expect(merged.parameters.steps).toBe(20);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });
});

describe("NovelAI V5 inset: request transform", () => {
  test("the sprite request becomes the inset request", () => {
    const plain = v5Request();
    const inset = compileNovelAiInsetRequest({ request: plain, layout, canvas: CANVAS });
    expect(plain.parameters.resolution).toBe("832x1216");
    expect(inset.parameters.resolution).toBe("1216x832");
    expect(inset.prompt).toBe(`split screen, ${plain.prompt}`);
    // The character caption (the identity and the expression) is unchanged.
    expect(inset.parameters.characterTags).toEqual(plain.parameters.characterTags);
    expect(inset.parameters.seed).toBe(1234);
    expect(inset.parameters.qualityToggle).toBe(false);
    expect(inset.negativePrompt).toBe(insetNegative(plain.negativePrompt));
    expect(inset.parameters.negativePrompt).toBe(inset.negativePrompt);
    expect(inset.parameters.resolvedReferenceImages).toBeUndefined();
    expect(JSON.parse(inset.parameters.rawRequestOverride as string)).toEqual({ action: "infill", parameters: { noise: 0, width: 1216, height: 832, image: CANVAS.image, mask: CANVAS.mask } });
    // Steps, guidance and sampler are the user's: the inset adds none.
    for (const key of ["steps", "guidance", "scale", "sampler"]) expect(inset.parameters[key]).toBeUndefined();
    // The plain request is not changed.
    expect(plain.parameters.rawRequestOverride).toBeUndefined();
  });

  test("the inset carries the V4+ caption: girl / boy / other first, count tags only in the base prompt", () => {
    for (const [member, noun, count] of [[MIRA, "girl", "1girl"], [KAI, "boy", "1boy"]] as const) {
      const plain = compileSpriteRequest({ config: spriteConfig({ imageModel: "nai-diffusion-5-full", referenceAnchoring: true }), provider: "novelai", member, expression: "smile", seed: 1 });
      const inset = compileNovelAiInsetRequest({ request: plain, layout, canvas: CANVAS });
      const captions = (inset.parameters.characterTags as Array<{ tags: string }>).map((entry) => entry.tags.split(", "));
      expect(captions).toHaveLength(1);
      expect(captions[0]![0]).toBe(noun);
      expect(captions[0]!.filter((tag) => /^(?:\d+(?:girl|boy|other)s?|solo)$/.test(tag))).toEqual([]);
      // The identity's own count tag moved out; the base prompt keeps it, after `split screen`.
      const base = inset.prompt.split(", ");
      expect(base[0]).toBe("split screen");
      expect(base).toContain(count);
      expect(base).toContain("solo");
    }
  });

  test("a reference image left in the parameters is dropped; user overrides are merged", () => {
    const plain = v5Request();
    const inset = compileNovelAiInsetRequest({
      request: { ...plain, parameters: { ...plain.parameters, resolvedReferenceImages: [{ data: "x" }] } },
      layout,
      canvas: CANVAS,
      userOverrides: ['{"parameters":{"steps":14}}'],
    });
    expect(inset.parameters.resolvedReferenceImages).toBeUndefined();
    expect(JSON.parse(inset.parameters.rawRequestOverride as string).parameters.steps).toBe(14);
  });

  test("works on the default config too (default negative, quality tags)", () => {
    const config = { ...DEFAULT_CONFIG, imageModel: "nai-diffusion-5-full" };
    const plain = compileSpriteRequest({ config, provider: "novelai", member: MIRA, expression: "angry", seed: 7 });
    const inset = compileNovelAiInsetRequest({ request: plain, layout, canvas: CANVAS });
    expect(inset.prompt.startsWith("split screen, ")).toBe(true);
    expect(inset.negativePrompt.split(", ")).toContain("multiple views");
    expect(inset.negativePrompt.split(", ")).toContain("comic");
    expect(inset.negativePrompt.split(", ")).not.toContain("split screen");
  });
});
