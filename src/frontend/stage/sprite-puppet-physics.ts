/**
 * Follow-through for the PNG puppet (docs/SPRITE_MODE.md, "Puppet
 * physics"). Pure: damped springs for the loose mass of a figure (skirt
 * and coat hems, sleeves, the upper body) and of its hair. When the figure
 * moves (a slot change, a staged hop or shake, an entrance) or the head
 * nods and turns, the loose parts keep their velocity for a moment, so they
 * trail, overshoot and settle; the body squashes on a landing and stretches
 * on the rebound. Wind from the weather ambient pushes the loose parts and
 * makes them flutter. Units: image heights, x right, y up.
 */

const TAU = Math.PI * 2;

export type PuppetSpring = { x: number; y: number; vx: number; vy: number };

export type PuppetSpringTuning = {
  /** Angular frequency (rad/s). */
  omega: number;
  /** Damping ratio (< 1 overshoots). */
  zeta: number;
  /** Largest offset either way (image heights). */
  limit: number;
};

/** The loose mass of the body: about 1.5 swings a second, a little bouncy. */
export const PUPPET_BODY_SPRING: Readonly<PuppetSpringTuning> = { omega: TAU * 1.5, zeta: 0.3, limit: 0.03 };
/** Hair: lighter and quicker, bouncier. */
export const PUPPET_HAIR_SPRING: Readonly<PuppetSpringTuning> = { omega: TAU * 2.3, zeta: 0.22, limit: 0.025 };

export const puppetSpring = (): PuppetSpring => ({ x: 0, y: 0, vx: 0, vy: 0 });

/**
 * The anchor's velocity changed by (dvx, dvy): the loose mass keeps going,
 * so relative to the anchor it gains the opposite velocity.
 */
export function springKick(spring: PuppetSpring, dvx: number, dvy: number): void {
  spring.vx -= dvx;
  spring.vy -= dvy;
}

/** Advance a spring toward rest by `dt` seconds (sub-stepped, so a slow frame stays stable). */
export function springStep(spring: PuppetSpring, dt: number, tuning: PuppetSpringTuning): void {
  if (!(dt > 0)) return;
  const steps = Math.max(1, Math.ceil(dt * 240));
  const h = dt / steps;
  const { omega, zeta, limit } = tuning;
  const k = omega * omega;
  const c = 2 * zeta * omega;
  for (let i = 0; i < steps; i += 1) {
    spring.vx += (-k * spring.x - c * spring.vx) * h;
    spring.vy += (-k * spring.y - c * spring.vy) * h;
    spring.x += spring.vx * h;
    spring.y += spring.vy * h;
  }
  if (Math.abs(spring.x) > limit) {
    spring.x = Math.sign(spring.x) * limit;
    if (spring.vx * spring.x > 0) spring.vx = 0;
  }
  if (Math.abs(spring.y) > limit) {
    spring.y = Math.sign(spring.y) * limit;
    if (spring.vy * spring.y > 0) spring.vy = 0;
  }
}

/** Settle a spring at once (a teleport: a new layout, a resize). */
export function springReset(spring: PuppetSpring): void {
  spring.x = spring.y = spring.vx = spring.vy = 0;
}

/**
 * Tracks a moving point and returns its velocity change since the last
 * frame (for springKick). The velocity is smoothed over ~30 ms (layout
 * positions are whole pixels); a jump larger than `teleport` image heights
 * in one frame resets instead and returns no change.
 */
export type PuppetTracker = { x: number; y: number; vx: number; vy: number; ready: boolean };

export const puppetTracker = (): PuppetTracker => ({ x: 0, y: 0, vx: 0, vy: 0, ready: false });

export function trackPoint(tracker: PuppetTracker, x: number, y: number, dt: number, teleport = 0.25): [number, number] {
  if (!tracker.ready || !(dt > 0) || Math.hypot(x - tracker.x, y - tracker.y) > teleport) {
    tracker.x = x;
    tracker.y = y;
    tracker.vx = 0;
    tracker.vy = 0;
    tracker.ready = true;
    return [0, 0];
  }
  const a = 1 - Math.exp(-dt / 0.03);
  const vx = tracker.vx + ((x - tracker.x) / dt - tracker.vx) * a;
  const vy = tracker.vy + ((y - tracker.y) / dt - tracker.vy) * a;
  const change: [number, number] = [vx - tracker.vx, vy - tracker.vy];
  tracker.x = x;
  tracker.y = y;
  tracker.vx = vx;
  tracker.vy = vy;
  return change;
}

/** How hard the weather blows (0 = still air). */
const WIND: Readonly<Record<string, number>> = { heavy_rain: 1, sakura: 0.45, rain: 0.35, snow: 0.25 };

export function puppetWind(ambient: string | null | undefined): number {
  return (ambient && WIND[ambient]) || 0;
}

/**
 * Wind push at a time (image heights, + = toward the image's right): a
 * steady lean with gusts and a flutter, per character phase.
 */
export function puppetWindPush(strength: number, time: number, phase: number): number {
  if (!strength) return 0;
  const t = time + phase * 23.7;
  const gust = 0.55 + 0.45 * Math.sin((TAU * t) / 7.7) * Math.sin((TAU * t) / 3.1 + 1.3);
  const flutter = 0.6 * Math.sin(TAU * 1.7 * t) + 0.3 * Math.sin(TAU * 3.3 * t + 0.7) + 0.1 * Math.sin(TAU * 6.1 * t + 2.1);
  return strength * (0.0035 * gust + 0.0022 * flutter * gust);
}
