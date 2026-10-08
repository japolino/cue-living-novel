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
 */

type Mapping = { nodeId?: unknown; fieldName?: unknown; mappedAs?: unknown };
type ApiNode = { class_type?: unknown; inputs?: Record<string, unknown>; _meta?: { title?: unknown } };

const SWITCH_TITLE = /ip[\s_-]?adapter|reference|\bref\b/i;

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
 * The `"<nodeId>:<fieldName>"` key of the reference on/off field: the first
 * `custom` mapping on a Boolean node (PrimitiveBoolean, or a boolean input
 * value) whose title or class type names the IP-Adapter or the reference.
 */
export function findReferenceSwitch(config: Record<string, unknown> | null): string | null {
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
    if (!SWITCH_TITLE.test(node.title) && !SWITCH_TITLE.test(node.classType)) continue;
    return `${nodeId}:${raw.fieldName}`;
  }
  return null;
}

type CacheEntry = { until: number; key: Promise<string | null> };
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

async function lookup(spindle: SpindleAPI, config: VisualNovelConfig, userId: string | undefined): Promise<string | null> {
  try {
    const { connectionId, workflowId } = splitSelection(config.imageConnectionId);
    const api = spindle.imageGen;
    let connection: { metadata?: unknown } | null | undefined;
    if (connectionId) connection = await api.getConnection(connectionId, userId);
    else {
      const connections = await api.listConnections(userId);
      connection = connections.find((candidate) => candidate.is_default) ?? connections[0];
    }
    return findReferenceSwitch(comfyWorkflowConfigFor(connection?.metadata, workflowIdOf(config, workflowId)));
  } catch {
    return null;
  }
}

/**
 * The reference switch key for the current image connection selection, or
 * null. Cached per selection for {@link REFERENCE_SWITCH_TTL_MS}; never throws.
 */
export function resolveReferenceSwitch(spindle: SpindleAPI, config: VisualNovelConfig, userId?: string, now: number = Date.now()): Promise<string | null> {
  let cache = caches.get(spindle);
  if (!cache) {
    cache = new Map();
    caches.set(spindle, cache);
  }
  const ownWorkflow = config.imageParameters.workflow_id ?? config.imageParameters.workflowId;
  const cacheKey = `${userId ?? ""}\u0000${config.imageConnectionId ?? ""}\u0000${typeof ownWorkflow === "string" ? ownWorkflow : ""}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.until > now) return hit.key;
  const key = lookup(spindle, config, userId);
  cache.set(cacheKey, { until: now + REFERENCE_SWITCH_TTL_MS, key });
  return key;
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
