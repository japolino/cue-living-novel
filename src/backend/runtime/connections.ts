import type { ConnectionProfileDTO, ImageGenConnectionDTO, SpindleAPI } from "lumiverse-spindle-types";
import type { ConnectionCatalogErrors, ConnectionCatalogOption } from "../../protocol.js";

export type ConnectionCatalog = {
  planner: ConnectionCatalogOption[];
  image: ConnectionCatalogOption[];
  errors?: ConnectionCatalogErrors;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function errorText(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return value.length > 400 ? `${value.slice(0, 397)}...` : value;
}

function normalizedOptions(
  connections: readonly (ConnectionProfileDTO | ImageGenConnectionDTO)[]
): ConnectionCatalogOption[] {
  const byId = new Map<string, ConnectionCatalogOption>();
  for (const connection of connections) {
    const id = text(connection.id);
    if (!id) continue;
    const option: ConnectionCatalogOption = {
      id,
      name: text(connection.name) || id,
      provider: text(connection.provider),
      model: text(connection.model),
      isDefault: connection.is_default === true
    };
    const existing = byId.get(id);
    if (!existing || option.isDefault) byId.set(id, option);
  }
  return [...byId.values()].sort((left, right) =>
    Number(right.isDefault) - Number(left.isDefault)
    || left.name.localeCompare(right.name)
    || left.provider.localeCompare(right.provider)
    || left.model.localeCompare(right.model)
    || left.id.localeCompare(right.id)
  );
}

export type ResolvedPlannerConnection = {
  id: string;
  provider: string;
  model: string;
};

export async function resolvePlannerConnection(
  spindle: SpindleAPI,
  config: { parserConnectionId: string | null },
  userId?: string
): Promise<ResolvedPlannerConnection | null> {
  // Honor the user's explicitly chosen planner connection first.
  if (config.parserConnectionId) {
    const chosen = await spindle.connections?.get?.(config.parserConnectionId, userId);
    if (chosen) return { id: chosen.id, provider: chosen.provider, model: chosen.model };
  }
  // Otherwise fall back to the default connection so "Lumiverse default" works instead of failing.
  const connections = await spindle.connections?.list?.(userId);
  if (!connections) return null;
  const fallback = connections.find((connection) => connection.is_default) ?? connections[0];
  if (!fallback) return null;
  return { id: fallback.id, provider: fallback.provider, model: fallback.model };
}

export async function loadConnectionCatalog(spindle: SpindleAPI, userId?: string): Promise<ConnectionCatalog> {
  const [plannerResult, imageResult] = await Promise.allSettled([
    spindle.connections.list(userId),
    spindle.imageGen.listConnections(userId)
  ]);
  const errors: ConnectionCatalogErrors = {};
  if (plannerResult.status === "rejected") errors.planner = errorText(plannerResult.reason);
  if (imageResult.status === "rejected") errors.image = errorText(imageResult.reason);
  return {
    planner: plannerResult.status === "fulfilled" ? normalizedOptions(plannerResult.value) : [],
    image: imageResult.status === "fulfilled" ? normalizedOptions(imageResult.value) : [],
    ...(Object.keys(errors).length ? { errors } : {})
  };
}

