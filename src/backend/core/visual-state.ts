export type CharacterProfile = {
  name: string;
  description: string;
};

export type VisualProfileState = Record<string /*lowercased name*/, CharacterProfile>;

export function emptyProfiles(): VisualProfileState {
  return {};
}

export function profileFor(existing: VisualProfileState, name: string): CharacterProfile | undefined {
  return existing[name.trim().toLowerCase()];
}

export function upsertProfiles(
  base: VisualProfileState,
  incoming: Array<{ name: string; description: string }>
): VisualProfileState {
  const next: VisualProfileState = { ...base };
  for (const entry of incoming) {
    if (!entry.name.trim() || !entry.description.trim()) continue;
    next[entry.name.trim().toLowerCase()] = { ...entry };
  }
  return next;
}

export function profilesForPrompt(profiles: VisualProfileState): string {
  return Object.values(profiles)
    .map((profile) => `${profile.name}: ${profile.description}`)
    .join("\n");
}

export function parseProfiles(value: unknown): VisualProfileState {
  if (!value || typeof value !== "object") return {};
  const next: VisualProfileState = {};
  for (const [, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const description = typeof record.description === "string" ? record.description.trim() : "";
    if (!name || !description) continue;
    next[name.toLowerCase()] = { name, description };
  }
  return next;
}
