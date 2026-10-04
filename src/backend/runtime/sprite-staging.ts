import type { SpindleAPI } from "lumiverse-spindle-types";
import type { VisualNovelConfig } from "../../config.js";
import type { TurnPlan } from "../../shared/contracts.js";
import type { SpriteCastMember, SpriteParagraphStage, SpritePlateRef, SpriteStaging } from "../../shared/sprites.js";

/**
 * Sprite staging: who stands where, with which expression, motion, emote and
 * light, for every paragraph of a planned turn. See docs/SPRITE_MODE.md.
 *
 * Contract stub: the staging implementation fills this in.
 */
export type SpriteStagingInput = {
  plan: TurnPlan;
  config: VisualNovelConfig;
  /** From the sprite library (spriteStyleKey); used for plateKeyFor. */
  styleKey: string;
  /** Plates already in the user's library, so a revisit can reuse its plate. */
  knownPlates: readonly SpritePlateRef[];
  /** Cast and last paragraph stage of the previous turn in this chat, for continuity. */
  previousCast: readonly SpriteCastMember[];
  previousStage: SpriteParagraphStage | null;
  personaName?: string;
};

/** Pure, synchronous staging from the plan alone. Always succeeds. */
export function deterministicSpriteStaging(input: SpriteStagingInput): SpriteStaging {
  return {
    version: 1,
    source: "planner",
    cast: [],
    plates: [],
    paragraphs: input.plan.paragraphs.map(() => ({ actors: [], plateKey: null, light: "neutral" })),
  };
}

/**
 * Classifier staging when System One is configured (mode not "off" and a key
 * is saved), else deterministic. Never throws: any classifier failure falls
 * back to deterministicSpriteStaging.
 */
export async function buildSpriteStaging(
  _spindle: SpindleAPI,
  input: SpriteStagingInput & { userId?: string; signal?: AbortSignal },
): Promise<SpriteStaging> {
  return deterministicSpriteStaging(input);
}
