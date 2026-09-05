import type { AmbientEffect, StageEffect } from "../store";

/**
 * Deterministic pseudo-random helper based on an integer avalanche hash.
 * A plain linear-congruential progression correlates across sequential
 * indices and visibly arranges particles into diagonal lattice lines, so the
 * seed/index pair is avalanched first. Deterministic across platforms, which
 * keeps tests stable and SVG output byte-identical.
 */
function pseudo(seed: number, index: number, min: number, max: number): number {
  let h = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(index + 0x632be5ab, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  const v = h / 0xffffffff;
  return min + v * (max - min);
}

/**
 * Stratified horizontal placement: particle `index` of `count` lands inside
 * its own even slice of [min, max] with hash jitter. Random sampling alone
 * visibly clumps at these particle counts; stratification guarantees the
 * whole width is covered while still looking organic.
 */
function strat(seed: number, index: number, count: number, min: number, max: number): number {
  const jitter = pseudo(seed, index, 0.06, 0.94);
  return min + ((index + jitter) / count) * (max - min);
}

export function generateAmbientMarkup(effect: AmbientEffect): string {
  switch (effect) {
    case "rain":
      return generateRainMarkup(false);
    case "heavy_rain":
      return generateRainMarkup(true);
    case "snow":
      return generateSnowMarkup();
    case "sakura":
      return generateSakuraMarkup();
    case "fog":
      return generateFogMarkup();
    case "fireflies":
      return generateFirefliesMarkup();
    case "embers":
      return generateEmbersMarkup();
    case "vignette_dark":
    case "sepia_flashback":
    case "desaturate":
    case "dream_haze":
    case "danger_pulse":
      // Mood grades are handled via CSS filter & gradient overlays on scene / ambient container
      return "";
  }
}

export function generateCueEffectMarkup(effect: StageEffect): string {
  switch (effect) {
    case "speed_lines":
      return generateSpeedLinesMarkup();
    case "sparkle_burst":
      return generateSparkleBurstMarkup();
    case "hearts_burst":
      return generateHeartsBurstMarkup();
    case "confetti":
      return generateConfettiMarkup();
    default:
      return "";
  }
}

function generateRainMarkup(heavy: boolean): string {
  const bgCount = heavy ? 44 : 34;
  const mgCount = heavy ? 34 : 26;
  const fgCount = heavy ? 22 : 16;
  const slant = heavy ? 9 : 5;
  const lenBg = heavy ? 24 : 18;
  const lenMg = heavy ? 34 : 26;
  const lenFg = heavy ? 44 : 34;

  const bgLines: string[] = [];
  for (let i = 0; i < bgCount; i++) {
    const x = strat(1, i, bgCount, 10, 790);
    const y = pseudo(2, i, 0, 600);
    const delay = -pseudo(3, i, 0, 0.6);
    bgLines.push(
      `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x - slant).toFixed(1)}" y2="${(y + lenBg).toFixed(1)}" stroke="#a8c8ec" stroke-width="1" opacity="0.38" style="animation-delay: ${delay.toFixed(2)}s;" />`
    );
  }

  const mgLines: string[] = [];
  for (let i = 0; i < mgCount; i++) {
    const x = strat(4, i, mgCount, 10, 790);
    const y = pseudo(5, i, 0, 600);
    const delay = -pseudo(6, i, 0, 0.7);
    mgLines.push(
      `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x - slant).toFixed(1)}" y2="${(y + lenMg).toFixed(1)}" stroke="#c0daf7" stroke-width="1.5" opacity="0.65" style="animation-delay: ${delay.toFixed(2)}s;" />`
    );
  }

  const fgLines: string[] = [];
  for (let i = 0; i < fgCount; i++) {
    const x = strat(7, i, fgCount, 10, 790);
    const y = pseudo(8, i, 0, 600);
    const delay = -pseudo(9, i, 0, 0.5);
    fgLines.push(
      `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x - slant).toFixed(1)}" y2="${(y + lenFg).toFixed(1)}" stroke="#e8f2ff" stroke-width="2.2" opacity="0.88" style="animation-delay: ${delay.toFixed(2)}s;" />`
    );
  }

  let extraOverlay = `<rect width="800" height="600" fill="rgba(30, 42, 66, 0.10)" />`;
  if (heavy) {
    // Wet-lens effect: atmospheric storm mist + 7 droplet-refraction spots on camera lens
    const droplets: string[] = [];
    const dropletCoords = [
      { x: 120, y: 140, r: 16 },
      { x: 260, y: 420, r: 12 },
      { x: 440, y: 180, r: 20 },
      { x: 620, y: 360, r: 14 },
      { x: 710, y: 110, r: 18 },
      { x: 180, y: 510, r: 15 },
      { x: 550, y: 490, r: 22 },
    ];
    for (const d of dropletCoords) {
      droplets.push(`
        <g transform="translate(${d.x}, ${d.y})">
          <ellipse rx="${d.r}" ry="${(d.r * 0.9).toFixed(1)}" fill="rgba(255, 255, 255, 0.08)" stroke="rgba(255, 255, 255, 0.32)" stroke-width="1.2" />
          <ellipse cx="${(-d.r * 0.28).toFixed(1)}" cy="${(-d.r * 0.28).toFixed(1)}" rx="${(d.r * 0.35).toFixed(1)}" ry="${(d.r * 0.24).toFixed(1)}" fill="rgba(255, 255, 255, 0.65)" />
          <ellipse cx="${(d.r * 0.25).toFixed(1)}" cy="${(d.r * 0.28).toFixed(1)}" rx="${(d.r * 0.22).toFixed(1)}" ry="${(d.r * 0.16).toFixed(1)}" fill="rgba(255, 255, 255, 0.28)" />
        </g>
      `);
    }
    extraOverlay = `
      <rect width="800" height="600" fill="rgba(18, 28, 48, 0.22)" />
      <g data-vn-lens-droplets>${droplets.join("")}</g>
    `;
  }

  const bgCls = heavy ? "vn-heavy-rain-bg" : "vn-rain-bg";
  const mgCls = heavy ? "vn-heavy-rain-mg" : "vn-rain-mg";
  const fgCls = heavy ? "vn-heavy-rain-fg" : "vn-rain-fg";

  return `
    <svg viewBox="0 0 800 600" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;" aria-hidden="true">
      ${extraOverlay}
      <g class="${bgCls}">${bgLines.join("")}</g>
      <g class="${mgCls}">${mgLines.join("")}</g>
      <g class="${fgCls}">${fgLines.join("")}</g>
    </svg>
  `.trim();
}

function generateSnowMarkup(): string {
  const bgCount = 36;
  const mgCount = 26;
  const fgCount = 16;

  const bgCircles: string[] = [];
  for (let i = 0; i < bgCount; i++) {
    const x = strat(10, i, bgCount, 15, 785);
    const y = pseudo(11, i, 0, 600);
    const r = pseudo(12, i, 1.5, 2.5);
    const delay = -pseudo(13, i, 0, 5.6);
    bgCircles.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="rgba(255, 255, 255, 0.45)" style="animation-delay: ${delay.toFixed(2)}s;" />`
    );
  }

  const mgCircles: string[] = [];
  for (let i = 0; i < mgCount; i++) {
    const x = strat(14, i, mgCount, 15, 785);
    const y = pseudo(15, i, 0, 600);
    const r = pseudo(16, i, 3.0, 4.5);
    const delay = -pseudo(17, i, 0, 4.2);
    mgCircles.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="rgba(255, 255, 255, 0.72)" style="animation-delay: ${delay.toFixed(2)}s;" />`
    );
  }

  const fgCircles: string[] = [];
  for (let i = 0; i < fgCount; i++) {
    const x = strat(18, i, fgCount, 15, 785);
    const y = pseudo(19, i, 0, 600);
    const r = pseudo(20, i, 5.0, 6.8);
    const delay = -pseudo(21, i, 0, 3.0);
    fgCircles.push(
      `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="rgba(255, 255, 255, 0.92)" style="animation-delay: ${delay.toFixed(2)}s;" />`
    );
  }

  return `
    <svg viewBox="0 0 800 600" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;" aria-hidden="true">
      <g class="vn-snow-sway-node">
        <g class="vn-snow-bg">${bgCircles.join("")}</g>
        <g class="vn-snow-mg">${mgCircles.join("")}</g>
        <g class="vn-snow-fg">${fgCircles.join("")}</g>
      </g>
    </svg>
  `.trim();
}

