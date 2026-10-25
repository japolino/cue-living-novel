import { describe, expect, test } from "bun:test";

import { visualNovelLauncherCopy } from "./manual-launcher";

describe("manual visual novel launcher", () => {
  test("is named Cue while inactive", () => {
    const copy = visualNovelLauncherCopy(false);

    expect(copy.label).toBe("Cue");
    expect(copy.title).toBe("Open this chat in Cue");
  });

  test("becomes an exit control while active", () => {
    const copy = visualNovelLauncherCopy(true);

    expect(copy.label).toBe("Exit Cue");
    expect(copy.title).toBe("Exit Cue");
  });
});
