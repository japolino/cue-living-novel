import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG } from "../../config.js";
import { TurnPlanSchema, type SceneState, type TurnPlan, type VisualCue } from "../../shared/contracts.js";
import {
  createAssetJobs,
  cueCharacterName,
  generateAssets,
  parseDataUrl,
  portraitIdentityFingerprint,
  referenceAnchoringEnabled,
  referenceParametersFor,
  splitConnectionSelection
} from "./images.js";
import { loadPortraits, portraitStatePath, savePortrait, type StoredPortrait } from "./storage.js";

const now = new Date().toISOString();
const key = {
  chatId: "chat",
  assistantMessageId: "message",
  swipeId: 0,
  sourceFingerprint: "12345678abcdef",
  revision: 0
};

const scene: SceneState = {
  sceneId: "scene",
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
    framing: "medium wide",
    angle: "eye level",
    perspective: "fixed",
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

function cue(id: string, paragraphIndex = 0, character?: string, poseExpressionId = "smile"): VisualCue {
  return {
    cueId: `cue-${id}`,
    paragraphIndex,
    sceneId: "scene",
    sceneRevision: 0,
    kind: "flattened_scene",
    action: null,
    expression: null,
    poseExpressionId,
    promptDelta: "",
    ...(character ? { character } : {}),
    assetJobId: `job-${id}`
  };
}

function plan(cues: VisualCue[]): TurnPlan {
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
    scenes: [scene],
    visualCues: cues,
    choices: [],
    initialContinuity: { revision: 0, characters: {}, facts: {} },
    continuityDeltas: [],
    terminalContinuity: { revision: 0, characters: {}, facts: {} },
    planningStatus: "planned",
    createdAt: now
  });
}

const portrait: StoredPortrait = {
  name: "Mira",
  imageId: "img-1",
  data: "QUJD",
  mimeType: "image/png",
  createdAt: now
};

describe("referenceAnchoringEnabled", () => {
  test("defaults to on and honours the settings toggle", () => {
    expect(referenceAnchoringEnabled(DEFAULT_CONFIG)).toBe(true);
    expect(referenceAnchoringEnabled({ ...DEFAULT_CONFIG, referenceAnchoring: false })).toBe(false);
  });

  test("still honours the imageParameters escape hatch", () => {
    expect(referenceAnchoringEnabled({
      ...DEFAULT_CONFIG,
      imageParameters: { referenceAnchoring: false }
    })).toBe(false);
  });
});

describe("cueCharacterName", () => {
  test("prefers the cue character, then the scene, then the cast", () => {
    expect(cueCharacterName(scene, cue("a", 0, "Hina"))).toBe("Hina");
    expect(cueCharacterName(scene, cue("b", 0))).toBe("Mira");
    expect(cueCharacterName({ ...scene, cast: [], character: null }, cue("c", 0))).toBe("");
  });
});

describe("referenceParametersFor", () => {
  test("returns NovelAI director reference images with a clamped strength", () => {
    const config = { ...DEFAULT_CONFIG, imageParameters: { referenceStrength: 4 } };
    const parameters = referenceParametersFor("novelai", portrait, config);
    expect(parameters.resolvedReferenceImages).toEqual([
      { data: "QUJD", strength: 1, infoExtracted: 1, refType: "character" }
    ]);
  });

  test("defaults the NovelAI strength to 0.6", () => {
    const parameters = referenceParametersFor("novelai", portrait, DEFAULT_CONFIG) as {
      resolvedReferenceImages: Array<{ strength: number }>;
    };
    expect(parameters.resolvedReferenceImages[0]?.strength).toBe(0.6);
  });

  test("returns ComfyUI/SwarmUI source images", () => {
    for (const provider of ["comfyui", "swarmui"]) {
      expect(referenceParametersFor(provider, portrait, DEFAULT_CONFIG)).toEqual({
        resolvedSourceImages: [{ data: "QUJD", mimeType: "image/png" }]
      });
    }
  });

  test("returns nothing for unknown providers", () => {
    expect(referenceParametersFor("openai", portrait, DEFAULT_CONFIG)).toEqual({});
    expect(referenceParametersFor(null, portrait, DEFAULT_CONFIG)).toEqual({});
  });
});

