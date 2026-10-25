/**
 * Adaptive render scale for the PNG puppet (docs/SPRITE_MODE.md, "Render
 * scale"). Pure. A puppet canvas costs about its pixel count each frame, so
 * while frames run long the canvases draw fewer pixels (their CSS size stays
 * and the browser scales them up), and they climb back when there is
 * headroom. Motion keeps its own clock, so it runs at the display's rate
 * whatever the scale.
 *
 * Frame intervals are judged a window at a time by their median, so a single
 * spike (an image decode, a GC pause) doesn't count. A step down is a trial:
 * when the next window isn't faster, the time went somewhere else (a busy
 * page, a frame-rate cap on battery), so the scale goes back and waits
 * longer each time before trying again. A step up has to hold for a while;
 * one that doesn't goes straight back and waits longer before the next.
 */

/** Render scale per level: a factor on the backing size the canvas would have at full quality. */
export const PUPPET_RENDER_SCALES = [1, 0.8, 0.65, 0.5] as const;

/** Frames per judged window (about half a second at 60 fps). */
export const PUPPET_QUALITY_WINDOW = 30;
/** A window whose median interval is longer runs under about 45 fps: slow. */
export const PUPPET_SLOW_FRAME_MS = 22;
/** At or under this the display's 60 fps holds: fast. */
export const PUPPET_FAST_FRAME_MS = 17.5;
/** A longer interval is a pause (a hidden tab, a stopped loop), not a slow frame. */
const GAP_MS = 250;
/** A trial step down has to cut the median interval by at least this share to stay. */
const TRIAL_GAIN = 0.1;
/** Fast time before a step up (ms); doubled after each step up that doesn't hold. */
const UP_WAIT_MS = 4000;
/** How long a step up has to go without a slow window to count as holding (ms). */
const UP_HOLD_MS = 10_000;
/** Wait after a trial step down that didn't help (ms); doubled each time. */
const DOWN_WAIT_MS = 8000;
const MAX_WAIT_MS = 120_000;

export type PuppetQuality = {
  /** Index into PUPPET_RENDER_SCALES. */
  level: number;
  /** The last frame's timestamp (ms); 0 before the first. */
  last: number;
  /** Frame intervals of the window so far (ms). */
  samples: number[];
  /** A step down being judged: the level it came from and that level's median interval. */
  trial: { from: number; median: number } | null;
  /** Until when the last step up is on probation (ms); 0 when none is. */
  holdUntil: number;
  /** Fast time in a row (ms). */
  fastFor: number;
  upWait: number;
  downWait: number;
  /** No trial step down before this (ms). */
  downAfter: number;
};

export const puppetQuality = (): PuppetQuality => ({
  level: 0, last: 0, samples: [], trial: null, holdUntil: 0, fastFor: 0,
  upWait: UP_WAIT_MS, downWait: DOWN_WAIT_MS, downAfter: 0,
});

export const puppetRenderScale = (quality: PuppetQuality): number => PUPPET_RENDER_SCALES[quality.level] ?? 1;

/** One frame at `time` (ms, the rAF timestamp). Returns whether the render scale changed. */
export function puppetQualityFrame(quality: PuppetQuality, time: number): boolean {
  const interval = quality.last ? time - quality.last : 0;
  quality.last = time;
  if (!(interval > 0) || interval > GAP_MS) {
    quality.samples.length = 0;
    return false;
  }
  quality.samples.push(interval);
  if (quality.samples.length < PUPPET_QUALITY_WINDOW) return false;
  const sorted = [...quality.samples].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1]!;
  const span = quality.samples.reduce((sum, ms) => sum + ms, 0);
  quality.samples.length = 0;
  const before = quality.level;
  judge(quality, median, span, time);
  return quality.level !== before;
}

function judge(q: PuppetQuality, median: number, span: number, time: number): void {
  const lowest = PUPPET_RENDER_SCALES.length - 1;
  if (q.trial) {
    const trial = q.trial;
    q.trial = null;
    if (median > trial.median * (1 - TRIAL_GAIN)) {
      // Fewer pixels didn't make frames faster: the time goes elsewhere.
      q.level = trial.from;
      q.downAfter = time + q.downWait;
      q.downWait = Math.min(MAX_WAIT_MS, q.downWait * 2);
      q.fastFor = 0;
      return;
    }
    q.downWait = DOWN_WAIT_MS;
  }
  if (q.holdUntil && time >= q.holdUntil) {
    q.holdUntil = 0;
    q.upWait = Math.max(UP_WAIT_MS, q.upWait / 2);
  }
  if (median > PUPPET_SLOW_FRAME_MS) {
    q.fastFor = 0;
    if (q.holdUntil) {
      // The step up didn't hold: straight back, and a longer wait before the next.
      q.holdUntil = 0;
      q.level = Math.min(lowest, q.level + 1);
      q.upWait = Math.min(MAX_WAIT_MS, q.upWait * 2);
    } else if (q.level < lowest && time >= q.downAfter) {
      q.trial = { from: q.level, median };
      q.level += 1;
    }
    return;
  }
  if (median > PUPPET_FAST_FRAME_MS) {
    q.fastFor = 0;
    return;
  }
  q.fastFor += span;
  if (q.level > 0 && q.fastFor >= q.upWait) {
    q.level -= 1;
    q.fastFor = 0;
    q.holdUntil = time + UP_HOLD_MS;
  }
}
