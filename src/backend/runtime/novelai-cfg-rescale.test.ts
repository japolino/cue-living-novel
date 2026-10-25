import { describe, expect, test } from "bun:test";
import { withNovelAiCfgRescale } from "./novelai-cfg-rescale.js";

const noConnection = async () => null;

describe("withNovelAiCfgRescale", () => {
  test("parameters without it pass through untouched", async () => {
    const parameters = { steps: 28 };
    expect(await withNovelAiCfgRescale(parameters, "novelai", noConnection)).toBe(parameters);
  });

  test("other providers never see the key", async () => {
    expect(await withNovelAiCfgRescale({ steps: 20, cfgRescale: 0.3 }, "comfyui", noConnection)).toEqual({ steps: 20 });
  });

  test("NovelAI: into Cue's own raw override when it has one", async () => {
    let asked = false;
    const out = await withNovelAiCfgRescale(
      { steps: 20, cfgRescale: 0.35, rawRequestOverride: JSON.stringify({ parameters: { noise_schedule: "exponential" } }) },
      "novelai",
      async () => { asked = true; return JSON.stringify({ parameters: { steps: 14 } }); },
    );
    expect(asked).toBe(false);
    expect(out.cfgRescale).toBeUndefined();
    expect(JSON.parse(out.rawRequestOverride as string)).toEqual({ parameters: { noise_schedule: "exponential", cfg_rescale: 0.35 } });
  });

  test("NovelAI: over the connection's override when Cue has none, else alone", async () => {
    const connection = await withNovelAiCfgRescale({ cfgRescale: 0.3 }, "novelai", async () => JSON.stringify({ parameters: { steps: 14 } }));
    expect(JSON.parse(connection.rawRequestOverride as string)).toEqual({ parameters: { steps: 14, cfg_rescale: 0.3 } });
    const alone = await withNovelAiCfgRescale({ cfgRescale: 0 }, "novelai", noConnection);
    expect(JSON.parse(alone.rawRequestOverride as string)).toEqual({ parameters: { cfg_rescale: 0 } });
  });

  test("an out-of-range value or an override that is not JSON drops the key and changes nothing else", async () => {
    expect(await withNovelAiCfgRescale({ cfgRescale: 3 }, "novelai", noConnection)).toEqual({});
    expect(await withNovelAiCfgRescale({ cfgRescale: 0.3, rawRequestOverride: "{oops" }, "novelai", noConnection)).toEqual({ rawRequestOverride: "{oops" });
  });
});
