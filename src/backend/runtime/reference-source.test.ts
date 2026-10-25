import { describe, expect, test } from "bun:test";
import type { CharacterDTO, SpindleAPI } from "lumiverse-spindle-types";
import { TurnPlanSchema, type SceneState, type TurnPlan, type VisualCue } from "../../shared/contracts.js";
import type { CharacterRegistry } from "../../shared/identity.js";
import {
  assetNameMatches,
  cardBackgroundImageId,
  chooseCardAssetName,
  collectCardAssetNames,
  fetchReferenceImageViaFrontend,
  handleReferenceImageResponse,
  matchCardAssetForNames,
  normalizeAssetText,
  resolveCardAssetsForPlan
} from "./reference-source.js";
import scenarioCard from "./__fixtures__/scenario-card.json";
import singleCharacterCard from "./__fixtures__/single-character-card.json";
import avatarOnlyCard from "./__fixtures__/avatar-only-card.json";

const now = new Date().toISOString();
const key = {
  chatId: "chat",
  assistantMessageId: "message",
  swipeId: 0,
  sourceFingerprint: "12345678abcdef",
  revision: 0
};

function scene(cast: string[]): SceneState {
  return {
    sceneId: "scene",
    revision: 0,
    startParagraph: 0,
    environment: {
      location: "Great Hall",
      timeOfDay: "day",
      weather: null,
      lighting: "daylight",
      description: "A vaulted hall.",
      persistentElements: []
    },
    cast,
    continuity: { revision: 0, characters: {}, facts: {} },
    basePrompt: "vaulted hall",
    identityPrompt: "silver hair, green eyes",
    cameraLock: {
      framing: "medium wide",
      angle: "eye level",
      perspective: "fixed",
      lens: "50mm",
      subjectAnchor: "center",
      horizon: "upper third",
      safeDialogueRegion: "lower third",
      aspectRatio: "16:9"
    },
    compositionLock: "centered",
    activeAssetId: null,
    priorSceneId: null
  };
}

function cue(id: string, paragraphIndex: number, character?: string): VisualCue {
  return {
    cueId: `cue-${id}`,
    paragraphIndex,
    sceneId: "scene",
    sceneRevision: 0,
    kind: "flattened_scene",
    action: null,
    expression: null,
    poseExpressionId: "smile",
    promptDelta: "",
    ...(character ? { character } : {}),
    assetJobId: `job-${id}`
  };
}

function plan(cues: VisualCue[], cast: string[] = ["Aurelia"]): TurnPlan {
  const maxP = Math.max(1, ...cues.map((c) => c.paragraphIndex));
  const paragraphs = Array.from({ length: maxP + 1 }, (_, index) => ({
    index,
    sourceIndex: index,
    text: `Paragraph ${index}.`
  }));
  return TurnPlanSchema.parse({
    schemaVersion: 1,
    key,
    paragraphs,
    scenes: [scene(cast)],
    visualCues: cues,
    choices: [],
    initialContinuity: { revision: 0, characters: {}, facts: {} },
    continuityDeltas: [],
    terminalContinuity: { revision: 0, characters: {}, facts: {} },
    planningStatus: "planned",
    createdAt: now
  });
}

const scenario = scenarioCard as unknown as CharacterDTO;
const singleCharacter = singleCharacterCard as unknown as CharacterDTO;
const avatarOnly = avatarOnlyCard as unknown as CharacterDTO;
const emptyRegistry: CharacterRegistry = {};

describe("normalizeAssetText", () => {
  test("lowercases, strips diacritics, and collapses every separator run", () => {
    expect(normalizeAssetText("Aurélia_Evil  Smile")).toBe("aurelia evil smile");
    expect(normalizeAssetText("kasumi&bikini&neutral")).toBe("kasumi bikini neutral");
    expect(normalizeAssetText("mob_guild_receptionist")).toBe("mob guild receptionist");
  });
});