function generateSakuraMarkup(): string {
  const bgCount = 20;
  const mgCount = 14;
  const fgCount = 10;
  const petalPath = "M 0,-7 C 3,-7 7,-3 7,0 C 7,4 3,8 0,9 C -3,8 -7,4 -7,0 C -7,-3 -3,-7 0,-7 Z";

  const renderPetals = (count: number, seedBase: number, scale: number, opacity: number, maxDelay: number) => {
    const petals: string[] = [];
    for (let i = 0; i < count; i++) {
      const x = strat(seedBase, i, count, 20, 780);
      const y = pseudo(seedBase + 1, i, 0, 600);
      const rot = pseudo(seedBase + 2, i, -45, 45);
      const delay = -pseudo(seedBase + 3, i, 0, maxDelay);
      petals.push(
        `<g transform="translate(${x.toFixed(1)}, ${y.toFixed(1)}) scale(${scale}) rotate(${rot.toFixed(1)})">
          <g class="vn-petal" style="animation-delay: ${delay.toFixed(2)}s;">
            <path d="${petalPath}" fill="#ffb7c5" opacity="${opacity}" />
          </g>
        </g>`
      );
    }
    return petals.join("");
  };

  return `
    <svg viewBox="0 0 800 600" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;" aria-hidden="true">
      <g class="vn-sakura-sway-node">
        <g class="vn-sakura-bg">${renderPetals(bgCount, 30, 0.6, 0.55, 6.2)}</g>
        <g class="vn-sakura-mg">${renderPetals(mgCount, 35, 0.9, 0.78, 4.8)}</g>
        <g class="vn-sakura-fg">${renderPetals(fgCount, 40, 1.25, 0.95, 3.6)}</g>
      </g>
    </svg>
  `.trim();
}

