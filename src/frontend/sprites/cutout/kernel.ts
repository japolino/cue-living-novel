/**
 * DOM-free sprite cut-out kernel (port of the bake-off reference `hybrid2`,
 * cue-sprite-bakeoff/run2.py + run4.py, building blocks in cut.py).
 *
 * Everything lives inside ONE self-contained factory function so the same
 * code can run on the main thread, in unit tests, and inside a Worker created
 * from a blob URL (`String(createCutoutKernel)` is shipped to the worker).
 * Rules for this file: no imports used inside the factory, no references to
 * module-level values, only JS built-ins.
 *
 * Images are RGBA `Uint8ClampedArray` (row-major, 4 bytes per pixel); the
 * segmentation mask is a `Float32Array` of 0..1 per pixel. Connectivity is
 * 4-neighbour everywhere (scipy.ndimage defaults).
 */

export type CutoutBBox = [number, number, number, number];

export type CutoutPixelsResult = {
  /** Cut-out RGBA (straight alpha). */
  rgba: Uint8ClampedArray;
  /** Alpha 0..1 before 8-bit quantization. */
  alpha: Float32Array;
  /** Opaque bounding box, normalized 0..1: [x, y, width, height]. */
  bbox: CutoutBBox;
  /** Background colour (median of the background part of the 4-px image border). */
  background: [number, number, number];
  /** Duplicate check on the cut-out alpha (see `figureCheck`). */
  figures: CutoutFigureCheck;
};

/**
 * "Two figures side by side" check on the cut-out mask (alpha > 127). In
 * the rows from 10% to 60% of the height, a row is "split" when it holds at
 * least two opaque runs as wide as 25% of the image; the image is flagged
 * when at least 40% of those rows are split. October 2026 ComfyUI set (394
 * sprites, 102 with extra figures): precision 0.95, false-positive rate 1%,
 * recall 0.55 (it finds figures standing apart, not overlapping groups or
 * grids).
 */
export type CutoutFigureCheck = {
  twoFigures: boolean;
  /** Share of the checked rows that are split (0..1). */
  splitShare: number;
};

export type CutoutModelInput = {
  /** 1x3xSxS CHW float tensor data, RGB / 255, zero padded. */
  tensor: Float32Array;
  size: number;
  /** Where the resized image sits inside the square input. */
  box: { x: number; y: number; width: number; height: number };
};

export type CutoutKernel = {
  readonly params: {
    seed: number; grow: number; guard: number; holeMask: number; holeArea: number;
    speckMask: number; band: number; dFull: number; bboxAlpha: number;
    bgMask: number; lightMin: number; lightSpread: number; bgMinPixels: number; bgMinShare: number;
    splitAlpha: number; splitTop: number; splitBottom: number; splitRun: number; splitShare: number;
  };
  backgroundColor(rgba: Uint8ClampedArray, width: number, height: number, mask?: Float32Array | null): [number, number, number];
  colorDistance(rgba: Uint8ClampedArray, width: number, height: number, bg: [number, number, number]): Float32Array;
  floodBackground(distance: Float32Array, width: number, height: number): Uint8Array;
  cutoutPixels(rgba: Uint8ClampedArray, width: number, height: number, mask: Float32Array | null): CutoutPixelsResult;
  opaqueBBox(rgba: Uint8ClampedArray, width: number, height: number): CutoutBBox;
  /** Duplicate check on straight-alpha RGBA (alpha > 127 is opaque). */
  figureCheck(rgba: Uint8ClampedArray, width: number, height: number): CutoutFigureCheck;
  /** PIL-style separable bilinear resize (antialiased when shrinking) of interleaved float channels. */
  resizeBilinear(src: Float32Array, sw: number, sh: number, channels: number, dw: number, dh: number): Float32Array;
  modelInput(rgba: Uint8ClampedArray, width: number, height: number, size: number): CutoutModelInput;
  /** Model output (SxS, 0..1) -> mask at the image size (crop padding, resize, 8-bit steps like the reference). */
  modelMask(output: Float32Array, input: CutoutModelInput, width: number, height: number): Float32Array;
};

