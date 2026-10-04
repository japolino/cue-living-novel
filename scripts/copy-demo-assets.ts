import { cp, mkdir, rm } from "node:fs/promises";

/** Copy the sprite fixtures into the standalone demo (`?sprites`). Output is git-ignored. */
const target = "demo/fixtures/sprites";
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp("scripts/fixtures/sprites", target, { recursive: true });
