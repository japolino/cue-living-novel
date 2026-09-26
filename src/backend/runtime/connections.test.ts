import assert from "node:assert/strict";
import test from "node:test";
import type { ConnectionProfileDTO, SpindleAPI } from "lumiverse-spindle-types";
import { isSystemOneProfile, loadConnectionCatalog, resolvePlannerConnection } from "./connections.js";

const jev = { id: "jev", name: "Jev", provider: "typesafe", model: "jev-latest", is_default: true, metadata: {} } as ConnectionProfileDTO;
const llm = { id: "story", name: "Story reader", provider: "openrouter", model: "story-model", is_default: false, metadata: {} } as ConnectionProfileDTO;

function spindle(profiles: ConnectionProfileDTO[]): SpindleAPI {
  return {
    connections: {
      list: async () => profiles,
      get: async (id: string) => profiles.find((profile) => profile.id === id) ?? null
    },
    imageGen: { listConnections: async () => [] }
  } as unknown as SpindleAPI;
}

test("Jev profiles stay in Lumiverse's shared store but outside the story-reader catalog", async () => {
  assert.equal(isSystemOneProfile(jev), true);
  assert.equal(isSystemOneProfile(llm), false);
  const catalog = await loadConnectionCatalog(spindle([jev, llm]));
  assert.deepEqual(catalog.planner.map((profile) => profile.id), ["story"]);
});

test("a System One default or stale planner selection cannot become Cue's prose planner", async () => {
  const api = spindle([jev, llm]);
  assert.deepEqual(await resolvePlannerConnection(api, { parserConnectionId: "jev" }), {
    id: "story", provider: "openrouter", model: "story-model"
  });
  assert.deepEqual(await resolvePlannerConnection(api, { parserConnectionId: null }), {
    id: "story", provider: "openrouter", model: "story-model"
  });
  assert.equal(await resolvePlannerConnection(spindle([jev]), { parserConnectionId: null }), null);
});