describe("parseDataUrl", () => {
  test("parses a base64 data URL", () => {
    expect(parseDataUrl("data:image/webp;base64,QUJD")).toEqual({ mimeType: "image/webp", data: "QUJD" });
  });

  test("rejects malformed input", () => {
    expect(parseDataUrl(undefined)).toBeNull();
    expect(parseDataUrl("not a data url")).toBeNull();
    expect(parseDataUrl("data:image/png;base64,")).toBeNull();
  });
});

function storageRuntime(): { spindle: SpindleAPI; data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  const spindle = {
    userStorage: {
      getJson: async (path: string, readOptions: { fallback: unknown }) => data.get(path) ?? readOptions.fallback,
      setJson: async (path: string, value: unknown) => { data.set(path, value); }
    }
  } as unknown as SpindleAPI;
  return { spindle, data };
}

describe("portrait storage", () => {
  test("portraitStatePath is per chat", () => {
    expect(portraitStatePath("chat-1")).toBe("chats/chat-1/portraits.json");
  });

  test("savePortrait stores once and is first-wins", async () => {
    const { spindle, data } = storageRuntime();
    expect(await savePortrait(spindle, "chat-1", portrait)).toBe(true);
    const rival: StoredPortrait = { ...portrait, imageId: "img-2", data: "WFla" };
    expect(await savePortrait(spindle, "chat-1", rival)).toBe(false);
    const loaded = await loadPortraits(spindle, "chat-1");
    expect(loaded.mira?.imageId).toBe("img-1");
    expect(loaded.mira?.data).toBe("QUJD");
    expect(data.has("chats/chat-1/portraits.json")).toBe(true);
  });

  test("savePortrait keys case-insensitively and rejects unusable portraits", async () => {
    const { spindle } = storageRuntime();
    await savePortrait(spindle, "chat-1", { ...portrait, name: "MIRA" });
    expect(await savePortrait(spindle, "chat-1", { ...portrait, name: "mira", imageId: "img-9" })).toBe(false);
    expect(await savePortrait(spindle, "chat-1", { ...portrait, name: "" })).toBe(false);
    expect(await savePortrait(spindle, "chat-1", { ...portrait, name: "Theo", data: "" })).toBe(false);
  });

  test("loadPortraits tolerates corrupt records", async () => {
    const { spindle, data } = storageRuntime();
    data.set("chats/chat-1/portraits.json", { schemaVersion: 1, portraits: { mira: { nope: true }, theo: null } });
    expect(await loadPortraits(spindle, "chat-1")).toEqual({});
  });
});

type GenerateCall = {
  prompt: string;
  parameters: Record<string, unknown>;
  includeDataUrl?: boolean;
  connection_id?: string;
};

function imageRuntime(provider: string): {
  spindle: SpindleAPI;
  calls: GenerateCall[];
  data: Map<string, unknown>;
} {
  const { spindle: base, data } = storageRuntime();
  const calls: GenerateCall[] = [];
  const spindle = base as unknown as Record<string, unknown>;
  spindle.imageGen = {
    // Strict like the host: a compound "conn::wf" id is not a real connection.
    getConnection: async (id: string) => id.includes("::") ? null : ({ provider }),
    listConnections: async () => [{ provider, is_default: true }],
    generate: async (input: GenerateCall & { includeDataUrl?: boolean; connection_id?: string }) => {
      calls.push({ prompt: input.prompt, parameters: input.parameters, ...(input.includeDataUrl !== undefined ? { includeDataUrl: input.includeDataUrl } : {}), ...(input.connection_id ? { connection_id: input.connection_id } : {}) });
      const index = calls.length;
      return {
        imageId: `img-${index}`,
        imageUrl: `/images/img-${index}`,
        ...(input.includeDataUrl ? { imageDataUrl: "data:image/png;base64,UE9SVFJBSVQ=" } : {}),
        model: "m",
        provider
      };
    }
  };
  return { spindle: spindle as unknown as SpindleAPI, calls, data };
}

