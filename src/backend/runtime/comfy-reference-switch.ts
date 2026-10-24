import type { SpindleAPI } from "lumiverse-spindle-types";
import type { VisualNovelConfig } from "../../config.js";

/**
 * ComfyUI reference on/off switch.
 *
 * A workflow may carry a Boolean node that turns its IP-Adapter on or off
 * (for example a switch between the IP-Adapter model and the plain model).
 * When the user maps that Boolean as `custom` in the Lumiverse workflow setup
 * and gives the node a title with "IP-Adapter" or "reference", Cue turns it
 * on only when it sends a reference image. Without such a field, behaviour
 * is unchanged (`denoise: 0.0` without a reference).
 *
 * Detection is generic (no node ids) and reads the connection profile's
 * workflow config the same way Lumiverse picks it
 * (src/services/image-gen.service.ts applyActiveComfyUIWorkflowConfig):
 * the workflow id of the selection, else the active library entry, else
 * `metadata.comfyui`.
 *
 * The same lookup finds the sprite cut-out switch: a Boolean custom field
 * titled like "cut-out", "remove background" or "transparent" that makes
 * the workflow remove the background itself (a ComfyUI background-removal
 * branch before SaveImage). Cue turns it on for sprite renders and off for
 * everything else (plates, key moments, scene pictures); the browser keeps
 * the alpha of a render that arrives transparent.
 */

type Mapping = { nodeId?: unknown; fieldName?: unknown; mappedAs?: unknown };
type ApiNode = { class_type?: unknown; inputs?: Record<string, unknown>; _meta?: { title?: unknown } };

const SWITCH_TITLE = /ip[\s_-]?adapter|reference|\bref\b/i;
const CUTOUT_TITLE = /cut[\s_-]?out|background[\s_-]?remov|remov\w*?[\s_-]*(?:the[\s_-]+)?(?:background|bg)|\bbg[\s_-]?remov|transparen/i;

/** How long a looked-up switch (or a failed lookup) is reused. */
export const REFERENCE_SWITCH_TTL_MS = 30_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** The workflow config Lumiverse would use for this selection (null when none). */
export function comfyWorkflowConfigFor(metadata: unknown, workflowId?: string | null): Record<string, unknown> | null {
  const record = asRecord(metadata);
  if (!record) return null;
  const entries = Array.isArray(record.comfyui_workflows) ? record.comfyui_workflows : [];
  const entryConfig = (id: unknown): Record<string, unknown> | null => {
    if (typeof id !== "string" || !id) return null;
    for (const raw of entries) {
      const entry = asRecord(raw);
      if (entry && entry.id === id) return asRecord(entry.config);
    }
    return null;
  };
  // An explicit workflow id that is missing makes Lumiverse fail the request; nothing to switch then.
  if (workflowId) return entryConfig(workflowId);
  return entryConfig(record.comfyui_active_workflow_id) ?? asRecord(record.comfyui);
}

/** Look up one node by id: API prompt format first, UI graph (`nodes` array) as a fallback. */
function nodeInfo(config: Record<string, unknown>, nodeId: string, fieldName: string): { classType: string; title: string; value: unknown } | null {
  for (const key of ["workflow_api_json", "workflow_json"]) {
    const workflow = asRecord(config[key]);
    if (!workflow) continue;
    const apiNode = asRecord(workflow[nodeId]) as ApiNode | null;
    if (apiNode && typeof apiNode.class_type === "string") {
      return {
        classType: apiNode.class_type,
        title: typeof apiNode._meta?.title === "string" ? apiNode._meta.title : "",
        value: asRecord(apiNode.inputs)?.[fieldName]
      };
    }
    if (Array.isArray(workflow.nodes)) {
      for (const raw of workflow.nodes) {
        const node = asRecord(raw);
        if (!node || String(node.id) !== nodeId) continue;
        const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : [];
        return {
          classType: typeof node.type === "string" ? node.type : "",
          title: typeof node.title === "string" ? node.title : "",
          value: widgets.length === 1 ? widgets[0] : undefined
        };
      }
    }
  }
  return null;
}

/**
 * The `"<nodeId>:<fieldName>"` key of the first `custom` mapping on a Boolean
 * node (PrimitiveBoolean, or a boolean input value) whose title or class
 * type passes `matches`.
 */
