import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../../../config.js";
import { compilePlateRequest, compileSpriteRequest, PLATE_SIZE, SPRITE_SIZE } from "./prompts.js";
import { spriteSeedFor, spriteStyleKey } from "./style.js";

const mira = { name: "Mira", identity: "1girl, silver hair, green eyes, school uniform", attire: "red kimono", subjectCategory: "female" as const };

function config(patch: Partial<VisualNovelConfig> = {}): VisualNovelConfig {
  return { ...DEFAULT_CONFIG, ...patch };
}

describe("sprite style key", () => {
  test("stable for the same style, different for every style input", () => {
    const base = config();
    expect(spriteStyleKey(base)).toBe(spriteStyleKey({ ...base }));
    expect(spriteStyleKey(base)).toMatch(/^style_[0-9a-f]{8}$/);
    const variants: Array<Partial<VisualNovelConfig>> = [
      { imageConnectionId: "conn-2" },
      { imageModel: "nai-diffusion-4-5-full" },
      { promptPrefix: "watercolor" },
      { promptSuffix: "soft light" },
      { negativePrompt: "ugly" },
      { novelAiQualityTags: false },
      { novelAiUseDefaultNegative: false },
    ];
    const keys = new Set([spriteStyleKey(base), ...variants.map((patch) => spriteStyleKey(config(patch)))]);
    expect(keys.size).toBe(variants.length + 1);
  });

  test("unrelated settings do not start new sets", () => {
    expect(spriteStyleKey(config({ textSpeed: 99, presentationMode: "sprites", imageConcurrency: 4 }))).toBe(spriteStyleKey(config()));
  });

  test("seeds are fixed per key and vary per regeneration", () => {
    expect(spriteSeedFor("set_a")).toBe(spriteSeedFor("set_a"));
    expect(spriteSeedFor("set_a", 1)).not.toBe(spriteSeedFor("set_a"));
    expect(spriteSeedFor("set_a", 2)).not.toBe(spriteSeedFor("set_a", 1));
    for (const seed of [spriteSeedFor("x"), spriteSeedFor("x", 7)]) {
      expect(Number.isSafeInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(2 ** 32);
    }
  });
});

describe("sprite prompts: ComfyUI syntax", () => {
  test("identity, outfit, expression and white-background framing in ComfyUI weights", () => {
    const request = compileSpriteRequest({ config: config(), provider: "comfyui", member: mira, expression: "laughing", seed: 42 });
    expect(request.prompt).toContain("1girl");
    expect(request.prompt).toContain("silver hair");
    expect(request.prompt).toContain("red kimono");
    // Outfit override drops the identity's clothing.
    expect(request.prompt).not.toContain("school uniform");
    expect(request.prompt).toContain("white background");
    expect(request.prompt).toContain("cowboy shot");
    expect(request.prompt).toContain("no shadow");
    // Catalogue braces become ComfyUI (tag:weight) groups.
    expect(request.prompt).not.toMatch(/\{/);
    expect(request.prompt).toMatch(/\(happy, smile, laughing, closed eyes:1\.1\)/);
    // The default scene prefix is not used for a sprite.
    expect(request.prompt).not.toContain("visual novel scene");
    expect(request.prompt.match(/\bsolo\b/g)?.length).toBe(1);
    expect(request.negativePrompt).toContain("scenery");
    expect(request.negativePrompt).toContain("drop shadow");
    expect(request.negativePrompt).toContain("multiple people");
    expect(request.negativePrompt).toContain("watermark");
    expect(request.parameters).toEqual({ width: SPRITE_SIZE.width, height: SPRITE_SIZE.height, seed: 42 });
  });

  test("a custom prefix and suffix are kept (they carry the user's style)", () => {
    const request = compileSpriteRequest({
      config: config({ promptPrefix: "artist:foo, flat color", promptSuffix: "clean lineart" }),
      provider: "comfyui", member: mira, expression: "idle", seed: 1,
    });
    expect(request.prompt.startsWith("artist:foo, flat color")).toBe(true);
    expect(request.prompt.trim().endsWith("clean lineart")).toBe(true);
  });

  test("providers without size or seed get none", () => {
    const request = compileSpriteRequest({ config: config(), provider: "openai", member: mira, expression: "idle", seed: 5 });
    expect(request.parameters).toEqual({});
  });

  test("plate: place, time, weather, description + scenery, landscape size", () => {
    const request = compilePlateRequest({
      config: config(), provider: "comfyui",
      plate: { location: "Old observatory", timeOfDay: "night", weather: "rain", description: "brass telescope under a glass dome" },
      seed: 9,
    });
    expect(request.prompt).toContain("Old observatory");
    expect(request.prompt).toContain("night");
    expect(request.prompt).toContain("rain");
    expect(request.prompt).toContain("brass telescope");
    expect(request.prompt).toContain("no humans");
    expect(request.prompt).toContain("scenery");
    expect(request.negativePrompt).toContain("1girl");
    expect(request.negativePrompt).toContain("person");
    expect(request.parameters).toEqual({ width: PLATE_SIZE.width, height: PLATE_SIZE.height, seed: 9 });
  });
});

describe("sprite prompts: NovelAI syntax", () => {
  test("V4+: character caption, quality tags, NovelAI negative, portrait resolution and seed", () => {
    const request = compileSpriteRequest({
      config: config({ imageModel: "nai-diffusion-4-5-full" }), provider: "novelai", member: mira, expression: "laughing", seed: 77,
    });
    expect(request.prompt).toContain("1girl");
    expect(request.prompt).toContain("white background");
    expect(request.prompt).toContain("very aesthetic");
    // V4.5's "location" quality tag would pull the sprite off its white background.
    expect(request.prompt).not.toMatch(/\blocation\b/);
    // The character lives in the caption, not in the base prompt.
    expect(request.prompt).not.toContain("silver hair");
    const characterTags = request.parameters.characterTags as Array<{ tags: string }>;
    expect(characterTags).toHaveLength(1);
    expect(characterTags[0]!.tags).toContain("silver hair");
    expect(characterTags[0]!.tags).toContain("red kimono");
    // NovelAI keeps its native brace emphasis.
    expect(characterTags[0]!.tags).toContain("{{happy, smile, laughing, closed eyes}}");
    expect(request.parameters.resolution).toBe("832x1216");
    expect(request.parameters.seed).toBe(77);
    expect(request.parameters.qualityToggle).toBe(false);
    expect(request.negativePrompt).toContain("lowres");
    expect(request.negativePrompt).toContain("drop shadow");
    expect(request.parameters.negativePrompt).toBe(request.negativePrompt);
  });

  test("V3: everything in one prompt; quality tags can be turned off", () => {
    const request = compileSpriteRequest({
      config: config({ imageModel: "nai-diffusion-3", novelAiQualityTags: false }), provider: "novelai", member: mira, expression: "idle", seed: 1,
    });
    expect(request.prompt).toContain("silver hair");
    expect(request.parameters.characterTags).toEqual([]);
    expect(request.prompt).not.toContain("very aesthetic");
  });

  test("plate: landscape resolution, no character caption", () => {
    const request = compilePlateRequest({
      config: config({ imageModel: "nai-diffusion-4-5-full" }), provider: "novelai",
      plate: { location: "Harbor", timeOfDay: "sunset", weather: null, description: "Harbor" }, seed: 3,
    });
    expect(request.prompt).toContain("Harbor");
    expect(request.prompt).toContain("no humans");
    expect(request.parameters.resolution).toBe("1216x832");
    expect(request.prompt).toMatch(/\blocation\b/);
    expect(request.parameters.characterTags).toEqual([]);
    expect(request.negativePrompt).toContain("people");
  });
});