function generateFirefliesMarkup(): string {
  const count = 16;
  const flies: string[] = [];

  for (let i = 0; i < count; i++) {
    const x = strat(50, i, count, 40, 760);
    const y = pseudo(51, i, 40, 560);
    const r = pseudo(52, i, 2.5, 4.5);
    const delay = -pseudo(53, i, 0, 4.0);
    const duration = pseudo(54, i, 3.2, 4.6);

    flies.push(`
      <g class="vn-firefly-node" style="animation-delay: ${delay.toFixed(2)}s; animation-duration: ${duration.toFixed(2)}s;">
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 2.5).toFixed(1)}" fill="rgba(212, 255, 51, 0.2)" />
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(1)}" fill="#eaff59" />
      </g>
    `);
  }

  return `
    <svg viewBox="0 0 800 600" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;" aria-hidden="true">
      ${flies.join("")}
    </svg>
  `.trim();
}

function generateEmbersMarkup(): string {
  const count = 32;
  const sparks: string[] = [];
  const colors = ["#ff4500", "#ff7700", "#ffaa00", "#ffd700"];

  for (let i = 0; i < count; i++) {
    const x = strat(60, i, count, 20, 780);
    const r = pseudo(61, i, 2.4, 4.8);
    const color = colors[i % colors.length]!;
    const delay = -pseudo(62, i, 0, 3.2);
    const duration = pseudo(63, i, 2.8, 3.8);

    sparks.push(`
      <g class="vn-ember-node" style="animation-delay: ${delay.toFixed(2)}s; animation-duration: ${duration.toFixed(2)}s;">
        <circle cx="${x.toFixed(1)}" cy="0" r="${(r * 2.4).toFixed(1)}" fill="${color}" opacity="0.18" />
        <circle cx="${x.toFixed(1)}" cy="0" r="${r.toFixed(1)}" fill="${color}" opacity="0.9" />
      </g>
    `);
  }

  return `
    <svg viewBox="0 0 800 600" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;" aria-hidden="true">
      ${sparks.join("")}
    </svg>
  `.trim();
}

function generateFogMarkup(): string {
  return `
    <svg viewBox="0 0 800 600" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;" aria-hidden="true">
      <defs>
        <radialGradient id="vn-fog-g1" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="rgba(235, 242, 250, 0.72)" />
          <stop offset="60%" stop-color="rgba(235, 242, 250, 0.42)" />
          <stop offset="100%" stop-color="rgba(235, 242, 250, 0)" />
        </radialGradient>
        <radialGradient id="vn-fog-g2" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="rgba(220, 232, 245, 0.6)" />
          <stop offset="70%" stop-color="rgba(220, 232, 245, 0.32)" />
          <stop offset="100%" stop-color="rgba(220, 232, 245, 0)" />
        </radialGradient>
      </defs>
      <rect width="800" height="600" fill="rgba(226, 236, 246, 0.16)" />
      <g class="vn-fog-layer-1">
        <ellipse cx="280" cy="200" rx="460" ry="170" fill="url(#vn-fog-g1)" />
        <ellipse cx="660" cy="440" rx="420" ry="150" fill="url(#vn-fog-g2)" />
      </g>
      <g class="vn-fog-layer-2">
        <ellipse cx="560" cy="270" rx="480" ry="180" fill="url(#vn-fog-g2)" />
        <ellipse cx="180" cy="470" rx="430" ry="160" fill="url(#vn-fog-g1)" />
      </g>
      <g class="vn-fog-layer-3">
        <ellipse cx="400" cy="560" rx="520" ry="150" fill="url(#vn-fog-g1)" />
      </g>
    </svg>
  `.trim();
}