function findBooleanSwitch(config: Record<string, unknown> | null, matches: (text: string) => boolean): string | null {
  if (!config || !Array.isArray(config.field_mappings)) return null;
  for (const raw of config.field_mappings as Mapping[]) {
    if (!raw || raw.mappedAs !== "custom") continue;
    if (typeof raw.nodeId !== "string" && typeof raw.nodeId !== "number") continue;
    if (typeof raw.fieldName !== "string" || !raw.fieldName) continue;
    const nodeId = String(raw.nodeId);
    const node = nodeInfo(config, nodeId, raw.fieldName);
    if (!node) continue;
    const isBoolean = node.classType === "PrimitiveBoolean" || typeof node.value === "boolean";
    if (!isBoolean) continue;
    if (!matches(node.title) && !matches(node.classType)) continue;
    return `${nodeId}:${raw.fieldName}`;
  }
  return null;
}

/**
 * The `"<nodeId>:<fieldName>"` key of the reference on/off field: the first
 * `custom` mapping on a Boolean node (PrimitiveBoolean, or a boolean input
 * value) whose title or class type names the IP-Adapter or the reference
 * (and not the cut-out, which has its own switch).
 */
export function findReferenceSwitch(config: Record<string, unknown> | null): string | null {
  return findBooleanSwitch(config, (text) => SWITCH_TITLE.test(text) && !CUTOUT_TITLE.test(text));
}

/**
 * The `"<nodeId>:<fieldName>"` key of the sprite cut-out on/off field: the
 * first `custom` mapping on a Boolean node whose title or class type names
 * a cut-out, background removal or transparency ("Cue sprite cut-out",
 * "Remove background", "Transparent PNG").
 */
export function findCutoutSwitch(config: Record<string, unknown> | null): string | null {
  return findBooleanSwitch(config, (text) => CUTOUT_TITLE.test(text));
}

/** The Boolean custom fields Cue drives in the selected workflow (null: none). */
export type ComfySwitches = { reference: string | null; cutout: string | null };

const NO_SWITCHES: ComfySwitches = { reference: null, cutout: null };

type CacheEntry = { until: number; switches: Promise<ComfySwitches> };
const caches = new WeakMap<object, Map<string, CacheEntry>>();

/** Forget cached lookups (tests). */
export function clearReferenceSwitchCache(spindle?: SpindleAPI): void {
  if (spindle) caches.delete(spindle);
}

function workflowIdOf(config: VisualNovelConfig, selectionWorkflowId: string | undefined): string | undefined {
  if (selectionWorkflowId) return selectionWorkflowId;
  const own = config.imageParameters.workflow_id ?? config.imageParameters.workflowId;
  return typeof own === "string" && own ? own : undefined;
}

function splitSelection(raw: string | null): { connectionId?: string; workflowId?: string } {
  if (!raw) return {};
  const separator = raw.indexOf("::");
  if (separator === -1) return { connectionId: raw };
  return { connectionId: raw.slice(0, separator), workflowId: raw.slice(separator + 2) };
}

async function lookup(spindle: SpindleAPI, config: VisualNovelConfig, userId: string | undefined): Promise<ComfySwitches> {
  try {
    const { connectionId, workflowId } = splitSelection(config.imageConnectionId);
    const api = spindle.imageGen;
    let connection: { metadata?: unknown } | null | undefined;
    if (connectionId) connection = await api.getConnection(connectionId, userId);
    else {
      const connections = await api.listConnections(userId);
      connection = connections.find((candidate) => candidate.is_default) ?? connections[0];
    }
    const workflow = comfyWorkflowConfigFor(connection?.metadata, workflowIdOf(config, workflowId));
    return { reference: findReferenceSwitch(workflow), cutout: findCutoutSwitch(workflow) };
  } catch {
    return NO_SWITCHES;
  }
}

/**
 * The reference and cut-out switch keys for the current image connection
 * selection (null where the workflow has none). Cached per selection for
 * {@link REFERENCE_SWITCH_TTL_MS}; never throws.
 */
