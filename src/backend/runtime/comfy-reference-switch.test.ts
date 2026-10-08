import { describe, expect, test } from "bun:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { DEFAULT_CONFIG, type VisualNovelConfig } from "../../config.js";
import { TurnPlanSchema, type SceneState, type TurnPlan, type VisualCue } from "../../shared/contracts.js";
import anima from "./__fixtures__/anima29b-connection.json";
import {
  REFERENCE_SWITCH_TTL_MS,
  comfyWorkflowConfigFor,
  findReferenceSwitch,
  referenceSwitchParameters,
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
    expect(owned.parameters).toEqual({ custom: { "804:value": true }, denoise: 0 });
    expect(owned.note).toBe("reference switch 804:value -> user value true (no reference, denoise 0.0)");
  });

  test("no switch: unchanged (denoise 0.0 without a reference unless the user set denoise)", () => {
    expect(referenceSwitchParameters("comfyui", { steps: 20 }, null, null).parameters).toEqual({ steps: 20, denoise: 0 });
    expect(referenceSwitchParameters("comfyui", { denoise: 0.4 }, null, null).parameters).toEqual({ denoise: 0.4 });
    expect(referenceSwitchParameters("comfyui", {}, reference, null).parameters).toEqual(reference);
    expect(referenceSwitchParameters("swarmui", { a: 1 }, null, "804:value")).toEqual({ parameters: { a: 1 }, note: null });
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

function sceneRuntime(metadata: unknown | (() => unknown)) {
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
        const connection: Record<string, unknown> = { provider: "comfyui" };
        if (typeof metadata === "function") Object.defineProperty(connection, "metadata", { get: metadata as () => unknown });
        else if (metadata !== undefined) connection.metadata = metadata;
        return connection;
      },
      listConnections: async () => [{ provider: "comfyui", is_default: true }],
      generate: async (input: { parameters: Record<string, unknown>; includeDataUrl?: boolean }) => {
        calls.push({ parameters: input.parameters });
        const index = calls.length;
        return { imageId: `img-${index}`, imageUrl: `/images/img-${index}`, ...(input.includeDataUrl ? { imageDataUrl: "data:image/png;base64,UE9SVFJBSVQ=" } : {}), model: "m", provider: "comfyui" };
      }
    },
    log: { info: (line: string) => { logs.push(line); }, warn() {}, error() {} }
  } as unknown as SpindleAPI;
  return { spindle, calls, logs };
}

async function sceneCalls(metadata: unknown | (() => unknown), patch: Partial<VisualNovelConfig> = {}) {
  const runtime = sceneRuntime(metadata);
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
