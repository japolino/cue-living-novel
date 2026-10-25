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
 * titled like "cut-out", "remove background" or "transparent" (and not
 * "disable…", "skip…" or the reference) that makes the workflow remove the
 * background itself (a ComfyUI background-removal branch before SaveImage). Cue turns it on for sprite renders and off for
 * everything else (plates, key moments, scene pictures); the browser keeps
 * the alpha of a render that arrives transparent.
 *
 * Lumiverse merges each request over the connection's `default_parameters`,
 * where its Image Gen panel saves the workflow's Custom controls
 * (`comfyui_field_values.custom`, which replaces `comfyui_custom_fields` as a
 * whole, and `node_fields`, which beats both). The lookup returns those
 * defaults, and Cue writes its switch values where they win over them.
 */

type Mapping = { nodeId?: unknown; fieldName?: unknown; mappedAs?: unknown };
type ApiNode = { class_type?: unknown; inputs?: Record<string, unknown>; _meta?: { title?: unknown } };

const SWITCH_TITLE = /ip[\s_-]?adapter|reference|\bref\b/i;
/** Node classes that remove the background themselves: their own options are never the cut-out switch. */
const REMOVAL_CLASS = /rembg|rmbg|birefnet|matting|segment|background[\s_-]?remov|remov\w*[\s_-]?(?:the[\s_-]?)?(?:background|bg)|bg[\s_-]?remov|cut[\s_-]?out|transparen/i;

const NEGATIONS = new Set(["no", "not", "non", "dont", "don't", "disable", "disabled", "disables", "skip", "skips", "skipped", "without", "bypass", "bypassed", "never"]);
const CUTOUT_WORDS = new Set(["cutout", "cutouts", "transparent", "transparency", "rembg"]);
const REMOVE_WORDS = new Set(["remove", "removes", "removed", "removal", "remover", "removing"]);
const BACKGROUND_WORDS = new Set(["background", "backgrounds", "bg"]);
/** A word after "remove background" that makes it about something else ("Remove background noise"). */
const NOT_THE_IMAGE = new Set(["noise", "music", "sound", "audio", "hum", "color", "colour", "blur", "model", "strength", "threshold", "size", "resolution", "mask"]);