describe("generateAssets reference anchoring", () => {
  const config = {
    ...DEFAULT_CONFIG,
    imageConnectionId: "conn",
    imageConcurrency: 1
  };

  test("captures the first image as the portrait, then anchors later cues", async () => {
    const { spindle, calls } = imageRuntime("comfyui");
    const turnPlan = plan([cue("one", 0), cue("two", 1, undefined, "sad")]);
    const jobs = createAssetJobs(turnPlan, config);
    const finalJobs = await generateAssets(spindle, turnPlan, jobs, config, new AbortController().signal, () => {});

    expect(finalJobs.every((job) => job.status === "generated")).toBe(true);
    expect(calls.length).toBe(2);
    expect(calls[0]?.includeDataUrl).toBe(true);
    expect(calls[0]?.parameters.resolvedSourceImages).toBeUndefined();
    expect(calls[1]?.includeDataUrl).toBe(false);
    expect(calls[1]?.parameters.resolvedSourceImages).toEqual([
      { data: "UE9SVFJBSVQ=", mimeType: "image/png" }
    ]);

    const portraits = await loadPortraits(spindle, "chat");
    expect(portraits.mira?.imageId).toBe("img-1");
  });

  test("anchors NovelAI generations with director reference images", async () => {
    const { spindle, calls } = imageRuntime("novelai");
    await savePortrait(spindle, "chat", { ...portrait, identityFingerprint: portraitIdentityFingerprint("Mira", scene.identityPrompt!, config, "novelai") });
    const turnPlan = plan([cue("one", 0)]);
    const jobs = createAssetJobs(turnPlan, config);
    await generateAssets(spindle, turnPlan, jobs, config, new AbortController().signal, () => {});

    expect(calls[0]?.parameters.resolvedReferenceImages).toEqual([
      { data: "QUJD", strength: 0.6, infoExtracted: 1, refType: "character" }
    ]);
    expect(calls[0]?.includeDataUrl).toBe(false);
  });

  test("does not anchor or capture for unsupported providers or when opted out", async () => {
    const unsupported = imageRuntime("openai");
    await generateAssets(unsupported.spindle, plan([cue("one", 0)]), createAssetJobs(plan([cue("one", 0)]), config), config, new AbortController().signal, () => {});
    expect(unsupported.calls[0]?.includeDataUrl).toBe(false);
    expect(unsupported.calls[0]?.parameters.resolvedSourceImages).toBeUndefined();

    const optedOut = imageRuntime("comfyui");
    const offConfig = { ...config, referenceAnchoring: false };
    await generateAssets(optedOut.spindle, plan([cue("one", 0)]), createAssetJobs(plan([cue("one", 0)]), offConfig), offConfig, new AbortController().signal, () => {});
    expect(optedOut.calls[0]?.includeDataUrl).toBe(false);
    expect(optedOut.calls[0]?.parameters.resolvedSourceImages).toBeUndefined();
  });
});