export function createCutoutKernel(): CutoutKernel {
  const params = {
    /** Flood seeds: border pixels closer than this to the background colour (max-channel distance). */
    seed: 14,
    /** Flood growth: pixels closer than this to the background colour. */
    grow: 34,
    /** Mask guard: flood pixels the model calls foreground above this stay foreground. */
    guard: 0.7,
    /** Enclosed near-background components with mean mask below this (and area above holeArea) become background. */
    holeMask: 0.5,
    holeArea: 30,
    /** Separate foreground components with mean mask below this are dropped (brush specks). */
    speckMask: 0.3,
    /** Edge band (L1 px) where alpha comes from the colour distance. */
    band: 3,
    /** Colour distance that counts as fully opaque in the edge band. */
    dFull: 70,
    /** Alpha (0..255) that counts as opaque for the bounding box. */
    bboxAlpha: 64,
    /** Background colour: border pixels the model scores below this are background. */
    bgMask: 0.3,
    /** Without a model: "light" border pixels have every channel at least this ... */
    lightMin: 160,
    /** ... and at most this spread between channels (near-neutral). */
    lightSpread: 30,
    /** A border subset is used only with at least this many pixels and this share of the border. */
    bgMinPixels: 64,
    bgMinShare: 0.02,
    /** Duplicate check: alpha (0..255) above this is opaque ... */
    splitAlpha: 127,
    /** ... rows from this share of the height (inclusive) ... */
    splitTop: 0.1,
    /** ... to this share (exclusive) are checked; a "wide" run is at least this share of the width ... */
    splitBottom: 0.6,
    splitRun: 0.25,
    /** ... and the image has two figures when at least this share of the rows has two wide runs. */
    splitShare: 0.4,
  };

  function medianFromHistogram(hist: Uint32Array, count: number): number {
    const pick = (rank: number): number => {
      let seen = 0;
      for (let v = 0; v < 256; v++) {
        seen += hist[v]!;
        if (seen > rank) return v;
      }
      return 255;
    };
    if (count === 0) return 255;
    if (count % 2 === 1) return pick((count - 1) / 2);
    return (pick(count / 2 - 1) + pick(count / 2)) / 2;
  }

  /**
   * Background colour from the 4-px border strips (rows and columns; corners
   * count twice, like the reference). A sprite that fills the frame touches the
   * border with hair, tails or legs, so the plain median can be the
   * character's colour. Pick, in order:
   *   1. with a mask: border pixels the model calls background;
   *   2. without one: light, near-neutral border pixels (the prompt asks for
   *      a white or grey background);
   *   3. all border pixels (the original rule).
   * Each subset is used only when it holds enough pixels.
   */
  function backgroundColor(rgba: Uint8ClampedArray, width: number, height: number, mask: Float32Array | null = null): [number, number, number] {
    const all = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    const byMask = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    const light = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    let count = 0, maskCount = 0, lightCount = 0;
    const add = (x: number, y: number): void => {
      const i = y * width + x;
      const o = i * 4;
      const r = rgba[o]!, g = rgba[o + 1]!, b = rgba[o + 2]!;
      all[0]![r]!++; all[1]![g]!++; all[2]![b]!++;
      count++;
      if (mask && mask[i]! < params.bgMask) {
        byMask[0]![r]!++; byMask[1]![g]!++; byMask[2]![b]!++;
        maskCount++;
      }
      const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
      if (lo >= params.lightMin && hi - lo <= params.lightSpread) {
        light[0]![r]!++; light[1]![g]!++; light[2]![b]!++;
        lightCount++;
      }
    };
    const rows = Math.min(4, height), cols = Math.min(4, width);
    for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) add(x, y);
    for (let y = height - rows; y < height; y++) for (let x = 0; x < width; x++) add(x, y);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < cols; x++) add(x, y);
      for (let x = width - cols; x < width; x++) add(x, y);
    }
    const enough = Math.max(params.bgMinPixels, Math.round(count * params.bgMinShare));
    const hist = mask && maskCount >= enough ? byMask : !mask && lightCount >= enough ? light : all;
    const used = hist === byMask ? maskCount : hist === light ? lightCount : count;
    return [medianFromHistogram(hist[0]!, used), medianFromHistogram(hist[1]!, used), medianFromHistogram(hist[2]!, used)];
  }

  function colorDistance(rgba: Uint8ClampedArray, width: number, height: number, bg: [number, number, number]): Float32Array {
    const n = width * height;
    const out = new Float32Array(n);
    const [br, bgc, bb] = bg;
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const dr = Math.abs(rgba[o]! - br), dg = Math.abs(rgba[o + 1]! - bgc), db = Math.abs(rgba[o + 2]! - bb);
      out[i] = dr > dg ? (dr > db ? dr : db) : (dg > db ? dg : db);
    }
    return out;
  }

  /** Border flood fill: components of (d < grow) that contain a 1-px-border seed with d < seed. */
  function floodBackground(distance: Float32Array, width: number, height: number): Uint8Array {
    const n = width * height;
    const bg = new Uint8Array(n);
    const queue = new Int32Array(n);
    let tail = 0;
    const seedAt = (i: number): void => {
      if (bg[i] === 0 && distance[i]! < params.seed) { bg[i] = 1; queue[tail++] = i; }
    };
    for (let x = 0; x < width; x++) { seedAt(x); seedAt((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { seedAt(y * width); seedAt(y * width + width - 1); }
    const grow = params.grow;
    for (let head = 0; head < tail; head++) {
      const i = queue[head]!;
      const x = i % width;
      if (x > 0 && bg[i - 1] === 0 && distance[i - 1]! < grow) { bg[i - 1] = 1; queue[tail++] = i - 1; }
      if (x < width - 1 && bg[i + 1] === 0 && distance[i + 1]! < grow) { bg[i + 1] = 1; queue[tail++] = i + 1; }
      if (i >= width && bg[i - width] === 0 && distance[i - width]! < grow) { bg[i - width] = 1; queue[tail++] = i - width; }
      if (i < n - width && bg[i + width] === 0 && distance[i + width]! < grow) { bg[i + width] = 1; queue[tail++] = i + width; }
    }
    return bg;
  }

  /**
   * Visit the 4-connected components of `include` (non-zero). For each one the
   * callback gets the pixel indices in queue[0..count) and returns nothing.
   */
  function forEachComponent(include: Uint8Array, width: number, height: number, visit: (queue: Int32Array, count: number) => void): void {
    const n = width * height;
    const seen = new Uint8Array(n);
    const queue = new Int32Array(n);
    for (let start = 0; start < n; start++) {
      if (include[start] === 0 || seen[start] === 1) continue;
      seen[start] = 1;
      queue[0] = start;
      let tail = 1;
      for (let head = 0; head < tail; head++) {
        const i = queue[head]!;
        const x = i % width;
        if (x > 0 && include[i - 1] !== 0 && seen[i - 1] === 0) { seen[i - 1] = 1; queue[tail++] = i - 1; }
        if (x < width - 1 && include[i + 1] !== 0 && seen[i + 1] === 0) { seen[i + 1] = 1; queue[tail++] = i + 1; }
        if (i >= width && include[i - width] !== 0 && seen[i - width] === 0) { seen[i - width] = 1; queue[tail++] = i - width; }
        if (i < n - width && include[i + width] !== 0 && seen[i + width] === 0) { seen[i + width] = 1; queue[tail++] = i + width; }
      }
      visit(queue, tail);
    }
    void height;
  }

  /** L1 (4-neighbour) distance to the nearest pixel where `set` equals `value`, capped at 255. */
  function l1Distance(set: Uint8Array, value: number, width: number, height: number): Uint8Array {
    const n = width * height;
    const dist = new Uint8Array(n);
    for (let i = 0; i < n; i++) dist[i] = set[i] === value ? 0 : 255;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const i = row + x;
        let d = dist[i]!;
        if (d === 0) continue;
        if (x > 0 && dist[i - 1]! + 1 < d) d = dist[i - 1]! + 1;
        if (y > 0 && dist[i - width]! + 1 < d) d = dist[i - width]! + 1;
        dist[i] = d;
      }
    }
    for (let y = height - 1; y >= 0; y--) {
      const row = y * width;
      for (let x = width - 1; x >= 0; x--) {
        const i = row + x;
        let d = dist[i]!;
        if (d === 0) continue;
        if (x < width - 1 && dist[i + 1]! + 1 < d) d = dist[i + 1]! + 1;
        if (y < height - 1 && dist[i + width]! + 1 < d) d = dist[i + width]! + 1;
        dist[i] = d;
      }
    }
    return dist;
  }

  function opaqueBBoxFromAlpha(alpha8: (i: number) => number, width: number, height: number): CutoutBBox {
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (alpha8(row + x) >= params.bboxAlpha) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          maxY = y;
        }
      }
    }
    if (maxX < 0) return [0, 0, 0, 0];
    return [minX / width, minY / height, (maxX - minX + 1) / width, (maxY - minY + 1) / height];
  }

  function opaqueBBox(rgba: Uint8ClampedArray, width: number, height: number): CutoutBBox {
    return opaqueBBoxFromAlpha((i) => rgba[i * 4 + 3]!, width, height);
  }

  function figureCheck(rgba: Uint8ClampedArray, width: number, height: number): CutoutFigureCheck {
    const minRun = params.splitRun * width;
    let rows = 0, split = 0;
    for (let y = 0; y < height; y++) {
      if (y < params.splitTop * height || y >= params.splitBottom * height) continue;
      rows++;
      let wide = 0, run = 0;
      for (let x = 0, o = y * width * 4 + 3; x <= width; x++, o += 4) {
        if (x < width && rgba[o]! > params.splitAlpha) { run++; continue; }
        if (run >= minRun) wide++;
        run = 0;
      }
      if (wide >= 2) split++;
    }
    const splitShare = rows ? split / rows : 0;
    return { twoFigures: rows > 0 && splitShare >= params.splitShare, splitShare };
  }

  function cutoutPixels(rgba: Uint8ClampedArray, width: number, height: number, mask: Float32Array | null): CutoutPixelsResult {
    const n = width * height;
    if (rgba.length < n * 4) throw new Error("cutoutPixels: pixel buffer is too small");
    if (mask && mask.length < n) throw new Error("cutoutPixels: mask is too small");
    const bg = backgroundColor(rgba, width, height, mask);
    const distance = colorDistance(rgba, width, height, bg);
    const bgmask = floodBackground(distance, width, height);

    if (mask) {
      // Leak guard: flood pixels the model is sure about stay foreground.
      for (let i = 0; i < n; i++) if (bgmask[i] === 1 && mask[i]! > params.guard) bgmask[i] = 0;
      // Enclosed holes: near-background components the model calls background.
      const near = new Uint8Array(n);
      for (let i = 0; i < n; i++) near[i] = distance[i]! < params.grow && bgmask[i] === 0 ? 1 : 0;
      forEachComponent(near, width, height, (queue, count) => {
        if (count <= params.holeArea) return;
        let sum = 0;
        for (let k = 0; k < count; k++) sum += mask[queue[k]!]!;
        if (sum / count < params.holeMask) for (let k = 0; k < count; k++) bgmask[queue[k]!] = 1;
      });
    }

    // Matte + defringe in the edge band (L1 distance <= band from both sides).
    const toBg = l1Distance(bgmask, 1, width, height);
    const toFg = l1Distance(bgmask, 0, width, height);
    const alpha = new Float32Array(n);
    const out = new Uint8ClampedArray(n * 4);
    const [br, bgc, bb] = bg;
    const band = params.band, dFull = params.dFull;
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const r = rgba[o]!, g = rgba[o + 1]!, b = rgba[o + 2]!;
      if (toBg[i]! <= band && toFg[i]! <= band) {
        let a = distance[i]! / dFull;
        if (a > 1) a = 1;
        alpha[i] = a;
        if (a > 0.02) {
          const k = 1 - a;
          let fr = (r - k * br) / a, fg = (g - k * bgc) / a, fb = (b - k * bb) / a;
          fr = fr < 0 ? 0 : fr > 255 ? 255 : fr;
          fg = fg < 0 ? 0 : fg > 255 ? 255 : fg;
          fb = fb < 0 ? 0 : fb > 255 ? 255 : fb;
          out[o] = Math.floor(fr); out[o + 1] = Math.floor(fg); out[o + 2] = Math.floor(fb);
        } else {
          out[o] = r; out[o + 1] = g; out[o + 2] = b;
        }
      } else {
        alpha[i] = bgmask[i] === 1 ? 0 : 1;
        out[o] = r; out[o + 1] = g; out[o + 2] = b;
      }
    }

    if (mask) {
      // Specks: separate foreground components the model calls background,
      // plus their 1-px soft edge where the model agrees.
      const fg = new Uint8Array(n);
      for (let i = 0; i < n; i++) fg[i] = alpha[i]! > 0.02 ? 1 : 0;
      const kill = new Uint8Array(n);
      let anyKill = false;
      forEachComponent(fg, width, height, (queue, count) => {
        let sum = 0;
        for (let k = 0; k < count; k++) sum += mask[queue[k]!]!;
        if (sum / count < params.speckMask) {
          anyKill = true;
          for (let k = 0; k < count; k++) kill[queue[k]!] = 1;
        }
      });
      if (anyKill) {
        for (let i = 0; i < n; i++) {
          if (mask[i]! >= params.speckMask) continue;
          const x = i % width;
          if (kill[i] === 1 || (x > 0 && kill[i - 1] === 1) || (x < width - 1 && kill[i + 1] === 1)
            || (i >= width && kill[i - width] === 1) || (i < n - width && kill[i + width] === 1)) alpha[i] = 0;
        }
      }
    }

    for (let i = 0, o = 3; i < n; i++, o += 4) {
      const a = alpha[i]! * 255;
      out[o] = a <= 0 ? 0 : a >= 255 ? 255 : Math.floor(a);
    }
    const bbox = opaqueBBoxFromAlpha((i) => out[i * 4 + 3]!, width, height);
    return { rgba: out, alpha, bbox, background: bg, figures: figureCheck(out, width, height) };
  }

  /** PIL ImagingResample bilinear coefficients for one axis. */
  function coefficients(inSize: number, outSize: number): { start: Int32Array; taps: Int32Array; weights: Float32Array; width: number } {
    const scale = inSize / outSize;
    const filterScale = scale > 1 ? scale : 1;
    const support = filterScale; // bilinear support 1.0
    const kmax = Math.ceil(support) * 2 + 1;
    const start = new Int32Array(outSize), taps = new Int32Array(outSize);
    const weights = new Float32Array(outSize * kmax);
    for (let xx = 0; xx < outSize; xx++) {
      const center = (xx + 0.5) * scale;
      let xmin = Math.trunc(center - support + 0.5);
      if (xmin < 0) xmin = 0;
      let xmax = Math.trunc(center + support + 0.5);
      if (xmax > inSize) xmax = inSize;
      const count = Math.min(xmax - xmin, kmax);
      let total = 0;
      for (let x = 0; x < count; x++) {
        const t = Math.abs((x + xmin - center + 0.5) / filterScale);
        const w = t < 1 ? 1 - t : 0;
        weights[xx * kmax + x] = w;
        total += w;
      }
      if (total > 0) for (let x = 0; x < count; x++) weights[xx * kmax + x]! /= total;
      start[xx] = xmin;
      taps[xx] = count;
    }
    return { start, taps, weights, width: kmax };
  }

  function resizeBilinear(src: Float32Array, sw: number, sh: number, channels: number, dw: number, dh: number): Float32Array {
    // Horizontal pass: sh x dw
    const cx = coefficients(sw, dw);
    const tmp = new Float32Array(sh * dw * channels);
    for (let y = 0; y < sh; y++) {
      const srcRow = y * sw * channels, dstRow = y * dw * channels;
      for (let x = 0; x < dw; x++) {
        const s = cx.start[x]!, t = cx.taps[x]!, wo = x * cx.width;
        for (let c = 0; c < channels; c++) {
          let acc = 0;
          for (let k = 0; k < t; k++) acc += src[srcRow + (s + k) * channels + c]! * cx.weights[wo + k]!;
          tmp[dstRow + x * channels + c] = acc;
        }
      }
    }
    // Vertical pass: dh x dw
    const cy = coefficients(sh, dh);
    const out = new Float32Array(dh * dw * channels);
    const rowLen = dw * channels;
    for (let y = 0; y < dh; y++) {
      const s = cy.start[y]!, t = cy.taps[y]!, wo = y * cy.width, dstRow = y * rowLen;
      for (let k = 0; k < t; k++) {
        const w = cy.weights[wo + k]!;
        const srcRow = (s + k) * rowLen;
        for (let j = 0; j < rowLen; j++) out[dstRow + j]! += tmp[srcRow + j]! * w;
      }
    }
    return out;
  }

  function modelInput(rgba: Uint8ClampedArray, width: number, height: number, size: number): CutoutModelInput {
    const h = height > width ? size : Math.trunc(size * height / width);
    const w = height > width ? Math.trunc(size * width / height) : size;
    const x0 = Math.floor((size - w) / 2), y0 = Math.floor((size - h) / 2);
    const n = width * height;
    const rgb = new Float32Array(n * 3);
    for (let i = 0, o = 0, p = 0; i < n; i++, o += 4, p += 3) { rgb[p] = rgba[o]!; rgb[p + 1] = rgba[o + 1]!; rgb[p + 2] = rgba[o + 2]!; }
    const small = w === width && h === height ? rgb : resizeBilinear(rgb, width, height, 3, w, h);
    const plane = size * size;
    const tensor = new Float32Array(plane * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 3;
        const t = (y + y0) * size + x + x0;
        // 8-bit steps like the reference (PIL resizes uint8 images).
        tensor[t] = Math.min(255, Math.max(0, Math.round(small[p]!))) / 255;
        tensor[plane + t] = Math.min(255, Math.max(0, Math.round(small[p + 1]!))) / 255;
        tensor[2 * plane + t] = Math.min(255, Math.max(0, Math.round(small[p + 2]!))) / 255;
      }
    }
    return { tensor, size, box: { x: x0, y: y0, width: w, height: h } };
  }

  function modelMask(output: Float32Array, input: CutoutModelInput, width: number, height: number): Float32Array {
    const { size, box } = input;
    const crop = new Float32Array(box.width * box.height);
    for (let y = 0; y < box.height; y++) {
      for (let x = 0; x < box.width; x++) {
        const v = output[(y + box.y) * size + x + box.x]!;
        crop[y * box.width + x] = Math.floor((v < 0 ? 0 : v > 1 ? 1 : v) * 255);
      }
    }
    const full = box.width === width && box.height === height ? crop : resizeBilinear(crop, box.width, box.height, 1, width, height);
    const mask = new Float32Array(width * height);
    for (let i = 0; i < mask.length; i++) mask[i] = Math.min(255, Math.max(0, Math.round(full[i]!))) / 255;
    return mask;
  }

  return { params, backgroundColor, colorDistance, floodBackground, cutoutPixels, opaqueBBox, figureCheck, resizeBilinear, modelInput, modelMask };
}
