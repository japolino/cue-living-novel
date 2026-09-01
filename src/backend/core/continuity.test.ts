import { describe, expect, test } from "bun:test";
import type { ContinuityState, SceneBoundaryProposal, SceneState } from "../../shared/contracts.js";
import { applyContinuityDelta, continuityEquals, reduceContinuity } from "./continuity.js";
import { decideSceneBoundary } from "./scene-boundary.js";

const initial: ContinuityState = {
  revision: 4,
  characters: {
    Mira: {
      present: true,
      appearance: { eyes: "green", hair: "black" },
      wardrobe: { coat: "red" },
      pose: "standing",
      expression: "calm",
      props: ["key"]
    }
  },
  facts: { door: "locked", season: "winter" }
};

describe("continuity reduction", () => {
  test("applies patches, deletions, and additions without mutating its input", () => {
    const next = applyContinuityDelta(initial, {
      characterUpdates: {
        Mira: { wardrobe: { coat: "blue" }, expression: "surprised", props: ["lamp", "key", "lamp"] },
        Theo: { present: true, appearance: { hair: "brown" } }
      },
      forgetCharacters: [],
      factUpdates: { door: "open", season: null }
    });

    expect(next.revision).toBe(5);
    expect(next.characters.Mira?.wardrobe).toEqual({ coat: "blue" });
    expect(next.characters.Mira?.props).toEqual(["key", "lamp"]);
    expect(next.characters.Theo?.appearance).toEqual({ hair: "brown" });
    expect(next.facts).toEqual({ door: "open" });
    expect(initial.characters.Mira?.wardrobe).toEqual({ coat: "red" });
  });

  test("produces a stable terminal state and rejects out-of-order deltas", () => {
    const deltas = [
      { paragraphIndex: 0, delta: { characterUpdates: {}, forgetCharacters: [], factUpdates: { door: "open" } } },
      { paragraphIndex: 2, delta: { characterUpdates: { Mira: { pose: "seated" } }, forgetCharacters: [], factUpdates: {} } }
    ];
    const first = reduceContinuity(initial, deltas);
    const second = reduceContinuity(initial, deltas);
    expect(continuityEquals(first, second)).toBe(true);
    expect(() => reduceContinuity(initial, [...deltas].reverse())).toThrow("ordered by paragraph");
  });
});

function scene(location: string): SceneState {
  return {
    sceneId: "scene-1",
    revision: 1,
    startParagraph: 0,
    environment: {
      location,
      timeOfDay: "night",
      weather: null,
      lighting: "moonlight",
      description: "A quiet room",
      persistentElements: []
    },
    cast: ["Mira"],
    continuity: initial,
    basePrompt: "quiet moonlit room",
    cameraLock: {
      framing: "medium wide",
      angle: "eye level",
      perspective: "fixed",
      lens: "50mm",
      subjectAnchor: "center",
      horizon: "upper third",
      safeDialogueRegion: "lower third",
      aspectRatio: "16:9"
    },
    compositionLock: "Mira centered",
    activeAssetId: null,
    priorSceneId: null
  };
}

function proposal(input: Partial<SceneBoundaryProposal> = {}): SceneBoundaryProposal {
  return {
    claimedNewScene: false,
    reason: "none",
    location: "Atrium",
    timeOfDay: "night",
    majorTimeJump: false,
    environmentReplacement: false,
    forced: false,
    ...input
  };
}

describe("scene boundary decisions", () => {
  test("does not split a scene for punctuation or case differences", () => {
    const decision = decideSceneBoundary(scene("THE ATRIUM!"), proposal());
    expect(decision).toMatchObject({ startsNewScene: false, acceptedClaim: true, reason: "none" });
  });

  test("uses deterministic evidence instead of trusting the sidecar claim", () => {
    const decision = decideSceneBoundary(scene("Atrium"), proposal({ claimedNewScene: false, location: "Roof" }));
    expect(decision).toMatchObject({ startsNewScene: true, acceptedClaim: false, reason: "location_change" });
  });

  test("always starts the initial scene", () => {
    expect(decideSceneBoundary(null, proposal({ claimedNewScene: true, reason: "initial" }))).toMatchObject({
      startsNewScene: true,
      acceptedClaim: true,
      reason: "initial"
    });
  });
});

