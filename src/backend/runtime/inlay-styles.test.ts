import { describe, expect, test } from "bun:test";
import { loadInlayStyles } from "./inlay-styles.js";

const PUBLISHED = { version: 1, defaultArtistId: "artist_a", novelai: [{ id: "artist_a", title: "Webtoon", prompt: "artist:a", negativePrompt: "text" }], anima: [] };

function pool(endpoints: Record<string, unknown | Error>) {
  const reads: string[] = [];
  return {
    reads,
    spindle: {
      rpcPool: {
        read: async (endpoint: string) => {
          reads.push(endpoint);
          const value = endpoints[endpoint];
          if (value instanceof Error) throw value;
          if (value === undefined) throw new Error(`Shared RPC endpoint "${endpoint}" is not registered`);
          return value;
        },
      },
    } as never,
  };
}

describe("loadInlayStyles", () => {
  test("reads the user's endpoint", async () => {
    const fake = pool({ "inlay_illustrator.artists.u1": PUBLISHED });
    expect(await loadInlayStyles(fake.spindle, "u1")).toEqual({
      state: "ready",
      defaultId: "artist_a",
      styles: [{ id: "artist_a", title: "Webtoon", prompt: "artist:a", negativePrompt: "text", builtIn: false }],
    });
    expect(fake.reads).toEqual(["inlay_illustrator.artists.u1"]);
  });

  test("falls back to the owner's endpoint (user-scoped install)", async () => {
    const fake = pool({ "inlay_illustrator.artists.owner": PUBLISHED });
    expect((await loadInlayStyles(fake.spindle, "u1")).state).toBe("ready");
    expect(fake.reads).toEqual(["inlay_illustrator.artists.u1", "inlay_illustrator.artists.owner"]);
  });

  test("says why there is no list", async () => {
    const missing = await loadInlayStyles(pool({}).spindle, "u1");
    expect(missing).toMatchObject({ state: "unavailable" });
    expect(missing.state === "unavailable" && missing.reason).toContain("Inlay isn't sharing art styles");

    const denied = await loadInlayStyles(pool({ "inlay_illustrator.artists.u1": new Error('requires requester "visual_novel_preview" permissions: image_gen') }).spindle, "u1");
    expect(denied.state === "unavailable" && denied.reason).toContain("permissions: image_gen");

    const odd = await loadInlayStyles(pool({ "inlay_illustrator.artists.u1": { version: 9 } }).spindle, "u1");
    expect(odd.state === "unavailable" && odd.reason).toContain("Update Cue");

    const old = await loadInlayStyles({} as never, "u1");
    expect(old.state === "unavailable" && old.reason).toContain("Update Lumiverse");
  });
});