function generateSpeedLinesMarkup(): string {
  const count = 32;
  const lines: string[] = [];
  const cx = 400;
  const cy = 300;
  const innerRadius = 170;
  const outerRadius = 520;

  for (let i = 0; i < count; i++) {
    const angle = (i * 360) / count + pseudo(70, i, -3, 3);
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const x1 = cx + innerRadius * cos;
    const y1 = cy + innerRadius * sin;
    const x2 = cx + outerRadius * cos;
    const y2 = cy + outerRadius * sin;
    const width = pseudo(71, i, 2.0, 5.5);

    lines.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="rgba(255, 255, 255, 0.92)" stroke-width="${width.toFixed(1)}" stroke-linecap="round" />`
    );
  }

  return `
    <svg viewBox="0 0 800 600" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;" aria-hidden="true">
      <g>${lines.join("")}</g>
    </svg>
  `.trim();
}

function generateSparkleBurstMarkup(): string {
  const count = 16;
  const sparkles: string[] = [];
  const starPath = "M 0,-14 Q 0,0 14,0 Q 0,0 0,14 Q 0,0 -14,0 Q 0,0 0,-14 Z";
  const colors = ["#ffd700", "#ffffff", "#7df9ff", "#ffb6c1"];

  for (let i = 0; i < count; i++) {
    const angle = (i * 360) / count + pseudo(80, i, -8, 8);
    const dist = pseudo(81, i, 80, 220);
    const rad = (angle * Math.PI) / 180;
    const x = 400 + dist * Math.cos(rad);
    const y = 300 + dist * Math.sin(rad);
    const scale = pseudo(82, i, 0.6, 1.25);
    const color = colors[i % colors.length]!;

    sparkles.push(`
      <g transform="translate(${x.toFixed(1)}, ${y.toFixed(1)}) scale(${scale.toFixed(2)})">
        <path d="${starPath}" fill="${color}" />
      </g>
    `);
  }

  return `
    <svg viewBox="0 0 800 600" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;" aria-hidden="true">
      <g>${sparkles.join("")}</g>
    </svg>
  `.trim();
}

function generateHeartsBurstMarkup(): string {
  const count = 12;
  const hearts: string[] = [];
  const heartPath = "M 0,-4 A 4 4 0 0 0 -8 -4 Q -8 3 0 9 Q 8 3 8 -4 A 4 4 0 0 0 0 -4 Z";
  const colors = ["#ff3366", "#ff6b81", "#ff9ff3", "#e056fd"];

  for (let i = 0; i < count; i++) {
    const x = 400 + strat(90, i, count, -220, 220);
    const y = 300 + pseudo(91, i, -140, 60);
    const scale = pseudo(92, i, 0.9, 1.8);
    const rot = pseudo(93, i, -25, 25);
    const color = colors[i % colors.length]!;

    hearts.push(`
      <g transform="translate(${x.toFixed(1)}, ${y.toFixed(1)}) scale(${scale.toFixed(2)}) rotate(${rot.toFixed(1)})">
        <path d="${heartPath}" fill="${color}" />
      </g>
    `);
  }

  return `
    <svg viewBox="0 0 800 600" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;" aria-hidden="true">
      <g>${hearts.join("")}</g>
    </svg>
  `.trim();
}

function generateConfettiMarkup(): string {
  const count = 28;
  const pieces: string[] = [];
  const colors = ["#ff4757", "#2ed573", "#ffa502", "#1e90ff", "#9b59b6", "#eccc68"];

  for (let i = 0; i < count; i++) {
    const x = strat(100, i, count, 40, 760);
    const y = pseudo(101, i, 20, 250);
    const color = colors[i % colors.length]!;
    const rot = pseudo(102, i, -45, 45);

    if (i % 3 === 0) {
      pieces.push(`
        <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="6" fill="${color}" />
      `);
    } else {
      pieces.push(`
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="10" height="16" rx="2" fill="${color}" transform="rotate(${rot.toFixed(1)}, ${x.toFixed(1)}, ${y.toFixed(1)})" />
      `);
    }
  }

  return `
    <svg viewBox="0 0 800 600" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;" aria-hidden="true">
      <g>${pieces.join("")}</g>
    </svg>
  `.trim();
}
