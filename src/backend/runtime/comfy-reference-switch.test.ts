import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../../config.js";
import { TurnPlanSchema, type SceneState, type TurnPlan, type VisualCue } from "../../shared/contracts.js";
import anima from "./__fixtures__/anima29b-connection.json";
import { lumiverseCustomValue } from "./__fixtures__/lumiverse-custom.js";
import {
  REFERENCE_SWITCH_TTL_MS,
  comfyWorkflowConfigFor,
  cutoutSwitchParameters,
  findCutoutSwitch,
  findReferenceSwitch,
  referenceSwitchParameters,
  resolveComfySwitches,
  resolveReferenceSwitch
} from "./comfy-reference-switch.js";
import { createAssetJobs, generateAssets } from "./images.js";

const animaConfig = anima.metadata.comfyui as unknown as Record<string, unknown>;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A minimal workflow config: one custom mapping on one node. */
function single(node: Record<string, unknown>, fieldName = "value"): Record<string, unknown> {
  return {
    workflow_json: {},
    workflow_api_json: { "9": node },
    workflow_format: "api_prompt",
    field_mappings: [{ nodeId: "9", fieldName, mappedAs: "custom" }],
    imported_at: 1
  };
}

describe("findReferenceSwitch", () => {
  test("finds the Anima 2.9b IP-Adapter Boolean (804:value)", () => {
    expect(findReferenceSwitch(animaConfig)).toBe("804:value");
    expect(findReferenceSwitch(comfyWorkflowConfigFor(anima.metadata))).toBe("804:value");
  });

  test("matches by title or class type, on a PrimitiveBoolean or a boolean input", () => {
    expect(findReferenceSwitch(single({ class_type: "PrimitiveBoolean", inputs: { value: false }, _meta: { title: "Use reference" } }))).toBe("9:value");
    expect(findReferenceSwitch(single({ class_type: "PrimitiveBoolean", inputs: { value: true }, _meta: { title: "ref on" } }))).toBe("9:value");
    expect(findReferenceSwitch(single({ class_type: "CustomToggle", inputs: { enabled: true }, _meta: { title: "IPAdapter enabled" } }, "enabled"))).toBe("9:enabled");
    expect(findReferenceSwitch(single({ class_type: "IPAdapterToggle", inputs: { on: false } }, "on"))).toBe("9:on");
  });

  test("no match for a non-boolean custom field or an unrelated title", () => {
    // The IP-Adapter strength node mapped as custom: an INT/FLOAT, not a switch.
    expect(findReferenceSwitch(single({ class_type: "AnimaIPAdapterApply", inputs: { ref_image_size: 512 }, _meta: { title: "IP-Adapter strength" } }, "ref_image_size"))).toBeNull();
    expect(findReferenceSwitch(single({ class_type: "PrimitiveBoolean", inputs: { value: true }, _meta: { title: "Enable upscale" } }))).toBeNull();
    expect(findReferenceSwitch(single({ class_type: "PrimitiveString", inputs: { value: "reference" }, _meta: { title: "Reference name" } }))).toBeNull();
    // "prefer" or "refine" is not "ref".
    expect(findReferenceSwitch(single({ class_type: "PrimitiveBoolean", inputs: { value: true }, _meta: { title: "Refiner pass" } }))).toBeNull();
  });

  test("only custom mappings count, and a missing node is skipped", () => {
    const config = clone(animaConfig);
    (config.field_mappings as Array<Record<string, unknown>>).find((mapping) => mapping.nodeId === "804")!.mappedAs = "seed";
    expect(findReferenceSwitch(config)).toBeNull();
    const missing = single({ class_type: "PrimitiveBoolean", inputs: { value: true }, _meta: { title: "Enable IP-Adapter" } });
    missing.field_mappings = [{ nodeId: "404", fieldName: "value", mappedAs: "custom" }];
    expect(findReferenceSwitch(missing)).toBeNull();
    expect(findReferenceSwitch(null)).toBeNull();
  });

  test("reads a UI graph when there is no API prompt", () => {
    const ui = {
      workflow_json: { nodes: [{ id: 12, type: "PrimitiveBoolean", title: "Enable IP-Adapter", widgets_values: [true] }] },
      field_mappings: [{ nodeId: "12", fieldName: "value", mappedAs: "custom" }]
    };
    expect(findReferenceSwitch(ui)).toBe("12:value");
  });
});