export function resolveComfySwitches(spindle: SpindleAPI, config: VisualNovelConfig, userId?: string, now: number = Date.now()): Promise<ComfySwitches> {
  let cache = caches.get(spindle);
  if (!cache) {
    cache = new Map();
    caches.set(spindle, cache);
  }
  const ownWorkflow = config.imageParameters.workflow_id ?? config.imageParameters.workflowId;
  const cacheKey = `${userId ?? ""}\u0000${config.imageConnectionId ?? ""}\u0000${typeof ownWorkflow === "string" ? ownWorkflow : ""}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.until > now) return hit.switches;
  const switches = lookup(spindle, config, userId);
  cache.set(cacheKey, { until: now + REFERENCE_SWITCH_TTL_MS, switches });
  return switches;
}

/**
 * The reference switch key for the current image connection selection, or
 * null. Cached per selection for {@link REFERENCE_SWITCH_TTL_MS}; never throws.
 */
export async function resolveReferenceSwitch(spindle: SpindleAPI, config: VisualNovelConfig, userId?: string, now: number = Date.now()): Promise<string | null> {
  return (await resolveComfySwitches(spindle, config, userId, now)).reference;
}

/** The user's custom-field values Lumiverse would read (it reads only one of the two). */
function userCustomFields(parameters: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(parameters.comfyui_custom_fields) ?? asRecord(parameters.custom);
}

export type ReferenceSwitchResult = {
  /** Provider parameters for the request (before prompt/size/workflow extras). */
  parameters: Record<string, unknown>;
  /** One debug line ("reference switch 804:value -> off"); null for non-ComfyUI providers. */
  note: string | null;
};

/**
 * Base provider parameters for one generation.
 *
 * `reference` holds the provider's reference parameters
 * (`referenceParametersFor`), or null when this image has no reference.
 * ComfyUI with a switch: on with a reference (reference parameters as
 * before), off without one and no `denoise: 0.0`. The switch value goes into
 * `comfyui_custom_fields`, merged over the user's own `comfyui_custom_fields`
 * (or `custom`); a value the user set for the same key wins. No switch (or a
 * user-owned key): unchanged, `denoise: 0.0` without a reference.
 */
export function referenceSwitchParameters(
  provider: string | null,
  userParameters: Record<string, unknown>,
  reference: Record<string, unknown> | null,
  switchKey: string | null
): ReferenceSwitchResult {
  if (provider !== "comfyui") {
    return { parameters: reference ? { ...userParameters, ...reference } : { ...userParameters }, note: null };
  }
  const custom = userCustomFields(userParameters);
  const userOwns = Boolean(switchKey && custom && Object.hasOwn(custom, switchKey));
  const controlled = Boolean(switchKey) && !userOwns;
  const fields = controlled ? { comfyui_custom_fields: { ...(custom ?? {}), [switchKey!]: reference !== null } } : {};
  const zeroDenoise = !reference && !controlled && userParameters.denoise === undefined;
  const parameters = reference
    ? { ...userParameters, ...reference, ...fields }
    : { ...userParameters, ...(zeroDenoise ? { denoise: 0.0 } : {}), ...fields };
  const tail = reference ? "with reference" : zeroDenoise ? "no reference, denoise 0.0" : "no reference";
  const note = !switchKey
    ? `reference switch none (${tail})`
    : userOwns
      ? `reference switch ${switchKey} -> user value ${JSON.stringify(custom![switchKey])} (${tail})`
      : `reference switch ${switchKey} -> ${reference ? "on" : "off"}`;
  return { parameters, note };
}

/**
 * Parameters with the sprite cut-out switch set: on for a sprite render
 * (`cutout`), off for anything else, so a workflow that saves transparent
 * PNGs only does so for sprites. Applied after `referenceSwitchParameters`:
 * the value is merged into the `comfyui_custom_fields` there are (else the
 * user's `custom`), and a value the user set for the same key in their own
 * image parameters wins. No switch, or not ComfyUI: unchanged, no note.
 */
export function cutoutSwitchParameters(
  provider: string | null,
  userParameters: Record<string, unknown>,
  parameters: Record<string, unknown>,
  cutout: boolean,
  switchKey: string | null
): ReferenceSwitchResult {
  if (provider !== "comfyui" || !switchKey) return { parameters, note: null };
  const own = userCustomFields(userParameters);
  if (own && Object.hasOwn(own, switchKey)) {
    return { parameters, note: `cut-out switch ${switchKey} -> user value ${JSON.stringify(own[switchKey])}` };
  }
  const custom = userCustomFields(parameters);
  return {
    parameters: { ...parameters, comfyui_custom_fields: { ...(custom ?? {}), [switchKey]: cutout } },
    note: `cut-out switch ${switchKey} -> ${cutout ? "on" : "off"}`
  };
}