describe("assetNameMatches (token-bounded prefix)", () => {
  test("matches the bare name, separator variants, and numbered variants", () => {
    expect(assetNameMatches("Aurelia", "Aurelia")).toBe(true);
    expect(assetNameMatches("aurelia_smirking", "Aurelia")).toBe(true);
    expect(assetNameMatches("kasumi&bikini&neutral", "Kasumi")).toBe(true);
    expect(assetNameMatches("elizabeth2_smug", "Elizabeth")).toBe(true);
    expect(assetNameMatches("elizabeth2", "Elizabeth")).toBe(true);
    expect(assetNameMatches("name2_smirk", "Name")).toBe(true);
  });

  test("never matches inside a longer word: 'Al' is not 'alicia', 'aurelia' is not 'aurelian'", () => {
    expect(assetNameMatches("alicia", "Al")).toBe(false);
    expect(assetNameMatches("alicia_neutral", "Al")).toBe(false);
    expect(assetNameMatches("aurelian_guard", "Aurelia")).toBe(false);
    expect(assetNameMatches("al_smile", "Al")).toBe(true);
  });

  test("spelling drift does not force a wrong match", () => {
    expect(assetNameMatches("karryn", "Karin Bozinius")).toBe(false);
    expect(assetNameMatches("brunhild", "Brynhild")).toBe(false);
    expect(assetNameMatches("manes", "Mannes")).toBe(false);
  });

  test("strips file extensions before matching", () => {
    expect(assetNameMatches("aurelia_neutral.png", "Aurelia")).toBe(true);
  });
});

describe("chooseCardAssetName preference order", () => {
  test("bare name wins over neutral-ish and shorter variants", () => {
    expect(chooseCardAssetName(["aurelia_smile", "Aurelia", "aurelia_neutral"], "Aurelia")).toBe("Aurelia");
  });

  test("numbered bare variant ranks after the exact bare name", () => {
    expect(chooseCardAssetName(["elizabeth2", "elizabeth"], "Elizabeth")).toBe("elizabeth");
    expect(chooseCardAssetName(["elizabeth2", "elizabeth2_smug"], "Elizabeth")).toBe("elizabeth2");
  });

  test("neutral-ish variants beat other variants; the shortest name is the last resort", () => {
    expect(chooseCardAssetName(["aurelia_evil smile", "aurelia_neutral", "aurelia_a"], "Aurelia")).toBe("aurelia_neutral");
    expect(chooseCardAssetName(["aurelia_smirking", "aurelia_sad"], "Aurelia")).toBe("aurelia_sad");
  });

  test("ties break on the normalized name, never on index order", () => {
    expect(chooseCardAssetName(["aurelia_shy", "aurelia_sad"], "Aurelia")).toBe("aurelia_sad");
    expect(chooseCardAssetName(["aurelia_sad", "aurelia_shy"], "Aurelia")).toBe("aurelia_sad");
  });
});

describe("matchCardAssetForNames", () => {
  const assets = collectCardAssetNames(scenario);

  test("full display name matches through the whole-token prefix rule", () => {
    expect(matchCardAssetForNames(assets, ["Elizabeth"])).toBe("elizabeth");
    expect(matchCardAssetForNames(assets, ["Mob Guild Receptionist"])).toBe("mob_guild_receptionist");
  });

  test("registry aliases are honoured before the single-word fallback", () => {
    expect(matchCardAssetForNames(assets, ["The Empress", "Aurelia"])).toBe("Aurelia");
  });

  test("a single word of a multi-word name only applies when the full names have no match", () => {
    expect(matchCardAssetForNames(assets, ["Empress Aurelia"])).toBe("Aurelia");
    // Single-word names get no word fallback, so a short name cannot creep
    // into a longer asset name.
    expect(matchCardAssetForNames(assets, ["Al"])).toBeNull();
  });

  test("unknown characters and drifted spellings fail cleanly", () => {
    expect(matchCardAssetForNames(assets, ["Guard"])).toBeNull();
    expect(matchCardAssetForNames(assets, ["Karin Bozinius"])).toBeNull();
    expect(matchCardAssetForNames(assets, ["Brynhild"])).toBeNull();
  });
});