/** Lower-case words of a node title ("RemoveBackground" -> remove, background; "cut-out" -> cut, out). */
function titleWords(title: string): string[] {
  return title
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/[\u2019`]/g, "'")
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter(Boolean);
}

/**
 * Whether a node title asks for the cut-out: it names a cut-out
 * ("cut-out", "cutout"), transparency, or removing the image's background,
 * and holds no negation ("Disable…", "Skip…", "No…", "without"), which
 * would make Cue drive the switch inverted.
 */
function namesCutout(title: string): boolean {
  const words = titleWords(title);
  if (words.some((word) => NEGATIONS.has(word))) return false;
  const imageBackground = (at: number): boolean => BACKGROUND_WORDS.has(words[at] ?? "") && !NOT_THE_IMAGE.has(words[at + 1] ?? "");
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (CUTOUT_WORDS.has(word)) return true;
    if (word === "cut" && (words[i + 1] === "out" || words[i + 1] === "outs")) return true;
    if (REMOVE_WORDS.has(word) && imageBackground(words[i + 1] === "the" ? i + 2 : i + 1)) return true;
    if (BACKGROUND_WORDS.has(word) && REMOVE_WORDS.has(words[i + 1] ?? "") && !NOT_THE_IMAGE.has(words[i + 2] ?? "")) return true;
  }
  return false;
}

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
 * node (PrimitiveBoolean, or a boolean input value) that passes `matches`.
 */
function findBooleanSwitch(config: Record<string, unknown> | null, matches: (node: { classType: string; title: string }) => boolean): string | null {
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
    if (!matches(node)) continue;
    return `${nodeId}:${raw.fieldName}`;
  }
  return null;
}

/**
 * The `"<nodeId>:<fieldName>"` key of the reference on/off field: the first
 * `custom` mapping on a Boolean node (PrimitiveBoolean, or a boolean input
 * value) whose title or class type names the IP-Adapter or the reference.
 */
export function findReferenceSwitch(config: Record<string, unknown> | null): string | null {
  return findBooleanSwitch(config, (node) => SWITCH_TITLE.test(node.title) || SWITCH_TITLE.test(node.classType));
}

/**
 * The `"<nodeId>:<fieldName>"` key of the sprite cut-out on/off field: the
 * first `custom` mapping on a Boolean node whose title asks for the cut-out
 * ("Cue sprite cut-out", "Remove background", "Transparent PNG"; see
 * `namesCutout`). Never an option of a node that removes the background
 * itself (its title is often its class name, "Image Rembg (Remove
 * Background)"), and never a node that names the reference, which stays
 * the reference switch.
 */
export function findCutoutSwitch(config: Record<string, unknown> | null): string | null {
  return findBooleanSwitch(config, (node) =>
    namesCutout(node.title)
    && !REMOVAL_CLASS.test(node.classType)
    && !SWITCH_TITLE.test(node.title)
    && !SWITCH_TITLE.test(node.classType));
}

/**
 * The Boolean custom fields Cue drives in the selected workflow (null: none),
 * and the connection's `default_parameters` its requests are merged over.
 */
export type ComfySwitches = { reference: string | null; cutout: string | null; defaults: Record<string, unknown> | null };

const NO_SWITCHES: ComfySwitches = { reference: null, cutout: null, defaults: null };

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
    let connection: { metadata?: unknown; default_parameters?: unknown } | null | undefined;
    if (connectionId) connection = await api.getConnection(connectionId, userId);
    else {
      const connections = await api.listConnections(userId);
      connection = connections.find((candidate) => candidate.is_default) ?? connections[0];
    }
    const workflow = comfyWorkflowConfigFor(connection?.metadata, workflowIdOf(config, workflowId));
    return { reference: findReferenceSwitch(workflow), cutout: findCutoutSwitch(workflow), defaults: asRecord(connection?.default_parameters) };
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

/**
 * The value `parameters` hold for one custom field, where Lumiverse looks
 * last first: `comfyui_field_values.node_fields`, its `custom`, then
 * `comfyui_custom_fields` (else `custom`). Null when none has the key.
 */
function customValueIn(parameters: Record<string, unknown> | null, key: string): { value: unknown } | null {
  if (!parameters) return null;
  const fieldValues = asRecord(parameters.comfyui_field_values);
  for (const source of [asRecord(fieldValues?.node_fields), asRecord(fieldValues?.custom), userCustomFields(parameters)]) {
    if (source && Object.hasOwn(source, key)) return { value: source[key] };
  }
  return null;
}

/** The value the connection's saved defaults (the Image Gen panel) hold for a field the request leaves to them. */
function panelValue(defaults: Record<string, unknown> | null, userParameters: Record<string, unknown>, key: string): { value: unknown } | null {
  if (!defaults) return null;
  const visible = Object.fromEntries(Object.entries(defaults).filter(([name]) => !Object.hasOwn(userParameters, name)));
  return customValueIn(visible, key);
}

/**
 * `parameters` with `values` set where Lumiverse reads them last, over the
 * connection's saved defaults: in `comfyui_custom_fields` (with the custom
 * fields Lumiverse would read), and, when the request or the defaults carry
 * `comfyui_field_values`, in its `custom` (saved values, then the user's
 * own custom fields, then `values`) with the keys taken out of its
 * `node_fields`. The request's `comfyui_field_values` replaces the saved one
 * whole, so the saved values that are not switches go along.
 */
function withSwitchValues(parameters: Record<string, unknown>, defaults: Record<string, unknown> | null, values: Record<string, unknown>): Record<string, unknown> {
  const effective = { ...(defaults ?? {}), ...parameters };
  const out: Record<string, unknown> = { ...parameters, comfyui_custom_fields: { ...(userCustomFields(effective) ?? {}), ...values } };
  const fieldValues = asRecord(effective.comfyui_field_values);
  if (fieldValues) {
    const next: Record<string, unknown> = { ...fieldValues, custom: { ...(asRecord(fieldValues.custom) ?? {}), ...(userCustomFields(parameters) ?? {}), ...values } };
    const nodeFields = asRecord(fieldValues.node_fields);
    if (nodeFields) next.node_fields = Object.fromEntries(Object.entries(nodeFields).filter(([key]) => !Object.hasOwn(values, key)));
    out.comfyui_field_values = next;
  }
  return out;
}

/** " (Image Gen panel had ...)" when the saved defaults held a value for the switch Cue sets. */
function panelNote(defaults: Record<string, unknown> | null, userParameters: Record<string, unknown>, key: string): string {
  const saved = panelValue(defaults, userParameters, key);
  return saved ? ` (Image Gen panel had ${JSON.stringify(saved.value)})` : "";
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
 * before), off without one and no `denoise: 0.0`. The switch value is
 * written over the user's own custom fields and the connection's saved
 * `defaults` (see `withSwitchValues`); a value the user set for the same key
 * in their own image parameters wins (and keeps `denoise: 0.0` without a
 * reference). No switch: unchanged, `denoise: 0.0` without a reference.
 */
export function referenceSwitchParameters(
  provider: string | null,
  userParameters: Record<string, unknown>,
  reference: Record<string, unknown> | null,
  switchKey: string | null,
  defaults: Record<string, unknown> | null = null
): ReferenceSwitchResult {
  if (provider !== "comfyui") {
    return { parameters: reference ? { ...userParameters, ...reference } : { ...userParameters }, note: null };
  }
  const own = switchKey ? customValueIn(userParameters, switchKey) : null;
  const zeroDenoise = !reference && (!switchKey || own !== null) && userParameters.denoise === undefined;
  const base = reference
    ? { ...userParameters, ...reference }
    : { ...userParameters, ...(zeroDenoise ? { denoise: 0.0 } : {}) };
  const parameters = switchKey ? withSwitchValues(base, defaults, { [switchKey]: own ? own.value : reference !== null }) : base;
  const tail = reference ? "with reference" : zeroDenoise ? "no reference, denoise 0.0" : "no reference";
  const note = !switchKey
    ? `reference switch none (${tail})`
    : own
      ? `reference switch ${switchKey} -> user value ${JSON.stringify(own.value)} (${tail})`
      : `reference switch ${switchKey} -> ${reference ? "on" : "off"}${panelNote(defaults, userParameters, switchKey)}`;
  return { parameters, note };
}

/**
 * Parameters with the sprite cut-out switch set: on for a sprite render
 * (`cutout`), off for anything else, so a workflow that saves transparent
 * PNGs only does so for sprites. Applied after `referenceSwitchParameters`,
 * written the same way over the custom fields there are and the
 * connection's saved `defaults`; a value the user set for the same key in
 * their own image parameters wins. No switch, or not ComfyUI: unchanged, no
 * note.
 */
export function cutoutSwitchParameters(
  provider: string | null,
  userParameters: Record<string, unknown>,
  parameters: Record<string, unknown>,
  cutout: boolean,
  switchKey: string | null,
  defaults: Record<string, unknown> | null = null
): ReferenceSwitchResult {
  if (provider !== "comfyui" || !switchKey) return { parameters, note: null };
  const own = customValueIn(userParameters, switchKey);
  if (own) {
    return {
      parameters: withSwitchValues(parameters, defaults, { [switchKey]: own.value }),
      note: `cut-out switch ${switchKey} -> user value ${JSON.stringify(own.value)}`
    };
  }
  return {
    parameters: withSwitchValues(parameters, defaults, { [switchKey]: cutout }),
    note: `cut-out switch ${switchKey} -> ${cutout ? "on" : "off"}${panelNote(defaults, userParameters, switchKey)}`
  };
}
