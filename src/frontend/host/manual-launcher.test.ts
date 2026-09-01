import { describe, expect, test } from "bun:test";

import { visualNovelLauncherCopy } from "./manual-launcher";

describe("manual visual novel launcher", () => {
  test("uses an explicit open label while inactive", () => {
    const copy = visualNovelLauncherCopy(false);

    expect(copy.label).toBe("Visual novel");
    expect(copy.title).toBe("Open visual novel mode");
  });

  test("becomes an exit control while active", () => {
    const copy = visualNovelLauncherCopy(true);

    expect(copy.label).toBe("Exit VN");
    expect(copy.title).toBe("Exit visual novel mode");
  });
});
