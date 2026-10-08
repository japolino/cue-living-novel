import { describe, expect, test } from "bun:test";
import { spriteSetKeyFor } from "../../../shared/sprites.js";
import { MIRA, mockSpindle, sampleStaging, spriteConfig } from "./__fixtures__/sprite-fixtures.js";
import { emptySpriteLibrary, newSpriteSet, type SpriteLibrary } from "./library.js";
import { SpriteService } from "./jobs.js";
import { spriteStyleKey } from "./style.js";
import { resolveSpriteSet, spriteTurnView } from "./views.js";

const STYLE = "style_a";
const RIN = { characterKey: "rin", name: "Rin", identity: "catgirl, golden eyes", attire: "dark green bib apron, white collared shirt, black slacks" };

function library(...sets: Array<{ attire: string | null; ready?: number; usedAt?: string; identity?: string; style?: string; name?: string }>): SpriteLibrary {
  const lib = emptySpriteLibrary();
  for (const entry of sets) {
    const member = { name: entry.name ?? "Rin", identity: entry.identity ?? RIN.identity, attire: entry.attire };
    const style = entry.style ?? STYLE;
    const key = spriteSetKeyFor(member, style);
    const set = newSpriteSet(member, key, style, entry.usedAt ?? "2026-10-01T00:00:00.000Z");
    Object.values(set.images).slice(0, entry.ready ?? 0).forEach((image) => { image.status = "ready"; image.cutUrl = "blob:x"; });
    lib.sets[key] = set;
  }
  return lib;
}

describe("sprite set reuse", () => {
  test("the exact set wins; a reworded outfit reuses the matching set", () => {
    const lib = library({ attire: RIN.attire, ready: 2 }, { attire: "white button-down shirt, black shorts", ready: 12 });
    expect(resolveSpriteSet(lib, RIN, STYLE)).toMatchObject({ setKey: spriteSetKeyFor(RIN, STYLE), reusedFrom: null });
    const reworded = { ...RIN, attire: "dark green bib apron, tight white collared shirt, fitted black slacks" };
    const resolved = resolveSpriteSet(lib, reworded, STYLE);
    expect(resolved.setKey).toBe(spriteSetKeyFor(RIN, STYLE));
    expect(resolved.reusedFrom).toBe(spriteSetKeyFor(reworded, STYLE));
  });

  test("most ready images first, then the latest used", () => {
    const a = "white collared shirt, green bib apron, black shorts";
    const b = "dark green bib apron, tight white collared shirt, fitted black slacks";
    const lib = library({ attire: a, ready: 3, usedAt: "2026-10-01T00:00:00.000Z" }, { attire: b, ready: 5, usedAt: "2026-09-01T00:00:00.000Z" });
    expect(resolveSpriteSet(lib, RIN, STYLE).setKey).toBe(spriteSetKeyFor({ ...RIN, attire: b }, STYLE));
    const tie = library({ attire: a, ready: 5, usedAt: "2026-10-02T00:00:00.000Z" }, { attire: b, ready: 5, usedAt: "2026-09-01T00:00:00.000Z" });
    expect(resolveSpriteSet(tie, RIN, STYLE).setKey).toBe(spriteSetKeyFor({ ...RIN, attire: a }, STYLE));
  });

  test("another outfit, identity, style or name is a new set; two usual outfits match", () => {
    const lib = library({ attire: RIN.attire, ready: 4 });
    expect(resolveSpriteSet(lib, { ...RIN, attire: "oversized knit sweater under a green café bib apron, fitted black slacks" }, STYLE).set).toBeUndefined();
    expect(resolveSpriteSet(lib, { ...RIN, identity: "catgirl, blue eyes", attire: "green apron, white shirt, black slacks" }, STYLE).set).toBeUndefined();
    expect(resolveSpriteSet(lib, { ...RIN, attire: "green apron, white shirt, black slacks" }, "style_b").set).toBeUndefined();
    expect(resolveSpriteSet(lib, { ...RIN, name: "Mira", attire: "green apron, white shirt, black slacks" }, STYLE).set).toBeUndefined();
    expect(resolveSpriteSet(lib, { ...RIN, attire: null }, STYLE).set).toBeUndefined();
    const usual = library({ attire: null, ready: 2 });
    expect(resolveSpriteSet(usual, { ...RIN, attire: "  " }, STYLE).set).toBeDefined();
  });

  test("the turn view shows the reused set", () => {
    const lib = library({ attire: RIN.attire, ready: 4 });
    const staging = { ...sampleStaging(STYLE, [{ ...RIN, attire: "white collared shirt, green bib apron, black shorts" }]) };
    staging.paragraphs = staging.paragraphs.map((paragraph) => ({ ...paragraph, actors: paragraph.actors.map((actor) => ({ ...actor, characterKey: "rin" })) }));
    const view = spriteTurnView(staging, lib, STYLE);
    expect(view.sets.rin!.setKey).toBe(spriteSetKeyFor(RIN, STYLE));
    expect(view.sets.rin!.readyCount).toBe(4);
  });

  test("ensureForStaging reuses the set instead of making a new one, and the view agrees", async () => {
    const mock = mockSpindle({ gated: true });
    const config = spriteConfig();
    const log: string[] = [];
    const service = new SpriteService(mock.spindle, { isViewOpen: () => false, loadConfig: async () => config, log: (line) => log.push(line) });
    const styleKey = spriteStyleKey(config);
    await service.ensureForStaging("u1", sampleStaging(styleKey), config);
    const reworded = { ...MIRA, attire: "navy school uniform, red ribbon" };
    const staging = sampleStaging(styleKey, [reworded]);
    await service.ensureForStaging("u1", staging, config);
    await service.retryFailed("u1", staging, config);
    const lib = await service.library.get("u1");
    expect(Object.keys(lib.sets)).toEqual([spriteSetKeyFor(MIRA, styleKey)]);
    expect(log.some((line) => line.startsWith(`sprite set reuse: ${spriteSetKeyFor(MIRA, styleKey)} for Mira`))).toBe(true);
    const view = await service.turnView("u1", staging, config);
    expect(view.sets.mira!.setKey).toBe(spriteSetKeyFor(MIRA, styleKey));
  });
});