describe("comfyWorkflowConfigFor", () => {
  const withSwitch = (title: string) => single({ class_type: "PrimitiveBoolean", inputs: { value: true }, _meta: { title } });
  const metadata = {
    comfyui: withSwitch("Legacy reference"),
    comfyui_workflows: [
      { id: "wf-a", name: "A", config: withSwitch("A IP-Adapter") },
      { id: "wf-b", name: "B", config: single({ class_type: "PrimitiveBoolean", inputs: { value: true }, _meta: { title: "Upscale" } }) }
    ],
    comfyui_active_workflow_id: "wf-b"
  };
  const titleOf = (config: Record<string, unknown> | null) => ((config?.workflow_api_json as Record<string, { _meta: { title: string } }> | undefined)?.["9"]?._meta.title) ?? null;

  test("library entry by workflow id, else the active entry, else metadata.comfyui", () => {
    expect(titleOf(comfyWorkflowConfigFor(metadata, "wf-a"))).toBe("A IP-Adapter");
    expect(titleOf(comfyWorkflowConfigFor(metadata))).toBe("Upscale");
    expect(titleOf(comfyWorkflowConfigFor({ ...metadata, comfyui_active_workflow_id: "gone" }))).toBe("Legacy reference");
    expect(titleOf(comfyWorkflowConfigFor({ comfyui: metadata.comfyui }))).toBe("Legacy reference");
    // An unknown explicit workflow id makes Lumiverse fail; there is nothing to switch.
    expect(comfyWorkflowConfigFor(metadata, "missing")).toBeNull();
    expect(comfyWorkflowConfigFor(null)).toBeNull();
  });
});

describe("referenceSwitchParameters", () => {
  const reference = { resolvedSourceImages: [{ data: "QUJD", mimeType: "image/png" }], denoise: 0.7 };

  test("with a reference: switch on plus the reference parameters", () => {
    const result = referenceSwitchParameters("comfyui", { steps: 20 }, reference, "804:value");
    expect(result.parameters).toEqual({ steps: 20, ...reference, comfyui_custom_fields: { "804:value": true } });
    expect(result.note).toBe("reference switch 804:value -> on");
  });

  test("without a reference: switch off and no denoise 0.0", () => {
    const result = referenceSwitchParameters("comfyui", { steps: 20 }, null, "804:value");
    expect(result.parameters).toEqual({ steps: 20, comfyui_custom_fields: { "804:value": false } });
    expect(result.note).toBe("reference switch 804:value -> off");
  });

  test("the user's comfyui_custom_fields or custom is merged; their value for the same key wins", () => {
    expect(referenceSwitchParameters("comfyui", { comfyui_custom_fields: { "7:text": "x" } }, null, "804:value").parameters.comfyui_custom_fields)
      .toEqual({ "7:text": "x", "804:value": false });
    const fromCustom = referenceSwitchParameters("comfyui", { custom: { "7:text": "y" } }, reference, "804:value").parameters;
    expect(fromCustom.comfyui_custom_fields).toEqual({ "7:text": "y", "804:value": true });
    expect(fromCustom.custom).toEqual({ "7:text": "y" });
    // comfyui_custom_fields is the one Lumiverse reads when both are set.
    expect(referenceSwitchParameters("comfyui", { comfyui_custom_fields: { a: 1 }, custom: { b: 2 } }, null, "804:value").parameters.comfyui_custom_fields)
      .toEqual({ a: 1, "804:value": false });
    const owned = referenceSwitchParameters("comfyui", { custom: { "804:value": true } }, null, "804:value");
    // Written where it wins over the Image Gen panel's saved values too.
    expect(owned.parameters).toEqual({ custom: { "804:value": true }, denoise: 0, comfyui_custom_fields: { "804:value": true } });
    expect(owned.note).toBe("reference switch 804:value -> user value true (no reference, denoise 0.0)");
  });

  test("no switch: unchanged (denoise 0.0 without a reference unless the user set denoise)", () => {
    expect(referenceSwitchParameters("comfyui", { steps: 20 }, null, null).parameters).toEqual({ steps: 20, denoise: 0 });
    expect(referenceSwitchParameters("comfyui", { denoise: 0.4 }, null, null).parameters).toEqual({ denoise: 0.4 });
    expect(referenceSwitchParameters("comfyui", {}, reference, null).parameters).toEqual(reference);
    expect(referenceSwitchParameters("swarmui", { a: 1 }, null, null)).toEqual({ parameters: { a: 1 }, note: null });
    expect(referenceSwitchParameters("novelai", { a: 1 }, null, "804:value")).toEqual({ parameters: { a: 1 }, note: null });
  });

  test("SwarmUI runs the connection's ComfyUI workflow too: the switch is driven, never denoise 0.0", () => {
    const off = referenceSwitchParameters("swarmui", { a: 1 }, null, "804:value");
    expect(off).toEqual({ parameters: { a: 1, comfyui_custom_fields: { "804:value": false } }, note: "reference switch 804:value -> off" });
    const swarmReference = { resolvedSourceImages: [{ data: "QUJD", mimeType: "image/png" }] };
    expect(referenceSwitchParameters("swarmui", {}, swarmReference, "804:value").parameters).toEqual({ ...swarmReference, comfyui_custom_fields: { "804:value": true } });
    expect(referenceSwitchParameters("swarmui", { custom: { "804:value": true } }, null, "804:value").parameters.denoise).toBeUndefined();
  });
});

