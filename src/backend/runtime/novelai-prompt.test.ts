import { expect, test } from "bun:test";
import { novelAiCapabilities, novelAiQualityTags, renderNovelAiEmphasis } from "./novelai-prompt";

test("NovelAI capabilities are model-specific and unknown models fail conservatively", () => {
  expect(novelAiCapabilities("nai-diffusion-3")).toEqual({ structured: false, numeric: false, negativeNumeric: false, alpha: false });
  expect(novelAiCapabilities("nai-diffusion-4-full")).toEqual({ structured: true, numeric: true, negativeNumeric: false, alpha: false });
  for (const model of ["nai-diffusion-4-5-full", "nai-diffusion-5-full"]) expect(novelAiCapabilities(model).negativeNumeric).toBe(true);
  for (const model of ["nai-diffusion-5-full", "nai-diffusion-5-curated", "nai-diffusion-5-full-inpainting"]) expect(novelAiCapabilities(model).alpha).toBe(true);
  expect(novelAiCapabilities("nai-diffusion-4-5-full").alpha).toBe(false);
  expect(novelAiCapabilities(null).structured).toBe(false);
});

test("NAI numeric weights preserve exact strengths and flatten nested compiler weights", () => {
  expect(renderNovelAiEmphasis("(smile:1.22)", "nai-diffusion-4-full")).toBe("1.22::smile::");
  expect(renderNovelAiEmphasis("(happy, (blush:1.2):1.1)", "nai-diffusion-5-full")).toBe("1.1::happy, ::1.32::blush::");
  expect(renderNovelAiEmphasis("Mira \\(Series\\), (smile:1.2)", "nai-diffusion-4-full")).toBe("Mira \\(Series\\), 1.2::smile::");
});

test("native syntax survives and unsupported negative numeric weights are reported", () => {
  expect(renderNovelAiEmphasis("{smile}, [rain], -1::hat::", "nai-diffusion-4-5-full")).toBe("{smile}, [rain], -1::hat::");
  expect(() => renderNovelAiEmphasis("-1::hat::", "nai-diffusion-4-full")).toThrow("V4.5");
  expect(renderNovelAiEmphasis("1.1025::smile::", "nai-diffusion-3")).toBe("{{smile}}");
});

test("quality defaults follow the selected model", () => {
  expect(novelAiQualityTags("nai-diffusion-4-5-curated")).toContain("-0.8::feet::");
  expect(novelAiQualityTags("nai-diffusion-5-full")).toBe("very aesthetic, masterpiece, no text");
  expect(novelAiQualityTags("nai-diffusion-3")).not.toContain("::");
});
