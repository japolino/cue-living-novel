import { describe, expect, test } from "bun:test";

import { SPRITE_HOT_SET } from "../../shared/sprites";
import { spriteFaceSpot, spriteGeometry } from "./sprite-layer";
import {
  PUPPET_EMOTE_GESTURE,
  PUPPET_GESTURE_S,
  PUPPET_MOODS,
  PUPPET_MOTION_GESTURE,
  PUPPET_NEUTRAL_MOOD,
  easeMood,
  puppetGesture,
  puppetGestureDelta,
  puppetMoodFor,
  puppetVoice,
  puppetVoiceSample,
  puppetVoiceType,
  type PuppetGestureKind,
} from "./sprite-puppet-acting";
import {
  PUPPET_BODY_SPRING,
  puppetSpring,
  puppetTracker,
  puppetWind,
  puppetWindPush,
  springKick,
  springStep,
  trackPoint,
} from "./sprite-puppet-physics";
import { PUPPET_REST, puppetDisplace, puppetFaceOffset, puppetPose, puppetRig, type PuppetPose, type PuppetPoseInput } from "./sprite-puppet-rig";

const image = { bbox: [0.0865, 0.0214, 0.7716, 0.9786] as [number, number, number, number], width: 416, height: 608, face: [0.3669, 0.16, 0.2343, 0.1497] as [number, number, number, number] };
const geometry = spriteGeometry(image);
const rig = puppetRig(geometry, spriteFaceSpot(image, geometry));
const pose = (patch: Partial<PuppetPose>): PuppetPose => ({ ...PUPPET_REST, ...patch });
const still: PuppetPoseInput = { time: 10, phase: 0.3, figH: rig.figH, faceW: rig.faceW, breathing: 0, sway: 0, head: 1, talk: 0, reaction: null, strength: 1, acting: 1 };

describe("puppet moods", () => {
  test("every hot-set expression has a mood; rare ids use their fallback; unknown is neutral", () => {
    for (const id of SPRITE_HOT_SET) expect(PUPPET_MOODS[id]).toBeDefined();
    expect(puppetMoodFor("idle")).toEqual({ ...PUPPET_NEUTRAL_MOOD });
    expect(puppetMoodFor("no_such_expression")).toEqual({ ...PUPPET_NEUTRAL_MOOD });
    expect(puppetMoodFor("sad").posture).toBeLessThan(0);
    expect(puppetMoodFor("angry").shoulders).toBeGreaterThan(0);
    expect(puppetMoodFor("scared").tremble).toBeGreaterThan(puppetMoodFor("worried").tremble);
  });

  test("staging intensity scales the distance from neutral", () => {
    const calm = puppetMoodFor("sad", 1);
    const normal = puppetMoodFor("sad", 3);
    const strong = puppetMoodFor("sad", 5);
    expect(normal.posture).toBeCloseTo(PUPPET_MOODS.sad.posture, 9);
    expect(Math.abs(calm.posture)).toBeLessThan(Math.abs(normal.posture));
    expect(Math.abs(strong.posture)).toBeGreaterThan(Math.abs(normal.posture));
    expect(strong.breathRate).toBeLessThan(normal.breathRate);
  });

  test("easing moves part of the way, in place", () => {
    const current = { ...PUPPET_NEUTRAL_MOOD };
    const target = puppetMoodFor("angry");
    easeMood(current, target, 0.5);
    expect(current.shoulders).toBeCloseTo(target.shoulders / 2, 9);
  });

  test("a sad body slumps with the head down; a surprised one draws up with the chin up", () => {
    const sad = puppetPose({ ...still, mood: puppetMoodFor("sad") });
    const surprised = puppetPose({ ...still, mood: puppetMoodFor("surprised") });
    expect(sad.posture).toBeLessThan(0);
    expect(sad.nod).toBeGreaterThan(0);
    expect(surprised.posture).toBeGreaterThan(0);
    expect(surprised.nod).toBeLessThan(0);
    // Acting off: the mood does nothing.
    expect(puppetPose({ ...still, acting: 0, mood: puppetMoodFor("sad") }).posture).toBe(0);
  });
});