function connectionSpindle(getConnection: (id: string) => Promise<unknown>): { spindle: SpindleAPI; reads: string[] } {
  const reads: string[] = [];
  const spindle = {
    imageGen: {
      getConnection: async (id: string) => { reads.push(id); return getConnection(id); },
      listConnections: async () => [{ provider: "comfyui", is_default: true, metadata: anima.metadata }]
    }
  } as unknown as SpindleAPI;
  return { spindle, reads };
}

describe("resolveReferenceSwitch", () => {
  const config = (imageConnectionId: string | null): VisualNovelConfig => ({ ...DEFAULT_CONFIG, imageConnectionId });

  test("reads the selected connection once per selection within the TTL", async () => {
    const { spindle, reads } = connectionSpindle(async () => ({ provider: "comfyui", metadata: anima.metadata }));
    expect(await resolveReferenceSwitch(spindle, config("conn"), "u1", 1000)).toBe("804:value");
    expect(await resolveReferenceSwitch(spindle, config("conn"), "u1", 1000 + REFERENCE_SWITCH_TTL_MS - 1)).toBe("804:value");
    expect(reads).toEqual(["conn"]);
    expect(await resolveReferenceSwitch(spindle, config("conn"), "u1", 1000 + REFERENCE_SWITCH_TTL_MS)).toBe("804:value");
    expect(reads).toEqual(["conn", "conn"]);
    // Another workflow of the same connection is its own selection.
    expect(await resolveReferenceSwitch(spindle, config("conn::wf-x"), "u1", 1000)).toBeNull();
    expect(reads).toEqual(["conn", "conn", "conn"]);
  });

  test("no selection reads the default connection", async () => {
    const { spindle } = connectionSpindle(async () => null);
    expect(await resolveReferenceSwitch(spindle, config(null), "u1")).toBe("804:value");
  });

  test("a failed lookup is null and never throws", async () => {
    const { spindle } = connectionSpindle(async () => { throw new Error("host down"); });
    expect(await resolveReferenceSwitch(spindle, config("conn"), "u1")).toBeNull();
    const { spindle: noMetadata } = connectionSpindle(async () => ({ provider: "comfyui" }));
    expect(await resolveReferenceSwitch(noMetadata, config("conn"), "u1")).toBeNull();
  });
});

/* ---- scene images (generateAssets) ---- */

const now = new Date().toISOString();
const scene: SceneState = {
  sceneId: "scene",
  revision: 0,
  startParagraph: 0,
  environment: { location: "Library", timeOfDay: "night", weather: null, lighting: "lamplight", description: "A quiet library.", persistentElements: [] },
  cast: ["Mira"],
  continuity: { revision: 0, characters: {}, facts: {} },
  basePrompt: "quiet library at night",
  identityPrompt: "silver hair, green eyes, red coat",
  cameraLock: { framing: "medium wide", angle: "eye level", perspective: "fixed", lens: "50mm", subjectAnchor: "center", horizon: "upper third", safeDialogueRegion: "lower third", aspectRatio: "16:9" },
  compositionLock: "Mira centered",
  activeAssetId: null,
  priorSceneId: null
};

