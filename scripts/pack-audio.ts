import { readdir, stat } from "node:fs/promises";
import { existsSync, createWriteStream, createReadStream } from "node:fs";
import path from "node:path";
import { scanAudioCatalog } from "../src/backend/runtime/audio-catalog.js";

/**
 * Packs a directory of audio into a standard VN audio pack archive or directory.
 */
export async function createAudioManifest(audioDir: string): Promise<Record<string, unknown>> {
  const catalog = await scanAudioCatalog(audioDir);
  return {
    name: "Visual Novel Audio Pack",
    version: "1.0.0",
    description: "Standard visual novel audio tracks and sound effects.",
    trackCount: {
      bgm: catalog.bgm.length,
      sfx: catalog.sfx.length,
      total: catalog.all.length,
    },
    tracks: {
      bgm: catalog.bgm.map((t) => ({ id: t.id, name: t.name, file: t.relativePath, tags: t.tags })),
      sfx: catalog.sfx.map((t) => ({ id: t.id, name: t.name, file: t.relativePath, tags: t.tags })),
    },
  };
}

// CLI execution
if (import.meta.main) {
  const args = process.argv.slice(2);
  const targetDir = args[0] || "./audio";
  console.log(`Scanning audio directory: ${targetDir}...`);
  if (!existsSync(targetDir)) {
    console.error(`Directory not found: ${targetDir}`);
    process.exit(1);
  }
  const manifest = await createAudioManifest(targetDir);
  console.log(`Found ${manifest.trackCount.bgm} BGM tracks and ${manifest.trackCount.sfx} SFX tracks.`);
  console.log(JSON.stringify(manifest, null, 2));
}