describe("puppet voice", () => {
  test("a syllable starts at each vowel group; consonants and repeated vowels do not", () => {
    const voice = puppetVoice();
    const events = [..."hello"].map((ch, i) => puppetVoiceType(voice, ch, i * 0.03));
    expect(events).toEqual([null, "syllable", null, null, "syllable"]);
    expect(puppetVoiceType(voice, "o", 0.2)).toBeNull();
    expect(voice.syllables).toBe(2);
  });

  test("kana, kanji and hangul make one syllable per character", () => {
    const voice = puppetVoice();
    for (const [i, ch] of [..."こんにちは世界안녕"].entries()) expect(puppetVoiceType(voice, ch, i * 0.05)).toBe("syllable");
  });

  test("punctuation: stop, trailing dots, exclamation, question, pause, play", () => {
    const voice = puppetVoice();
    expect(puppetVoiceType(voice, ".", 1)).toBe("stop");
    expect(puppetVoiceType(voice, ".", 1.03)).toBeNull();
    expect(puppetVoiceType(voice, ".", 1.06)).toBe("trail");
    expect(voice.stopAt).toBe(-Infinity);
    expect(puppetVoiceType(voice, "!", 2)).toBe("exclaim");
    expect(puppetVoiceType(voice, "!", 2.03)).toBeNull();
    expect(puppetVoiceType(voice, "?", 3)).toBe("question");
    expect(puppetVoiceType(voice, ",", 4)).toBe("pause");
    expect(puppetVoiceType(voice, "~", 5)).toBe("play");
    expect(puppetVoiceType(voice, "…", 6)).toBe("trail");
    // A chunk reports its strongest event.
    expect(puppetVoiceType(puppetVoice(), "ah?", 0)).toBe("question");
  });

  test("the sample: a syllable pulse rises and decays; text keeps it active, a gap lets go", () => {
    const voice = puppetVoice();
    puppetVoiceType(voice, "a", 0);
    expect(puppetVoiceSample(voice, 0.045).syllable).toBeCloseTo(1, 6);
    expect(puppetVoiceSample(voice, 0.3).syllable).toBeLessThan(0.2);
    expect(puppetVoiceSample(voice, 0.1).active).toBe(1);
    expect(puppetVoiceSample(voice, 1).active).toBe(0);
    puppetVoiceType(voice, "?", 2);
    expect(puppetVoiceSample(voice, 2.5).question).toBe(1);
    expect(puppetVoiceSample(voice, 2.2).inhale).toBeGreaterThan(0);
    expect(puppetVoiceSample(voice, 5).question).toBe(0);
  });

  test("the speaker's head follows the text: a syllable dips it, a question tilts it", () => {
    const voice = puppetVoice();
    puppetVoiceType(voice, "a", 0);
    const talking = { ...still, talk: 1 };
    const dip = puppetPose({ ...talking, time: 0.05, voice: puppetVoiceSample(voice, 0.05) });
    const rest = puppetPose({ ...talking, time: 0.05, voice: { ...puppetVoiceSample(voice, 0.05), syllable: 0 } });
    expect(dip.bob).toBeLessThan(rest.bob);
    puppetVoiceType(voice, "?", 1);
    const asking = puppetPose({ ...talking, time: 1.5, side: 1, voice: puppetVoiceSample(voice, 1.5) });
    const plain = puppetPose({ ...talking, time: 1.5, side: 1, voice: { ...puppetVoiceSample(voice, 1.5), question: 0 } });
    expect(asking.tilt).toBeGreaterThan(plain.tilt);
  });
});

describe("puppet gestures", () => {
  const kinds = Object.keys(PUPPET_GESTURE_S) as PuppetGestureKind[];

  test("every gesture starts and ends at rest and moves something in between", () => {
    for (const kind of kinds) {
      const duration = PUPPET_GESTURE_S[kind];
      const moved = [0.15, 0.3, 0.5].some((f) => Object.values(puppetGesture(kind, duration * f, 1, 1, puppetGestureDelta())).some((v) => Math.abs(v) > 1e-4));
      expect(moved).toBe(true);
      expect(Object.values(puppetGesture(kind, duration, 1, 1, puppetGestureDelta())).every((v) => v === 0)).toBe(true);
      expect(Object.values(puppetGesture(kind, -0.1, 1, 1, puppetGestureDelta())).every((v) => v === 0)).toBe(true);
    }
  });

  test("emotes and staged motions map to gestures that exist", () => {
    for (const kind of [...Object.values(PUPPET_EMOTE_GESTURE), ...Object.values(PUPPET_MOTION_GESTURE)]) expect(kinds).toContain(kind!);
  });

  test("a staged head shake turns the head both ways", () => {
    const turns = [0.1, 0.18, 0.25, 0.33].map((age) => puppetPose({ ...still, gestures: [{ kind: "shake", age, gain: 1, side: 1 }] }).turn);
    expect(Math.max(...turns)).toBeGreaterThan(0);
    expect(Math.min(...turns)).toBeLessThan(0);
  });
});

