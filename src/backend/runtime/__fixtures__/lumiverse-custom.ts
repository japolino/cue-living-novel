/**
 * The value Lumiverse writes into a `custom`-mapped workflow field, as its
 * request path picks it:
 * - spindle `generate` merges the request over the connection's
 *   `default_parameters` (src/spindle/worker-host-image-gen-api.ts);
 * - `applyActiveComfyUIWorkflowConfig` takes `comfyui_custom_fields` (else
 *   `custom`) as `custom`, then `Object.assign`s `comfyui_field_values` over
 *   it, where the Image Gen panel saves its Custom controls
 *   (src/services/image-gen.service.ts);
 * - `patchWorkflow` lets `node_fields` beat `custom`
 *   (src/image-gen/comfyui-workflow-patch.ts resolveMappedValue).
 */
export function lumiverseCustomValue(defaults: Record<string, unknown> | undefined, request: Record<string, unknown>, key: string): unknown {
  const params: Record<string, unknown> = { ...(defaults ?? {}), ...request };
  const record = (value: unknown): Record<string, unknown> | undefined =>
    value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  const values: { custom?: Record<string, unknown> | undefined; node_fields?: unknown } = {
    custom: record(params.comfyui_custom_fields) ?? record(params.custom),
  };
  const extra = record(params.comfyui_field_values);
  if (extra) Object.assign(values, extra);
  const nodeFields = record(values.node_fields);
  if (nodeFields && Object.hasOwn(nodeFields, key)) return nodeFields[key];
  return record(values.custom)?.[key];
}