function cue(id: string, paragraphIndex: number, poseExpressionId = "smile"): VisualCue {
  return { cueId: `cue-${id}`, paragraphIndex, sceneId: "scene", sceneRevision: 0, kind: "flattened_scene", action: null, expression: null, poseExpressionId, promptDelta: "", assetJobId: `job-${id}` };
}

function plan(cues: VisualCue[]): TurnPlan {
  const maxP = Math.max(1, ...cues.map((c) => c.paragraphIndex));
  return TurnPlanSchema.parse({
    schemaVersion: 1,
    key: { chatId: "chat", assistantMessageId: "message", swipeId: 0, sourceFingerprint: "12345678abcdef", revision: 0 },
    paragraphs: Array.from({ length: maxP + 1 }, (_, index) => ({ index, sourceIndex: index, text: `Paragraph ${index}.` })),
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

function sceneRuntime(metadata: unknown | (() => unknown), defaults?: Record<string, unknown>, provider = "comfyui") {
  const data = new Map<string, unknown>();
  const calls: Array<{ parameters: Record<string, unknown> }> = [];
  const logs: string[] = [];
  const spindle = {
    userStorage: {
      getJson: async (path: string, options: { fallback: unknown }) => data.get(path) ?? options.fallback,
      setJson: async (path: string, value: unknown) => { data.set(path, value); }
    },
    imageGen: {
      getConnection: async () => {
        const connection: Record<string, unknown> = { provider, ...(defaults ? { default_parameters: defaults } : {}) };
        if (typeof metadata === "function") Object.defineProperty(connection, "metadata", { get: metadata as () => unknown });
        else if (metadata !== undefined) connection.metadata = metadata;
        return connection;
      },
      listConnections: async () => [{ provider, is_default: true }],
      generate: async (input: { parameters: Record<string, unknown>; includeDataUrl?: boolean }) => {
        calls.push({ parameters: input.parameters });
        const index = calls.length;
        return { imageId: `img-${index}`, imageUrl: `/images/img-${index}`, ...(input.includeDataUrl ? { imageDataUrl: "data:image/png;base64,UE9SVFJBSVQ=" } : {}), model: "m", provider };
      }
    },
    log: { info: (line: string) => { logs.push(line); }, warn() {}, error() {} }
  } as unknown as SpindleAPI;
  return { spindle, calls, logs };
}

async function sceneCalls(metadata: unknown | (() => unknown), patch: Partial<VisualNovelConfig> = {}, defaults?: Record<string, unknown>, provider = "comfyui") {
  const runtime = sceneRuntime(metadata, defaults, provider);
  const config: VisualNovelConfig = { ...DEFAULT_CONFIG, imageConnectionId: "conn", imageConcurrency: 1, debugLogging: true, ...patch };
  const turn = plan([cue("one", 0), cue("two", 1, "sad")]);
  await generateAssets(runtime.spindle, turn, createAssetJobs(turn, config), config, new AbortController().signal, () => {});
  return runtime;
}

describe("scene images: ComfyUI reference switch", () => {
  test("capture render: off and no denoise; anchored render: on with the reference", async () => {
    const { calls, logs } = await sceneCalls(anima.metadata);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.parameters.resolvedSourceImages).toBeUndefined();
    expect(calls[0]!.parameters.denoise).toBeUndefined();
    expect(calls[0]!.parameters.comfyui_custom_fields).toEqual({ "804:value": false });
    expect(calls[1]!.parameters.resolvedSourceImages).toHaveLength(1);
    expect(calls[1]!.parameters.denoise).toBe(0.7);
    expect(calls[1]!.parameters.comfyui_custom_fields).toEqual({ "804:value": true });
    expect(logs.filter((line) => line.includes("reference switch"))).toEqual([
      "[VN] cue p0: reference switch 804:value -> off",
      "[VN] cue p1: reference switch 804:value -> on"
    ]);
  });

  test("reference anchoring off: every image switches the IP-Adapter off", async () => {
    const { calls } = await sceneCalls(anima.metadata, { referenceAnchoring: false });
    for (const call of calls) {
      expect(call.parameters.denoise).toBeUndefined();
      expect(call.parameters.comfyui_custom_fields).toEqual({ "804:value": false });
    }
  });

  test("the user's custom fields are merged; their own switch value wins", async () => {
    const merged = await sceneCalls(anima.metadata, { imageParameters: { custom: { "7:text": "x" } } });
    expect(merged.calls[1]!.parameters.comfyui_custom_fields).toEqual({ "7:text": "x", "804:value": true });
    const owned = await sceneCalls(anima.metadata, { referenceAnchoring: false, imageParameters: { comfyui_custom_fields: { "804:value": true } } });
    expect(owned.calls[0]!.parameters.comfyui_custom_fields).toEqual({ "804:value": true });
    expect(owned.calls[0]!.parameters.denoise).toBe(0);
  });

  test("no switch in the workflow, or a failed lookup: unchanged (denoise 0.0 without a reference)", async () => {
    const withoutSwitch = clone(anima.metadata) as { comfyui: { field_mappings: Array<{ mappedAs: string }> } };
    withoutSwitch.comfyui.field_mappings = withoutSwitch.comfyui.field_mappings.filter((mapping) => mapping.mappedAs !== "custom");
    for (const metadata of [withoutSwitch, () => { throw new Error("metadata unreadable"); }, undefined]) {
      const { calls } = await sceneCalls(metadata);
      expect(calls).toHaveLength(2);
      expect(calls[0]!.parameters.denoise).toBe(0);
      expect(calls[0]!.parameters.comfyui_custom_fields).toBeUndefined();
      expect(calls[1]!.parameters.denoise).toBe(0.7);
      expect(calls[1]!.parameters.comfyui_custom_fields).toBeUndefined();
    }
  });
});

/* ---- sprite cut-out switch ---- */

/** The Anima 2.9b connection with a background-removal branch behind a mapped Boolean (900:value). */
function withCutout(title = "Cue sprite cut-out"): typeof anima.metadata {
  const metadata = clone(anima.metadata);
  const comfy = metadata.comfyui as unknown as { workflow_api_json: Record<string, unknown>; field_mappings: Array<Record<string, unknown>> };
  comfy.workflow_api_json["900"] = { class_type: "PrimitiveBoolean", inputs: { value: false }, _meta: { title } };
  comfy.field_mappings.push({ nodeId: "900", fieldName: "value", mappedAs: "custom" });
  return metadata;
}

describe("findCutoutSwitch", () => {
  test("finds a Boolean titled for the cut-out, background removal or transparency", () => {
    for (const title of ["Cue sprite cut-out", "Cutout", "cut out sprite", "Remove background", "RemoveBackground", "Remove the BG", "Background removal", "BG remover", "Remove background image", "Transparent PNG", "transparency", "Enable cut-out"]) {
      expect(findCutoutSwitch(single({ class_type: "PrimitiveBoolean", inputs: { value: true }, _meta: { title } }))).toBe("9:value");
    }
    // The If/Else switch itself, with its Boolean as a widget.
    expect(findCutoutSwitch(single({ class_type: "ComfySwitchNode", inputs: { switch: false, on_true: ["13", 0], on_false: ["6", 0] }, _meta: { title: "Transparent or plain" } }, "switch"))).toBe("9:switch");
  });

  test("a negative title is not the switch (it would be driven inverted)", () => {
    for (const title of ["Disable background removal", "Skip cut-out", "No transparency", "Bypass BG removal", "Render without cutout", "Don't remove background", "Not transparent"]) {
      expect(findCutoutSwitch(single({ class_type: "PrimitiveBoolean", inputs: { value: true }, _meta: { title } }))).toBeNull();
    }
  });

  test("no match for a title that only contains the words", () => {
    for (const title of ["Shortcut output", "Remove background noise", "Remove background music", "Cutoff outline", "Background removal model"]) {
      expect(findCutoutSwitch(single({ class_type: "PrimitiveBoolean", inputs: { value: true }, _meta: { title } }))).toBeNull();
    }
  });

  test("a Boolean option of the background-removal node itself is never the switch", () => {
    // API prompts title a node with its display name unless the user renamed it.
    expect(findCutoutSwitch(single({ class_type: "Image Rembg (Remove Background)", inputs: { only_mask: false, alpha_matting: false, transparency: true }, _meta: { title: "Image Rembg (Remove Background)" } }, "only_mask"))).toBeNull();
    expect(findCutoutSwitch(single({ class_type: "Image Remove Background Rembg (mtb)", inputs: { alpha_matting: false, post_processing: false }, _meta: { title: "Remove background (mtb)" } }, "post_processing"))).toBeNull();
    expect(findCutoutSwitch(single({ class_type: "RemoveBackground", inputs: { transparency: true }, _meta: { title: "Transparent background" } }, "transparency"))).toBeNull();
    expect(findCutoutSwitch(single({ class_type: "BiRefNetRMBG", inputs: { transparent: true }, _meta: { title: "Transparent" } }, "transparent"))).toBeNull();
    // Nor is a class name alone enough.
    expect(findCutoutSwitch(single({ class_type: "RemoveBackgroundToggle", inputs: { on: false } }, "on"))).toBeNull();
  });

  test("no match for a non-boolean field, an unrelated title, or the Anima workflow as shipped", () => {
    expect(findCutoutSwitch(single({ class_type: "LoadBackgroundRemovalModel", inputs: { bg_removal_name: "x.safetensors" }, _meta: { title: "Background removal model" } }, "bg_removal_name"))).toBeNull();
    expect(findCutoutSwitch(single({ class_type: "PrimitiveBoolean", inputs: { value: true }, _meta: { title: "Background colour" } }))).toBeNull();
    expect(findCutoutSwitch(single({ class_type: "PrimitiveBoolean", inputs: { value: true }, _meta: { title: "Enable upscale" } }))).toBeNull();
    expect(findCutoutSwitch(animaConfig)).toBeNull();
  });

  test("next to the IP-Adapter switch each finds its own; a title naming the reference stays the reference switch", () => {
    const both = withCutout().comfyui as unknown as Record<string, unknown>;
    expect(findReferenceSwitch(both)).toBe("804:value");
    expect(findCutoutSwitch(both)).toBe("900:value");
    for (const title of ["Transparent reference", "IP-Adapter (cut out)", "Reference: remove background"]) {
      const ambiguous = single({ class_type: "PrimitiveBoolean", inputs: { value: true }, _meta: { title } });
      expect(findReferenceSwitch(ambiguous)).toBe("9:value");
      expect(findCutoutSwitch(ambiguous)).toBeNull();
    }
    expect(findCutoutSwitch(single({ class_type: "IPAdapterToggle", inputs: { on: false }, _meta: { title: "Transparent" } }, "on"))).toBeNull();
  });
});

describe("resolveComfySwitches", () => {
  test("one read finds both switches; the reference lookup shares it", async () => {
    const reads: string[] = [];
    const spindle = { imageGen: { getConnection: async (id: string) => { reads.push(id); return { provider: "comfyui", metadata: withCutout() }; }, listConnections: async () => [] } } as unknown as SpindleAPI;
    const config = { ...DEFAULT_CONFIG, imageConnectionId: "conn" } as VisualNovelConfig;
    expect(await resolveComfySwitches(spindle, config, "u1", 1000)).toEqual({ reference: "804:value", cutout: "900:value", defaults: null });
    expect(await resolveReferenceSwitch(spindle, config, "u1", 1001)).toBe("804:value");
    expect(reads).toEqual(["conn"]);
  });

  test("a failed lookup has neither switch", async () => {
    const spindle = { imageGen: { getConnection: async () => { throw new Error("host down"); }, listConnections: async () => [] } } as unknown as SpindleAPI;
    expect(await resolveComfySwitches(spindle, { ...DEFAULT_CONFIG, imageConnectionId: "conn" } as VisualNovelConfig, "u1")).toEqual({ reference: null, cutout: null, defaults: null });
  });
});

describe("cutoutSwitchParameters", () => {
  test("on for a sprite, off otherwise, merged over the reference switch's fields", () => {
    const base = referenceSwitchParameters("comfyui", { steps: 20, custom: { "7:text": "x" } }, null, "804:value").parameters;
    const on = cutoutSwitchParameters("comfyui", { steps: 20, custom: { "7:text": "x" } }, base, true, "900:value");
    expect(on.parameters.comfyui_custom_fields).toEqual({ "7:text": "x", "804:value": false, "900:value": true });
    expect(on.parameters.steps).toBe(20);
    expect(on.note).toBe("cut-out switch 900:value -> on");
    const off = cutoutSwitchParameters("comfyui", {}, { steps: 20 }, false, "900:value");
    expect(off.parameters).toEqual({ steps: 20, comfyui_custom_fields: { "900:value": false } });
    expect(off.note).toBe("cut-out switch 900:value -> off");
  });

  test("the user's custom fields are kept (custom when there are no comfyui_custom_fields)", () => {
    const result = cutoutSwitchParameters("comfyui", { custom: { "7:text": "y" } }, { custom: { "7:text": "y" } }, true, "900:value");
    expect(result.parameters.comfyui_custom_fields).toEqual({ "7:text": "y", "900:value": true });
    expect(result.parameters.custom).toEqual({ "7:text": "y" });
  });

  test("a false the user set for the switch wins", () => {
    const user = { comfyui_custom_fields: { "900:value": false } };
    const result = cutoutSwitchParameters("comfyui", user, { ...user }, true, "900:value");
    expect(result.parameters.comfyui_custom_fields).toEqual({ "900:value": false });
    expect(result.note).toBe("cut-out switch 900:value -> user value false");
  });

  test("a true the user set can only leave sprites on: scenes, plates and key moments stay off", () => {
    const user = { comfyui_custom_fields: { "900:value": true } };
    const off = cutoutSwitchParameters("comfyui", user, { ...user }, false, "900:value");
    expect(off.parameters.comfyui_custom_fields).toEqual({ "900:value": false });
    expect(off.note).toBe("cut-out switch 900:value -> off (user value true only allows it)");
    expect(cutoutSwitchParameters("comfyui", user, { ...user }, true, "900:value").parameters.comfyui_custom_fields).toEqual({ "900:value": true });
  });

  test("SwarmUI is driven like ComfyUI", () => {
    expect(cutoutSwitchParameters("swarmui", {}, { steps: 20 }, true, "900:value")).toEqual({ parameters: { steps: 20, comfyui_custom_fields: { "900:value": true } }, note: "cut-out switch 900:value -> on" });
  });

  test("no switch, or a provider without the workflow: unchanged and no note", () => {
    const parameters = { steps: 20 };
    expect(cutoutSwitchParameters("comfyui", {}, parameters, true, null)).toEqual({ parameters, note: null });
    expect(cutoutSwitchParameters("novelai", {}, parameters, true, "900:value")).toEqual({ parameters, note: null });
  });
});

describe("scene images: ComfyUI cut-out switch", () => {
  test("a true in the user's image parameters does not make scene pictures transparent", async () => {
    const { calls } = await sceneCalls(withCutout(), { imageParameters: { comfyui_custom_fields: { "900:value": true } } });
    expect(calls.map((call) => (call.parameters.comfyui_custom_fields as Record<string, unknown>)["900:value"])).toEqual([false, false]);
  });

  test("a SwarmUI connection with the workflow: scene pictures turn both switches", async () => {
    const { calls } = await sceneCalls(withCutout(), {}, undefined, "swarmui");
    expect(calls).toHaveLength(2);
    expect(calls[0]!.parameters.comfyui_custom_fields).toEqual({ "804:value": false, "900:value": false });
    expect(calls[1]!.parameters.comfyui_custom_fields).toEqual({ "804:value": true, "900:value": false });
  });

  test("every scene picture turns a mapped cut-out switch off", async () => {
    const { calls, logs } = await sceneCalls(withCutout());
    expect(calls).toHaveLength(2);
    expect(calls[0]!.parameters.comfyui_custom_fields).toEqual({ "804:value": false, "900:value": false });
    expect(calls[1]!.parameters.comfyui_custom_fields).toEqual({ "804:value": true, "900:value": false });
    expect(logs.filter((line) => line.includes("cut-out switch"))).toEqual([
      "[VN] cue p0: cut-out switch 900:value -> off",
      "[VN] cue p1: cut-out switch 900:value -> off"
    ]);
  });
});

/* ---- the Image Gen panel's saved values ---- */

/** Connection default parameters as the Image Gen panel saves its Custom controls. */
const panel = (custom: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ steps: 28, comfyui_field_values: { custom, ...extra } });

describe("switches over the Image Gen panel's saved values", () => {
  const reference = { resolvedSourceImages: [{ data: "QUJD", mimeType: "image/png" }], denoise: 0.5 };
  /** Cue's parameters for one render, and the value Lumiverse then writes into a field. */
  const sent = (defaults: Record<string, unknown>, cutout: boolean, user: Record<string, unknown> = {}, withReference = false) => {
    const switched = referenceSwitchParameters("comfyui", user, withReference ? reference : null, "804:value", defaults);
    const cut = cutoutSwitchParameters("comfyui", user, switched.parameters, cutout, "900:value", defaults);
    return { parameters: cut.parameters, notes: [switched.note, cut.note], value: (key: string) => lumiverseCustomValue(defaults, cut.parameters, key) };
  };

  test("panel saved Enabled: scenes, plates and key moments stay opaque and unreferenced", () => {
    const off = sent(panel({ "900:value": true, "804:value": true }), false);
    expect(off.value("900:value")).toBe(false);
    expect(off.value("804:value")).toBe(false);
    expect(sent(panel({ "900:value": true }), true).value("900:value")).toBe(true);
  });

  test("panel saved Disabled, or only another Custom control: sprites are still cut", () => {
    const disabled = sent(panel({ "900:value": false, "804:value": false }), true, {}, true);
    expect(disabled.value("900:value")).toBe(true);
    expect(disabled.value("804:value")).toBe(true);
    const other = sent(panel({ "7:text": "x" }), true);
    expect(other.value("900:value")).toBe(true);
    expect(other.value("7:text")).toBe("x");
  });

  test("node_fields (which beat custom) lose the switch keys only; the other saved values stay", () => {
    const result = sent(panel({}, { node_fields: { "900:value": true, "5:steps": 30 }, seed: 7 }), false);
    expect(result.value("900:value")).toBe(false);
    expect(result.parameters.comfyui_field_values).toEqual({ custom: { "804:value": false, "900:value": false }, node_fields: { "5:steps": 30 }, seed: 7 });
  });

  test("the user's custom fields join the saved ones; their own comfyui_field_values replace the saved ones", () => {
    const merged = sent(panel({ "7:text": "panel" }), true, { custom: { "8:text": "mine" } });
    expect(merged.value("7:text")).toBe("panel");
    expect(merged.value("8:text")).toBe("mine");
    expect(merged.value("900:value")).toBe(true);
    const own = sent(panel({ "7:text": "panel" }), true, { comfyui_field_values: { custom: { "6:text": "own" } } });
    expect(own.value("7:text")).toBeUndefined();
    expect(own.value("6:text")).toBe("own");
    expect(own.value("900:value")).toBe(true);
  });

  test("the log says when the panel had a value for a switch", () => {
    expect(sent(panel({ "900:value": true }), false).notes).toEqual([
      "reference switch 804:value -> off",
      "cut-out switch 900:value -> off (Image Gen panel had true)"
    ]);
    expect(sent(panel({ "804:value": true }, { node_fields: { "804:value": false } }), true).notes[0]).toBe("reference switch 804:value -> off (Image Gen panel had false)");
  });

  test("a switch value the user set in Cue's image parameters still wins over the panel", () => {
    const owned = sent(panel({ "804:value": false }), true, { comfyui_custom_fields: { "804:value": true } });
    expect(owned.value("804:value")).toBe(true);
    expect(owned.notes[0]).toBe("reference switch 804:value -> user value true (no reference, denoise 0.0)");
    const inFieldValues = sent(panel({}), true, { comfyui_field_values: { custom: { "804:value": true } } });
    expect(inFieldValues.value("804:value")).toBe(true);
  });

  test("the connection's default parameters come with the switches", async () => {
    const defaults = panel({ "900:value": true });
    const spindle = { imageGen: { getConnection: async () => ({ provider: "comfyui", metadata: withCutout(), default_parameters: defaults }), listConnections: async () => [] } } as unknown as SpindleAPI;
    expect(await resolveComfySwitches(spindle, { ...DEFAULT_CONFIG, imageConnectionId: "conn" } as VisualNovelConfig, "u1")).toEqual({ reference: "804:value", cutout: "900:value", defaults });
  });

  test("scene pictures: a panel saved Enabled leaves them opaque", async () => {
    const defaults = panel({ "900:value": true, "804:value": true });
    const { calls, logs } = await sceneCalls(withCutout(), {}, defaults);
    expect(calls).toHaveLength(2);
    expect(calls.map((call) => lumiverseCustomValue(defaults, call.parameters, "900:value"))).toEqual([false, false]);
    expect(calls.map((call) => lumiverseCustomValue(defaults, call.parameters, "804:value"))).toEqual([false, true]);
    expect(logs).toContain("[VN] cue p0: cut-out switch 900:value -> off (Image Gen panel had true)");
  });
});