describe("puppet attention and the 2.5D turn", () => {
  test("gaze turns the head toward the side looked at; the face centre moves more than the head's outline", () => {
    const looking = puppetPose({ ...still, gaze: 1 });
    expect(looking.turn).toBeGreaterThan(0);
    expect(looking.bodyTurn).toBeGreaterThan(0);
    const p = pose({ turn: looking.turn });
    const centre = puppetDisplace(rig, p, rig.faceX, rig.faceY)[0];
    const outline = puppetDisplace(rig, p, rig.faceX + 1.3 * rig.faceW, rig.faceY)[0];
    expect(centre).toBeCloseTo(looking.turn, 9);
    expect(Math.abs(outline)).toBeLessThan(centre * 0.05);
    // The feet never turn.
    expect(puppetDisplace(rig, p, 0, 0.01)).toEqual([0, 0]);
  });

  test("raised shoulders lift beside the neck, not the head; posture lifts the head, never the feet", () => {
    const up = pose({ shoulders: 0.01 });
    const shoulder = puppetDisplace(rig, up, rig.neckX + 1.2 * rig.faceW, rig.neckY - 0.35 * rig.faceH)[1];
    expect(shoulder).toBeGreaterThan(0.008);
    expect(Math.abs(puppetFaceOffset(rig, up)[1])).toBeLessThan(1e-6);
    const tall = pose({ posture: 0.02 });
    expect(puppetFaceOffset(rig, tall)[1]).toBeGreaterThan(0);
    expect(puppetDisplace(rig, tall, 0, 0.01)).toEqual([0, 0]);
    expect(puppetFaceOffset(rig, pose({ posture: -0.02 }))[1]).toBeLessThan(0);
  });

  test("loose parts and hair trail; the spine and the feet stay", () => {
    const lag = pose({ lagX: 0.01 });
    expect(puppetDisplace(rig, lag, rig.faceW * 2.6, rig.figH * 0.5)[0]).toBeCloseTo(0.01, 6);
    expect(puppetDisplace(rig, lag, 0, rig.figH * 0.5)[0]).toBe(0);
    expect(puppetDisplace(rig, lag, rig.faceW * 2.6, 0)[0]).toBe(0);
    const hair = pose({ hairX: 0.01 });
    const tip = puppetDisplace(rig, hair, rig.faceX + 1.5 * rig.faceW, rig.neckY - 0.4 * rig.faceH)[0];
    expect(tip).toBeGreaterThan(0.003);
    expect(puppetDisplace(rig, hair, rig.faceX, rig.faceY)[0]).toBe(0);
  });
});

describe("puppet physics", () => {
  test("a kick swings the spring, it overshoots and settles", () => {
    const spring = puppetSpring();
    springKick(spring, 0.2, 0);
    let min = 0;
    let max = 0;
    for (let i = 0; i < 120; i += 1) {
      springStep(spring, 1 / 60, PUPPET_BODY_SPRING);
      min = Math.min(min, spring.x);
      max = Math.max(max, spring.x);
    }
    expect(min).toBeLessThan(-0.005);
    expect(max).toBeGreaterThan(0.001);
    expect(Math.abs(spring.x)).toBeLessThan(0.002);
  });

  test("a slow frame stays stable and the offset stays within its limit", () => {
    const spring = puppetSpring();
    springKick(spring, 10, -10);
    springStep(spring, 0.1, PUPPET_BODY_SPRING);
    expect(Math.abs(spring.x)).toBeLessThanOrEqual(PUPPET_BODY_SPRING.limit);
    expect(Math.abs(spring.y)).toBeLessThanOrEqual(PUPPET_BODY_SPRING.limit);
    for (let i = 0; i < 50; i += 1) springStep(spring, 0.1, PUPPET_BODY_SPRING);
    expect(Number.isFinite(spring.x) && Math.abs(spring.x) < 1e-3).toBe(true);
  });

  test("the tracker reports velocity changes and ignores teleports", () => {
    const tracker = puppetTracker();
    expect(trackPoint(tracker, 0, 0, 1 / 60)).toEqual([0, 0]);
    const [dvx] = trackPoint(tracker, 0.01, 0, 1 / 60);
    expect(dvx).toBeGreaterThan(0);
    expect(trackPoint(tracker, 5, 0, 1 / 60)).toEqual([0, 0]);
  });

  test("a landing squashes the body: the loose mass lags down, the pose gets shorter", () => {
    const squash = puppetPose({ ...still, physics: { bodyX: 0, bodyY: -0.01, hairX: 0, hairY: 0, windX: 0 } });
    expect(squash.stretch).toBeLessThan(0);
    expect(squash.lagY).toBeLessThan(0);
  });

  test("wind: storms blow, calm weather does not; the push varies with time", () => {
    expect(puppetWind("heavy_rain")).toBe(1);
    expect(puppetWind("fireflies")).toBe(0);
    expect(puppetWind(null)).toBe(0);
    expect(puppetWindPush(0, 1, 0.5)).toBe(0);
    const pushes = [0, 0.4, 0.8, 1.2].map((t) => puppetWindPush(1, t, 0.5));
    expect(new Set(pushes.map((p) => p.toFixed(6))).size).toBeGreaterThan(1);
    expect(pushes.every((p) => Math.abs(p) < 0.01)).toBe(true);
  });
});