describe("resolveCardAssetsForPlan", () => {
  test("a scenario card resolves one sprite per known character; unknown characters get nothing", () => {
    const turnPlan = plan([
      cue("a", 0, "Aurelia"),
      cue("b", 1, "Clarisse"),
      cue("c", 2, "Elizabeth"),
      cue("d", 3, "Guard"),
      cue("e", 4, "Mob Guild Receptionist")
    ], ["Aurelia"]);
    const resolutions = resolveCardAssetsForPlan({ plan: turnPlan, character: scenario, content: "", registry: emptyRegistry });
    expect(resolutions.get("aurelia")?.assetName).toBe("Aurelia");
    expect(resolutions.get("clarisse")?.assetName).toBe("Clarisse");
    expect(resolutions.get("elizabeth")?.assetName).toBe("elizabeth");
    expect(resolutions.get("mob guild receptionist")?.assetName).toBe("mob_guild_receptionist");
    expect(resolutions.has("guard")).toBe(false);
    // Every resolved character got its own asset id.
    const ids = [...resolutions.values()].map((entry) => entry.imageId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("an inline tag in the character's paragraph wins over the prefix match", () => {
    const turnPlan = plan([cue("a", 0, "Aurelia")]);
    const content = 'Aurelia laughed.\n<pimg="aurelia_smirking">';
    const resolutions = resolveCardAssetsForPlan({ plan: turnPlan, character: scenario, content, registry: emptyRegistry });
    expect(resolutions.get("aurelia")).toEqual({ assetName: "aurelia_smirking", imageId: "id-003", via: "inline" });
  });

  test("a drifted inline spelling without a registry alias no longer anchors (character-like only)", () => {
    const turnPlan = plan([cue("a", 0, "Karin Bozinius")], ["Karin Bozinius"]);
    const content = 'Karin Bozinius crossed her arms.\n<pimg="karryn_neutral">';
    const resolutions = resolveCardAssetsForPlan({ plan: turnPlan, character: scenario, content, registry: emptyRegistry });
    expect(resolutions.has("karin bozinius")).toBe(false);
  });

  test("a drifted inline spelling anchors once the registry links it as an alias", () => {
    const registry: CharacterRegistry = {
      "karin-bozinius": { id: "karin-bozinius", name: "Karin Bozinius", aliases: ["karryn"], tags: "", subjectCategory: "female" }
    };
    const turnPlan = plan([cue("a", 0, "Karin Bozinius")], ["Karin Bozinius"]);
    const content = 'Karin Bozinius crossed her arms.\n<pimg="karryn_neutral">';
    const resolutions = resolveCardAssetsForPlan({ plan: turnPlan, character: scenario, content, registry });
    expect(resolutions.get("karin bozinius")?.assetName).toBe("karryn_neutral");
    expect(resolutions.get("karin bozinius")?.via).toBe("inline");
  });

  test("several characters and several tags in one paragraph pair by name similarity", () => {
    const turnPlan = plan([cue("a", 0, "Aurelia"), cue("b", 0, "Elizabeth")]);
    const content = 'They faced each other.\n<pimg="elizabeth_smirking"><pimg="aurelia_happy">';
    const resolutions = resolveCardAssetsForPlan({ plan: turnPlan, character: scenario, content, registry: emptyRegistry });
    expect(resolutions.get("aurelia")?.assetName).toBe("aurelia_happy");
    expect(resolutions.get("elizabeth")?.assetName).toBe("elizabeth_smirking");
  });

  test("an ambiguous tag among several characters is skipped, not guessed", () => {
    const turnPlan = plan([cue("a", 0, "Karin Bozinius"), cue("b", 0, "Brynhild")], ["Karin Bozinius"]);
    const content = 'Both women turned.\n<pimg="karryn_neutral"><pimg="Brunhild">';
    const resolutions = resolveCardAssetsForPlan({ plan: turnPlan, character: scenario, content, registry: emptyRegistry });
    // Neither tag names either character, so step 1 assigns nothing and the
    // prefix step cannot match the drifted spellings either.
    expect(resolutions.has("karin bozinius")).toBe(false);
    expect(resolutions.has("brynhild")).toBe(false);
  });

  test("registry aliases map a display name onto the card's sprite names", () => {
    const registry: CharacterRegistry = {
      "empress-aurelia": { id: "empress-aurelia", name: "Empress Aurelia", aliases: ["Aurelia"], tags: "", subjectCategory: "female" }
    };
    const turnPlan = plan([cue("a", 0, "Empress Aurelia")], ["Empress Aurelia"]);
    const resolutions = resolveCardAssetsForPlan({ plan: turnPlan, character: scenario, content: "", registry });
    expect(resolutions.get("empress aurelia")?.assetName).toBe("Aurelia");
  });

  test("a single-character card with sprites uses a sprite, not the avatar", () => {
    const turnPlan = plan([cue("a", 0, "Aurelia")]);
    const resolutions = resolveCardAssetsForPlan({ plan: turnPlan, character: singleCharacter, content: "", registry: emptyRegistry });
    const resolved = resolutions.get("aurelia");
    expect(resolved?.via).toBe("prefix");
    expect(resolved?.imageId).not.toBe("img-aurelia-avatar");
  });

  test("the avatar is used only on a single-character card without sprites", () => {
    const turnPlan = plan([cue("a", 0, "Aurelia"), cue("b", 1, "Guard")]);
    const resolutions = resolveCardAssetsForPlan({ plan: turnPlan, character: avatarOnly, content: "", registry: emptyRegistry });
    expect(resolutions.get("aurelia")).toEqual({ assetName: "", imageId: "img-avatar-only", via: "avatar" });
    expect(resolutions.has("guard")).toBe(false);
  });

  test("the avatar is never used on a scenario card", () => {
    // Even a character named like the card falls through when other plan
    // characters match card sprites (the card is clearly multi-character).
    const turnPlan = plan([cue("a", 0, "Sex Sex Fantasy"), cue("b", 1, "Aurelia")]);
    const resolutions = resolveCardAssetsForPlan({ plan: turnPlan, character: scenario, content: "", registry: emptyRegistry });
    expect(resolutions.has("sex sex fantasy")).toBe(false);
  });
});

describe("reference image relay", () => {
  function relaySpindle(): { spindle: SpindleAPI; sent: Array<Record<string, unknown>> } {
    const sent: Array<Record<string, unknown>> = [];
    const spindle = {
      sendToFrontend: (message: Record<string, unknown>) => { sent.push(message); }
    } as unknown as SpindleAPI;
    return { spindle, sent };
  }

  test("a matching reply resolves the pending fetch with the data URL", async () => {
    const { spindle, sent } = relaySpindle();
    const pending = fetchReferenceImageViaFrontend(spindle, { chatId: "chat", imageId: "img-1", characterKey: "aurelia" });
    const request = sent[0]!;
    expect(request.type).toBe("vn_reference_fetch");
    expect(request.imageId).toBe("img-1");
    expect(request.characterKey).toBe("aurelia");
    expect(handleReferenceImageResponse({ requestId: String(request.requestId), dataUrl: "data:image/png;base64,QUJD" })).toBe(true);
    expect(await pending).toBe("data:image/png;base64,QUJD");
  });

  test("an error reply, an oversize payload, and a timeout each resolve null", async () => {
    const { spindle, sent } = relaySpindle();
    const failing = fetchReferenceImageViaFrontend(spindle, { chatId: "chat", imageId: "img-1", characterKey: "aurelia" });
    handleReferenceImageResponse({ requestId: String(sent[0]!.requestId), error: "fetch failed" });
    expect(await failing).toBeNull();

    const oversized = fetchReferenceImageViaFrontend(spindle, { chatId: "chat", imageId: "img-2", characterKey: "aurelia" });
    handleReferenceImageResponse({ requestId: String(sent[1]!.requestId), dataUrl: `data:image/png;base64,${"A".repeat(12 * 1024 * 1024)}` });
    expect(await oversized).toBeNull();

    const timingOut = fetchReferenceImageViaFrontend(spindle, { chatId: "chat", imageId: "img-3", characterKey: "aurelia", timeoutMs: 1 });
    expect(await timingOut).toBeNull();
    // A reply after the timeout finds no pending fetch and is dropped.
    expect(handleReferenceImageResponse({ requestId: String(sent[2]!.requestId), dataUrl: "data:image/png;base64,QUJD" })).toBe(false);
  });

  test("unknown request ids are ignored", () => {
    expect(handleReferenceImageResponse({ requestId: "nope", dataUrl: "data:image/png;base64,QUJD" })).toBe(false);
  });
});


test("unresolvable bare entries do not shadow a usable sprite variant", () => {
  const card = { ...singleCharacterCard, extensions: { lumirealm: { asset_index: {
    Aurelia: { ext: "png", imageIds: [] },
    Aurelia_neutral: { imageIds: ["usable"] }
  } } } } as unknown as CharacterDTO;
  expect(collectCardAssetNames(card)).toEqual(["Aurelia_neutral"]);
  const result = resolveCardAssetsForPlan({ plan: plan([cue("a", 0, "Aurelia")], ["Aurelia"]), character: card, content: "", registry: emptyRegistry });
  expect(result.get("aurelia")?.imageId).toBe("usable");
});

describe("card background picture", () => {
  const card = (map: Record<string, string>) => ({ ...singleCharacterCard, extensions: { risu_asset_map: map } }) as unknown as CharacterDTO;

  test("an asset named bg, background or 배경 is the card's background", () => {
    expect(cardBackgroundImageId(card({ Aurelia_smile: "smile", "BG.png": "bg-id" }))).toBe("bg-id");
    expect(cardBackgroundImageId(card({ Background: "background-id" }))).toBe("background-id");
    expect(cardBackgroundImageId(card({ "배경.webp": "korean-id" }))).toBe("korean-id");
  });

  test("bg wins over background; a card without one has none", () => {
    expect(cardBackgroundImageId(card({ background: "second", bg: "first" }))).toBe("first");
    expect(cardBackgroundImageId(card({ Aurelia_smile: "smile", bgm_theme: "music" }))).toBeNull();
  });
});
