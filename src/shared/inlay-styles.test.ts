import { describe, expect, test } from "bun:test";
import { flattenStylePrompt, inlayStyleEndpoints, matchingInlayStyle, normalizeInlayStyles } from "./inlay-styles.js";

describe("Inlay art styles", () => {
  test("the user's endpoint first, then the owner's; ids outside the pool syntax read as owner", () => {
    expect(inlayStyleEndpoints("4FCC3ACE-ae4f-4ebc-9dce-07520792a685")).toEqual([
      "inlay_illustrator.artists.4fcc3ace-ae4f-4ebc-9dce-07520792a685",
      "inlay_illustrator.artists.owner",
    ]);
    expect(inlayStyleEndpoints(undefined)).toEqual(["inlay_illustrator.artists.owner"]);
    expect(inlayStyleEndpoints("a.b")).toEqual(["inlay_illustrator.artists.owner"]);
  });

  test("prompts are flattened to one line", () => {
    expect(flattenStylePrompt("2.0::artist:chamchami ::,\n\n   year 2025,\t newest, ")).toBe("2.0::artist:chamchami ::, year 2025, newest,");
  });

  test("normalizes what Inlay publishes: overrides in range, no duplicates or empty prompts, default kept when listed", () => {
    const list = normalizeInlayStyles({
      version: 1,
      defaultArtistId: "artist_b",
      novelai: [
        { id: "detail_anime_illustration_style", title: "Detail anime", prompt: "built in", negativePrompt: "", builtIn: true },
        { id: "artist_b", title: "Korean Sharp Eyes", prompt: "2.0::artist:chamchami ::,\n year 2025", negativePrompt: "text,\n logo", novelAIOverrides: { steps: 20, scale: 6, cfgRescale: 0.3 }, builtIn: false },
        { id: "artist_b", title: "Duplicate", prompt: "x" },
        { id: "artist_c", title: "Empty", prompt: "   " },
        { id: "artist_d", prompt: "y", novelAIOverrides: { steps: 400, scale: "7.5", cfgRescale: 2 } },
        "junk",
      ],
      anima: [],
    });
    expect(list).toEqual({
      defaultId: "artist_b",
      styles: [
        { id: "detail_anime_illustration_style", title: "Detail anime", prompt: "built in", negativePrompt: "", builtIn: true },
        { id: "artist_b", title: "Korean Sharp Eyes", prompt: "2.0::artist:chamchami ::, year 2025", negativePrompt: "text, logo", steps: 20, guidance: 6, cfgRescale: 0.3, builtIn: false },
        { id: "artist_d", title: "artist_d", prompt: "y", negativePrompt: "", guidance: 7.5, builtIn: false },
      ],
    });
    expect(normalizeInlayStyles({ version: 1, defaultArtistId: "gone", novelai: [] })).toEqual({ styles: [], defaultId: "" });
  });

  test("an unknown shape is refused", () => {
    expect(normalizeInlayStyles(null)).toBeNull();
    expect(normalizeInlayStyles({ version: 2, novelai: [] })).toBeNull();
    expect(normalizeInlayStyles({ version: 1, novelai: {} })).toBeNull();
  });

  test("the style the prompt fields hold, whatever their spacing", () => {
    const styles = normalizeInlayStyles({ version: 1, novelai: [{ id: "a", prompt: "artist:a, year 2025", negativePrompt: "text" }] })!.styles;
    expect(matchingInlayStyle(styles, " artist:a,  year 2025 ", "text")?.id).toBe("a");
    expect(matchingInlayStyle(styles, "artist:a, year 2025", "text, logo")).toBeUndefined();
  });
});