describe("portrait identity provenance", () => {
  const config = { ...DEFAULT_CONFIG, imageConnectionId: "conn", imageConcurrency: 2 };
  test("legacy and mismatched portraits are replaced without feeding the old image back", async () => {
    for (const identityFingerprint of [undefined, "old-identity"]) {
      const { spindle, calls } = imageRuntime("comfyui");
      await savePortrait(spindle, "chat", { ...portrait, ...(identityFingerprint ? { identityFingerprint } : {}) });
      const turnPlan = plan([cue("one", 0, "Mira", "smile"), cue("two", 1, "Mira", "sad")]);
      await generateAssets(spindle, turnPlan, createAssetJobs(turnPlan, config), config, new AbortController().signal, () => {});
      expect(calls[0]?.parameters.resolvedSourceImages).toBeUndefined();
      expect(calls[0]?.includeDataUrl).toBe(true);
      expect(calls[1]?.parameters.resolvedSourceImages).toEqual([{ data: "UE9SVFJBSVQ=", mimeType: "image/png" }]);
      expect((await loadPortraits(spindle, "chat")).mira?.identityFingerprint).toBe(portraitIdentityFingerprint("Mira", scene.identityPrompt!, config, "comfyui"));
    }
  });

  test("fingerprints track identity, entity, model and workflow, but tolerate tag order", () => {
    const baseline = portraitIdentityFingerprint("Mira", "blue eyes, black hair", config, "comfyui");
    expect(portraitIdentityFingerprint("mira", "black hair, blue eyes", config, "comfyui")).toBe(baseline);
    expect(portraitIdentityFingerprint("Mira", "green eyes, black hair", config, "comfyui")).not.toBe(baseline);
    expect(portraitIdentityFingerprint("Other", "blue eyes, black hair", config, "comfyui")).not.toBe(baseline);
    expect(portraitIdentityFingerprint("Mira", "blue eyes, black hair", { ...config, imageModel: "new" }, "comfyui")).not.toBe(baseline);
    expect(portraitIdentityFingerprint("Mira", "blue eyes, black hair", { ...config, imageConnectionId: "conn::other" }, "comfyui")).not.toBe(baseline);
    expect(portraitIdentityFingerprint("Mira", "blue eyes, black hair", config, "novelai")).not.toBe(baseline);
  });

  test("unresolved new subjects fail visibly without generating or capturing a substitute", async () => {
    const { spindle, calls } = imageRuntime("comfyui");
    const turnPlan = plan([{ ...cue("one", 0, "Visitor"), resolvedIdentity: "", resolvedAttire: null }]);
    const jobs = await generateAssets(spindle, turnPlan, createAssetJobs(turnPlan, config), config, new AbortController().signal, () => {});
    expect(calls).toHaveLength(0);
    expect(jobs[0]?.status).toBe("failed");
    expect(jobs[0]?.error).toContain("No usable appearance");
    expect(await loadPortraits(spindle, "chat")).toEqual({});
  });

  test("secondary cue snapshots fingerprint their own identity rather than the scene lead", async () => {
    const { spindle, calls } = imageRuntime("comfyui");
    const turnPlan = plan([{ ...cue("one", 0, "Other"), resolvedIdentity: "red hair, blue eyes" }]);
    await generateAssets(spindle, turnPlan, createAssetJobs(turnPlan, config), config, new AbortController().signal, () => {});
    const stored = (await loadPortraits(spindle, "chat")).other!;
    expect(stored.identityFingerprint).toBe(portraitIdentityFingerprint("Other", "red hair, blue eyes", config, "comfyui"));
    expect(calls[0]?.parameters.resolvedSourceImages).toBeUndefined();
  });
});

describe("splitConnectionSelection", () => {
  test("passes plain connection ids through", () => {
    expect(splitConnectionSelection("conn-1")).toEqual({ connectionId: "conn-1" });
    expect(splitConnectionSelection(null)).toEqual({});
  });

  test("splits compound workflow selections", () => {
    expect(splitConnectionSelection("conn-1::wf-2")).toEqual({ connectionId: "conn-1", workflowId: "wf-2" });
  });
});

describe("generateAssets with a compound workflow selection", () => {
  test("resolves the provider from the real connection id and forwards workflow_id", async () => {
    const { spindle, calls } = imageRuntime("comfyui");
    const config = { ...DEFAULT_CONFIG, imageConnectionId: "conn::wf-yume", imageConcurrency: 1 };
    await savePortrait(spindle, "chat", { ...portrait, identityFingerprint: portraitIdentityFingerprint("Mira", scene.identityPrompt!, config, "comfyui") });
    const turnPlan = plan([cue("one", 0)]);
    await generateAssets(spindle, turnPlan, createAssetJobs(turnPlan, config), config, new AbortController().signal, () => {});

    // Provider lookup must use the real id, so anchoring stays active…
    expect(calls[0]?.parameters.resolvedSourceImages).toEqual([
      { data: "QUJD", mimeType: "image/png" }
    ]);
    // …and the workflow sub-selection travels as workflow_id.
    expect(calls[0]?.parameters.workflow_id).toBe("wf-yume");
    expect(calls[0]?.connection_id).toBe("conn");
  });
});

