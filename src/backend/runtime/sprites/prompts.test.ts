import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../../../config.js";
import {
  compilePlateRequest,
  compileSpriteRequest,
  NOVELAI_PLATE_SIZE,
  NOVELAI_SPRITE_SIZE,
  PLATE_SIZE,
  SPRITE_IMAGE_SIZE_PRESETS,
  SPRITE_FRAMING_TAGS,
  SPRITE_NEGATIVE_TAGS,
  SPRITE_SIZE,
  SPRITE_SKIN_COLOUR_WEIGHT,
  spriteImageSizeFor,
  weightSkinColourTags,
} from "./prompts.js";
import { splitTopLevelCsv } from "../../inlay-prompt/index.js";
import { SPRITE_PROMPT_VERSION } from "./style.js";
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
    expect(request.prompt).toContain("front view");
    expect(request.prompt).toContain("straight-on");
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
    // Default "standard" size: 624x912.
    expect(request.parameters).toEqual({ width: 624, height: 912, seed: 42 });
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
    expect(request.parameters).toEqual({ width: 912, height: 624, seed: 9 });
  });
});

describe("sprite image size (spriteImageSize)", () => {
  const plate = { location: "Harbor", timeOfDay: "sunset", weather: null, description: "Harbor" };

  test("presets: standard 624x912 / 912x624, upscaled 832x1216 / 1216x832", () => {
    expect(SPRITE_IMAGE_SIZE_PRESETS.standard).toEqual({ sprite: { width: 624, height: 912 }, plate: { width: 912, height: 624 } });
    expect(SPRITE_IMAGE_SIZE_PRESETS.upscaled).toEqual({ sprite: { width: 832, height: 1216 }, plate: { width: 1216, height: 832 } });
    expect(SPRITE_SIZE).toEqual({ width: 832, height: 1216 });
    expect(PLATE_SIZE).toEqual({ width: 1216, height: 832 });
    // Same aspect, so a set may mix both sizes.
    const { standard, upscaled } = SPRITE_IMAGE_SIZE_PRESETS;
    expect(standard.sprite.width / standard.sprite.height).toBeCloseTo(upscaled.sprite.width / upscaled.sprite.height, 10);
    // Multiples of 8 (latent size).
    for (const size of [standard.sprite, standard.plate, upscaled.sprite, upscaled.plate]) {
      expect(size.width % 8).toBe(0);
      expect(size.height % 8).toBe(0);
    }
  });

  test("ComfyUI and SwarmUI follow the setting; a missing setting is standard", () => {
    for (const provider of ["comfyui", "swarmui"]) {
      for (const [setting, sprite, landscape] of [
        ["standard", [624, 912], [912, 624]],
        ["upscaled", [832, 1216], [1216, 832]],
      ] as const) {
        const cfg = config({ spriteImageSize: setting });
        expect(compileSpriteRequest({ config: cfg, provider, member: mira, expression: "idle", seed: 1 }).parameters)
          .toEqual({ width: sprite[0], height: sprite[1], seed: 1 });
        expect(compilePlateRequest({ config: cfg, provider, plate, seed: 2 }).parameters)
          .toEqual({ width: landscape[0], height: landscape[1], seed: 2 });
      }
    }
    expect(spriteImageSizeFor("comfyui", "sprite", undefined)).toEqual({ width: 624, height: 912 });
    expect(spriteImageSizeFor("comfyui", "moment", undefined)).toEqual({ width: 912, height: 624 });
    expect(spriteImageSizeFor("swarmui", "moment", "upscaled")).toEqual({ width: 1216, height: 832 });
  });

  test("NovelAI always uses its largest free size (832x1216 / 1216x832), whatever the setting", () => {
    expect(NOVELAI_SPRITE_SIZE.width * NOVELAI_SPRITE_SIZE.height).toBeLessThanOrEqual(1024 * 1024);
    expect(NOVELAI_PLATE_SIZE.width * NOVELAI_PLATE_SIZE.height).toBeLessThanOrEqual(1024 * 1024);
    const requests = (["standard", "upscaled"] as const).map((spriteImageSize) => {
      const cfg = config({ imageModel: "nai-diffusion-4-5-full", spriteImageSize });
      return {
        sprite: compileSpriteRequest({ config: cfg, provider: "novelai", member: mira, expression: "idle", seed: 4 }),
        plate: compilePlateRequest({ config: cfg, provider: "novelai", plate, seed: 4 }),
      };
    });
    for (const { sprite, plate: plateRequest } of requests) {
      expect(sprite.parameters.resolution).toBe("832x1216");
      expect(plateRequest.parameters.resolution).toBe("1216x832");
      expect(sprite.parameters).not.toHaveProperty("width");
      expect(sprite.parameters).not.toHaveProperty("height");
    }
    // The setting does not change the NovelAI request at all.
    expect(requests[0]).toEqual(requests[1]!);
  });

  test("providers without a size stay unchanged", () => {
    for (const spriteImageSize of ["standard", "upscaled"] as const) {
      const cfg = config({ spriteImageSize });
      expect(compileSpriteRequest({ config: cfg, provider: "openai", member: mira, expression: "idle", seed: 5 }).parameters).toEqual({});
      expect(compilePlateRequest({ config: cfg, provider: null, plate, seed: 5 }).parameters).toEqual({});
    }
  });

  test("the size is not part of the style key (existing sets stay)", () => {
    expect(spriteStyleKey(config({ spriteImageSize: "upscaled" }))).toBe(spriteStyleKey(config({ spriteImageSize: "standard" })));
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

describe("sprite framing: tags, weights and any plain-language sentence survive every provider syntax", () => {
  const framing = splitTopLevelCsv(SPRITE_FRAMING_TAGS).map((tag) => tag.trim());
  const negative = splitTopLevelCsv(SPRITE_NEGATIVE_TAGS).map((tag) => tag.trim());
  const weighted = (tags: string[]) => tags.map((tag) => /^\((.+):([0-9.]+)\)$/.exec(tag)).filter((match): match is RegExpExecArray => match !== null);
  const sentenceStart = framing.findIndex((tag) => /^[A-Z]/.test(tag));
  /** A plain-language sentence at the end of the framing, if there is one ("" otherwise). */
  const sentence = sentenceStart >= 0 ? framing.slice(sentenceStart).join(", ") : "";
  const bare = (tag: string) => /^\((.+):([0-9.]+)\)$/.exec(tag)?.[1] ?? tag;
  const plain = { name: "Ren", identity: "1boy, black hair", attire: null, subjectCategory: "male" as const };

  test("the prompt version is bumped for the new framing", () => {
    expect(SPRITE_PROMPT_VERSION).toBe("sprite-prompt-v2");
  });

  test("ComfyUI: every framing and negative tag is sent, weights kept as (tag:w), a sentence whole and last", () => {
    const request = compileSpriteRequest({ config: config(), provider: "comfyui", member: plain, expression: "idle", seed: 1 });
    for (const tag of framing) expect(request.prompt).toContain(tag);
    for (const tag of negative) expect(request.negativePrompt).toContain(tag);
    for (const match of weighted(framing)) expect(request.prompt).toContain(match[0]);
    for (const match of weighted(negative)) expect(request.negativePrompt).toContain(match[0]);
    if (sentence) expect(request.prompt.trimEnd().endsWith(sentence)).toBe(true);
    expect(request.prompt.match(/\bsolo\b/g)?.length).toBe(1);
  });

  test("NovelAI V4+: numeric emphasis w::tag::, the sentence whole in the base prompt", () => {
    for (const model of ["nai-diffusion-4-5-full", "nai-diffusion-4-full"]) {
      const request = compileSpriteRequest({ config: config({ imageModel: model }), provider: "novelai", member: plain, expression: "idle", seed: 1 });
      for (const match of weighted(framing)) expect(request.prompt).toContain(`${Number(match[2])}::${match[1]}::`);
      for (const match of weighted(negative)) expect(request.negativePrompt).toContain(`${Number(match[2])}::${match[1]}::`);
      for (const tag of framing) expect(request.prompt).toContain(bare(tag));
      expect(request.prompt).not.toMatch(/\(/);
      if (sentence) {
        // The sentence is the end of the framing: only quality tags follow it.
        const after = request.prompt.slice(request.prompt.indexOf(sentence) + sentence.length);
        expect(after.split(",").map((tag) => tag.trim()).filter(Boolean).every((tag) => !framing.includes(tag))).toBe(true);
      }
    }
  });

  test("NovelAI legacy (V3): brace emphasis, the sentence whole", () => {
    const request = compileSpriteRequest({ config: config({ imageModel: "nai-diffusion-3" }), provider: "novelai", member: plain, expression: "idle", seed: 1 });
    for (const match of weighted(framing)) expect(request.prompt).toMatch(new RegExp(`\\{+${match[1]!.replace(/[-]/g, "\\-")}\\}+`));
    for (const tag of framing) expect(request.prompt).toContain(bare(tag));
    expect(request.prompt).not.toMatch(/\(|::/);
    expect(request.negativePrompt).not.toMatch(/\(|::/);
  });
});

describe("sprite identity: non-natural skin colours are weighted", () => {
  test("blue, green, purple, grey... skin get the weight; natural tones and coloured skin stay plain", () => {
    expect(SPRITE_SKIN_COLOUR_WEIGHT).toBe(1.15);
    expect(weightSkinColourTags("1girl, slime girl, blue skin, liquid hair")).toBe("1girl, slime girl, (blue skin:1.15), liquid hair");
    for (const tag of ["green skin", "red skin", "purple skin", "pink skin", "grey skin", "gray skin", "orange skin", "yellow skin", "black skin", "light blue skin", "dark green skin", "blue_skin", "Blue Skin"]) {
      expect(weightSkinColourTags(tag)).toBe(`(${tag}:1.15)`);
    }
    for (const tag of ["pale skin", "fair skin", "dark skin", "tan skin", "brown skin", "light skin", "white skin", "colored skin", "dark-skinned female", "blue eyes", "skin tight"]) {
      expect(weightSkinColourTags(tag)).toBe(tag);
    }
  });

  test("already weighted or emphasised tags are left alone", () => {
    for (const text of ["(blue skin:1.3)", "{blue skin}", "[blue skin]", "1.2::blue skin::", "(blue skin)"]) expect(weightSkinColourTags(text)).toBe(text);
  });

  test("sprite prompts carry the weight in each provider's syntax", () => {
    const slime = { name: "Mio", identity: "1girl, slime girl, blue skin, pale skin", attire: null, subjectCategory: "female" as const };
    const comfy = compileSpriteRequest({ config: config(), provider: "comfyui", member: slime, expression: "idle", seed: 1 });
    expect(comfy.prompt).toContain("(blue skin:1.15)");
    expect(comfy.prompt).toContain("pale skin");
    expect(comfy.prompt).not.toContain("(pale skin");
    const nai = compileSpriteRequest({ config: config({ imageModel: "nai-diffusion-4-5-full" }), provider: "novelai", member: slime, expression: "idle", seed: 1 });
    expect((nai.parameters.characterTags as Array<{ tags: string }>)[0]!.tags).toContain("1.15::blue skin::");
    const legacy = compileSpriteRequest({ config: config({ imageModel: "nai-diffusion-3" }), provider: "novelai", member: slime, expression: "idle", seed: 1 });
    expect(legacy.prompt).toContain("{{{blue skin}}}");
  });
});