describe("Finding #11: reference-capture race and recovery", () => {
  test("default concurrency: subsequent same-character cues wait for capture and become anchored", async () => {
    const { spindle, calls } = imageRuntime("comfyui");
    const config = { ...DEFAULT_CONFIG, imageConnectionId: "conn", imageConcurrency: 2 };
    const turnPlan = plan([
      cue("one", 0, "Mira", "smile"),
      cue("two", 1, "Mira", "sad"),
      cue("three", 2, "Mira", "wave")
    ]);
    const jobs = createAssetJobs(turnPlan, config);
    const finalJobs = await generateAssets(spindle, turnPlan, jobs, config, new AbortController().signal, () => {});

    expect(finalJobs.every((j) => j.status === "generated")).toBe(true);
    expect(calls).toHaveLength(3);

    // First call captures the portrait
    expect(calls[0]?.includeDataUrl).toBe(true);
    expect(calls[0]?.parameters.resolvedSourceImages).toBeUndefined();

    // Second and third calls must be anchored to the captured portrait!
    expect(calls[1]?.includeDataUrl).toBe(false);
    expect(calls[1]?.parameters.resolvedSourceImages).toEqual([
      { data: "UE9SVFJBSVQ=", mimeType: "image/png" }
    ]);
    expect(calls[2]?.includeDataUrl).toBe(false);
    expect(calls[2]?.parameters.resolvedSourceImages).toEqual([
      { data: "UE9SVFJBSVQ=", mimeType: "image/png" }
    ]);
  });

  test("failed first provider result releases capture ownership in finally, allowing subsequent cue to capture", async () => {
    let callCount = 0;
    const { spindle: base } = storageRuntime();
    const calls: any[] = [];
    const spindle = base as any;
    spindle.imageGen = {
      getConnection: async () => ({ provider: "comfyui" }),
      listConnections: async () => [{ provider: "comfyui", is_default: true }],
      generate: async (input: any) => {
        calls.push(input);
        callCount++;
        // First call fails missing imageId
        if (callCount === 1) {
          return { imageDataUrl: "data:image/png;base64,UE9SVFJBSVQ=" };
        }
        return {
          imageId: `img-${callCount}`,
          imageUrl: `/images/img-${callCount}`,
          imageDataUrl: input.includeDataUrl ? "data:image/png;base64,UE9SVFJBSVQ=" : undefined
        };
      }
    };

    const config = { ...DEFAULT_CONFIG, imageConnectionId: "conn", imageConcurrency: 1 };
    const turnPlan = plan([
      cue("one", 0, "Mira", "smile"),
      cue("two", 1, "Mira", "sad")
    ]);
    const jobs = createAssetJobs(turnPlan, config);
    const finalJobs = await generateAssets(spindle, turnPlan, jobs, config, new AbortController().signal, () => {});

    expect(finalJobs[0]?.status).toBe("failed");
    expect(finalJobs[1]?.status).toBe("generated");

    // Because first capture failed, ownership was released in finally,
    // so second cue successfully requested capture!
    expect(calls[0]?.includeDataUrl).toBe(true);
    expect(calls[1]?.includeDataUrl).toBe(true);

    const portraits = await loadPortraits(spindle, "chat");
    expect(portraits.mira?.imageId).toBe("img-2");
  });

  test("unrelated characters remain concurrent without waiting on each other", async () => {
    const events: string[] = [];
    const { spindle: base } = storageRuntime();
    const spindle = base as any;
    spindle.imageGen = {
      getConnection: async () => ({ provider: "comfyui" }),
      listConnections: async () => [{ provider: "comfyui", is_default: true }],
      generate: async (input: any) => {
        const isMira = input.prompt.includes("silver hair");
        const name = isMira ? "Mira" : "Rin";
        events.push(`${name}-start`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        events.push(`${name}-end`);
        return {
          imageId: `img-${name}`,
          imageUrl: `/images/img-${name}`,
          imageDataUrl: "data:image/png;base64,UE9SVFJBSVQ="
        };
      }
    };

    const config = { ...DEFAULT_CONFIG, imageConnectionId: "conn", imageConcurrency: 2 };
    const turnPlan = plan([
      cue("one", 0, "Mira", "smile"),
      cue("two", 1, "Rin", "smile")
    ]);
    const jobs = createAssetJobs(turnPlan, config);
    await generateAssets(spindle, turnPlan, jobs, config, new AbortController().signal, () => {});

    // Both Mira and Rin should start concurrently before either ends
    expect(events.slice(0, 2)).toEqual(["Mira-start", "Rin-start"]);
  });
});
