import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  VnStage,
  isAmbientEffect,
  isStageEffect,
  TEXT_SHAKE_HEURISTIC_REGEX,
  type StageEffect,
} from "./vn-stage";
import type { VnTurnInput } from "../store";

describe("stage effects heuristics & schemas", () => {
  test("isStageEffect validates only recognized stage effects", () => {
    expect(isStageEffect("shake")).toBe(true);
    expect(isStageEffect("flash_white")).toBe(true);
    expect(isStageEffect("flash_red")).toBe(true);
    expect(isStageEffect("zoom_in")).toBe(true);
    expect(isStageEffect("fade_to_black")).toBe(true);

    expect(isStageEffect("spin")).toBe(false);
    expect(isStageEffect("")).toBe(false);
    expect(isStageEffect(null)).toBe(false);
    expect(isStageEffect(undefined)).toBe(false);
  });

  test("TEXT_SHAKE_HEURISTIC_REGEX matches all impacts and shocks", () => {
    const hits = [
      "*thud*",
      "*THUD*",
      "*slam*",
      "*SLAM!*",
      "*crash*",
      "*CRASH*",
      "*smack*",
      "*shake*",
      "Suddenly, there was a *thud* against the window.",
      "The heavy oak door slammed shut with a violent *slam*!",
      "*Crash!* Glass scattered everywhere.",
    ];

    for (const text of hits) {
      expect(TEXT_SHAKE_HEURISTIC_REGEX.test(text)).toBe(true);
    }
  });

  test("TEXT_SHAKE_HEURISTIC_REGEX rejects non-impact narrative words", () => {
    const misses = [
      "He had a thudding headache.",
      "The car crashed into the barrier.",
      "They shook hands warmly.",
      "He took a sip of tea.",
      "Normal visual novel dialogue line.",
    ];

    for (const text of misses) {
      expect(TEXT_SHAKE_HEURISTIC_REGEX.test(text)).toBe(false);
    }
  });
});

// Minimal Mock DOM for full VnStage integration tests
class MockNode {
  tagName: string;
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  classList = {
    _classes: new Set<string>(),
    add: (...names: string[]) => names.forEach((n) => this.classList._classes.add(n)),
    remove: (...names: string[]) => names.forEach((n) => this.classList._classes.delete(n)),
    contains: (name: string) => this.classList._classes.has(name),
  };
  children: MockNode[] = [];
  get childNodes(): MockNode[] { return this.children; }
  parentNode: MockNode | null = null;
  get parentElement(): MockNode | null { return this.parentNode; }
  textContent = "";
  _innerHTML = "";
  hidden = false;
  disabled = false;
  offsetWidth = 100;
  style: Record<string, string> = {};
  get src(): string { return this.getAttribute("src") ?? ""; }
  set src(val: string) { if (val) this.setAttribute("src", val); else this.removeAttribute("src"); }
  get alt(): string { return this.getAttribute("alt") ?? ""; }
  set alt(val: string) { this.setAttribute("alt", val); }
  type = "";
  value = "";

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get innerHTML(): string {
    return this._innerHTML;
  }
  set innerHTML(val: string) {
    this._innerHTML = val;
    this.children = [];
    if (val.includes("data-vn-root")) {
      buildStandardStageDOM(this);
    }
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
    if (name.startsWith("data-vn-")) {
      const camel = name.slice(8).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset["vn" + camel.charAt(0).toUpperCase() + camel.slice(1)] = value;
    } else if (name.startsWith("data-")) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      this.dataset[camel] = value;
    }
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
    if (name.startsWith("data-vn-")) {
      const camel = name.slice(8).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      delete this.dataset["vn" + camel.charAt(0).toUpperCase() + camel.slice(1)];
    }
  }

  append(...nodes: (MockNode | string)[]) {
    for (const node of nodes) {
      if (typeof node === "string") {
        const textNode = new MockNode("#text");
        textNode.textContent = node;
        this.appendChild(textNode);
      } else {
        this.appendChild(node);
      }
    }
  }

  appendChild(node: MockNode) {
    node.remove();
    node.parentNode = this;
    this.children.push(node);
    return node;
  }

  prepend(...nodes: MockNode[]) {
    for (const node of [...nodes].reverse()) {
      node.remove();
      node.parentNode = this;
      this.children.unshift(node);
    }
  }

  remove() {
    if (this.parentNode) {
      const idx = this.parentNode.children.indexOf(this);
      if (idx !== -1) this.parentNode.children.splice(idx, 1);
      this.parentNode = null;
    }
  }

  replaceChildren(...nodes: MockNode[]) {
    this.children = [];
    for (const n of nodes) this.appendChild(n);
  }

  addEventListener() {}
  removeEventListener() {}
  focus() {}

  attachShadow() {
    const s = new MockNode("#shadow-root");
    this.appendChild(s);
    return s as any;
  }

  querySelector(selector: string): any {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): any[] {
    const list: MockNode[] = [];
    const walk = (node: MockNode) => {
      if (matches(node, selector)) list.push(node);
      for (const child of node.children) walk(child);
    };
    for (const child of this.children) walk(child);
    return list;
  }
}

function matches(node: MockNode, sel: string): boolean {
  if (sel.includes("][")) {
    const parts = sel.split("][");
    return parts.every((p, i) => {
      let sub = p;
      if (i === 0) sub = p + "]";
      else if (i === parts.length - 1) sub = "[" + p;
      else sub = "[" + p + "]";
      return matches(node, sub);
    });
  }
  if (sel.startsWith(".")) {
    return node.classList.contains(sel.slice(1));
  }
  if (sel.startsWith("[")) {
    const attrExp = sel.slice(1, -1);
    if (attrExp.includes("=")) {
      const eq = attrExp.indexOf("=");
      const key = attrExp.slice(0, eq).trim();
      const val = attrExp.slice(eq + 1).replace(/^['"]|['"]$/g, "").trim();
      return node.getAttribute(key) === val;
    }
    return node.attributes.has(attrExp.trim());
  }
  return node.tagName.toLowerCase() === sel.toLowerCase();
}

function buildStandardStageDOM(parent: MockNode) {
  const root = new MockNode("main");
  root.setAttribute("data-vn-root", "");

  const scene = new MockNode("div");
  scene.setAttribute("data-vn-scene", "");

  const imgActive = new MockNode("img");
  imgActive.setAttribute("data-vn-scene-image", "");
  imgActive.setAttribute("data-vn-layer", "active");
  imgActive.setAttribute("data-vn-empty", "true");

  const imgIncoming = new MockNode("img");
  imgIncoming.setAttribute("data-vn-scene-image", "");
  imgIncoming.setAttribute("data-vn-layer", "incoming");
  imgIncoming.setAttribute("data-vn-empty", "true");

  const scrim = new MockNode("div");
  scrim.setAttribute("data-vn-scrim", "");

  const ambient = new MockNode("div");
  ambient.setAttribute("data-vn-ambient", "");

  scene.append(imgActive, imgIncoming, ambient, scrim);

  const fx = new MockNode("div");
  fx.setAttribute("data-vn-fx", "");

  const flash = new MockNode("div");
  flash.setAttribute("data-vn-flash", "");

  const status = new MockNode("div");
  status.setAttribute("data-vn-status-stack", "");

  const empty = new MockNode("div");
  empty.setAttribute("data-vn-empty-state", "");

  const narrative = new MockNode("section");
  narrative.setAttribute("data-vn-narrative", "");

  const dialogue = new MockNode("div");
  dialogue.setAttribute("data-vn-dialogue", "");

  const controls = new MockNode("nav");
  controls.setAttribute("data-vn-controls", "");
  const logBtn = new MockNode("button");
  logBtn.setAttribute("data-vn-control", "log");
  const autoBtn = new MockNode("button");
  autoBtn.setAttribute("data-vn-control", "auto");
    const skipBtn = new MockNode("button");
    skipBtn.setAttribute("data-vn-control", "skip");
    const previousBtn = new MockNode("button");
    previousBtn.setAttribute("data-vn-control", "previous");
    controls.append(previousBtn, logBtn, autoBtn, skipBtn);

  const speaker = new MockNode("span");
  speaker.setAttribute("data-vn-speaker", "");

  const text = new MockNode("p");
  text.setAttribute("data-vn-dialogue-text", "");

  const progress = new MockNode("span");
  progress.setAttribute("data-vn-progress", "");

  const cont = new MockNode("button");
  cont.setAttribute("data-vn-continue", "");

  dialogue.append(controls, speaker, text, progress, cont);
  narrative.append(dialogue);

  const interaction = new MockNode("section");
  interaction.setAttribute("data-vn-interaction", "");
  const choiceList = new MockNode("ol");
  choiceList.setAttribute("data-vn-choice-list", "");
  const inputForm = new MockNode("form");
  inputForm.setAttribute("data-vn-input-form", "");
  const input = new MockNode("textarea");
  input.setAttribute("data-vn-input", "");
  const submit = new MockNode("button");
  submit.setAttribute("data-vn-submit", "");
  inputForm.append(input, submit);
  interaction.append(choiceList, inputForm);

  const backlog = new MockNode("div");
  backlog.setAttribute("data-vn-backlog", "");
  const backlogClose = new MockNode("button");
  backlogClose.setAttribute("data-vn-backlog-close", "");
  const backlogContent = new MockNode("div");
  backlogContent.setAttribute("data-vn-backlog-content", "");
  backlog.append(backlogClose, backlogContent);

  root.append(scene, fx, flash, status, empty, narrative, interaction, backlog);
  parent.append(root);
}

describe("VnStage visual effects & transitions", () => {
  let originalDocument: any;
  let mount: any;

  beforeEach(() => {
    originalDocument = (globalThis as any).document;
    (globalThis as any).document = {
      createElement: (tag: string) => new MockNode(tag),
      createElementNS: (_ns: string, tag: string) => new MockNode(tag),
    };
    mount = new MockNode("div");
  });

  afterEach(() => {
    (globalThis as any).document = originalDocument;
  });

  test("VnStage initializes with active and incoming image layers and flash overlay", () => {
    const stage = new VnStage({ mount });
    expect(stage.getActiveSceneImage()).toBeDefined();
    expect(stage.getIncomingSceneImage()).toBeDefined();
    expect(stage.getFlashOverlay()).toBeDefined();
    expect(stage.getActiveSceneImage().getAttribute("data-vn-layer")).toBe("active");
    expect(stage.getIncomingSceneImage().getAttribute("data-vn-layer")).toBe("incoming");
  });

  test("triggerEffect('shake') applies shake class and attribute then clears after 300ms", async () => {
    const stage = new VnStage({ mount });
    const root = (stage as any).root as unknown as MockNode;

    stage.triggerEffect("shake");
    expect(root.classList.contains("vn-shake")).toBe(true);
    expect(root.dataset.vnShake).toBe("true");

    await new Promise((r) => setTimeout(r, 350));
    expect(root.classList.contains("vn-shake")).toBe(false);
    expect(root.dataset.vnShake).toBeUndefined();
  });

  test("triggerEffect('flash_white') and triggerEffect('flash_red') flash overlay", async () => {
    const stage = new VnStage({ mount });
    const flash = stage.getFlashOverlay() as unknown as MockNode;

    stage.triggerEffect("flash_white");
    expect(flash.classList.contains("vn-flash-white")).toBe(true);
    expect(flash.dataset.vnFlash).toBe("white");

    await new Promise((r) => setTimeout(r, 550));
    expect(flash.classList.contains("vn-flash-white")).toBe(false);
    expect(flash.dataset.vnFlash).toBeUndefined();

    stage.triggerEffect("flash_red");
    expect(flash.classList.contains("vn-flash-red")).toBe(true);
    expect(flash.dataset.vnFlash).toBe("red");

    await new Promise((r) => setTimeout(r, 550));
    expect(flash.classList.contains("vn-flash-red")).toBe(false);
  });

  test("triggerEffect('fade_to_black') triggers blackout overlay", async () => {
    const stage = new VnStage({ mount });
    const flash = stage.getFlashOverlay() as unknown as MockNode;

    stage.triggerEffect("fade_to_black");
    expect(flash.classList.contains("vn-fade-to-black")).toBe(true);
    expect(flash.dataset.vnFlash).toBe("fade_to_black");

    await new Promise((r) => setTimeout(r, 1050));
    expect(flash.classList.contains("vn-fade-to-black")).toBe(false);
  });

  test("triggerEffect('zoom_in') applies zoom-in transform class to scene images", () => {
    const stage = new VnStage({ mount });
    const activeImg = stage.getActiveSceneImage() as unknown as MockNode;

    stage.triggerEffect("zoom_in");
    expect(activeImg.classList.contains("vn-zoom-in")).toBe(true);
    expect(activeImg.dataset.vnZoom).toBe("in");

    stage.resetZoom();
    expect(activeImg.classList.contains("vn-zoom-in")).toBe(false);
    expect(activeImg.dataset.vnZoom).toBeUndefined();
  });

  test("crossfading between scene images smoothly transitions active and incoming layers", async () => {
    const stage = new VnStage({ mount, createImage: () => ({ complete: true, naturalWidth: 100, decode: async () => {}, src: "" } as any) });

    // Initial image load sets active layer directly
    await stage.setSceneImage({ url: "https://example.com/scene1.png", requestId: "r1" });
    const active1 = stage.getActiveSceneImage() as unknown as MockNode;
    expect(active1.getAttribute("src")).toBe("https://example.com/scene1.png");
    expect(active1.dataset.vnEmpty).toBe("false");
    expect(stage.isCrossfading()).toBe(false);

    // Second image initiates crossfade on incoming layer
    await stage.setSceneImage({ url: "https://example.com/scene2.png", requestId: "r2" });
    const incoming = stage.getIncomingSceneImage() as unknown as MockNode;
    expect(incoming.getAttribute("src")).toBe("https://example.com/scene2.png");
    expect(incoming.dataset.vnEmpty).toBe("false");
    expect(stage.isCrossfading()).toBe(true);

    // After crossfade duration completes (350ms), incoming becomes active
    await new Promise((r) => setTimeout(r, 400));
    expect(stage.isCrossfading()).toBe(false);
    const newActive = stage.getActiveSceneImage() as unknown as MockNode;
    expect(newActive.getAttribute("src")).toBe("https://example.com/scene2.png");
    expect(newActive.getAttribute("data-vn-layer")).toBe("active");
  });

  test("paragraph rendering triggers explicit cue metadata effect", () => {
    const stage = new VnStage({ mount });
    const flash = stage.getFlashOverlay() as unknown as MockNode;

    const turn: VnTurnInput = {
      mode: "standard",
      paragraphs: [
        {
          id: "p1",
          text: "A lightning strike lit up the dark sky.",
          effect: "flash_white",
        },
      ],
    };

    stage.loadTurn(turn);
    expect(flash.classList.contains("vn-flash-white")).toBe(true);
  });

  test("paragraph rendering triggers text heuristic shake on impacts", () => {
    const stage = new VnStage({ mount });
    const root = (stage as any).root as unknown as MockNode;

    const turn: VnTurnInput = {
      mode: "standard",
      paragraphs: [
        {
          id: "p1",
          text: "With a violent *CRASH*, the vase shattered.",
        },
      ],
    };

    stage.loadTurn(turn);
    expect(root.classList.contains("vn-shake")).toBe(true);
  });

    test("renderDialogueContent does not restart rendering when state or progress updates occur", () => {
    const stage = new VnStage({ mount });
    const turn: VnTurnInput = {
      mode: "standard",
      paragraphs: [{ id: "p1", text: "Hello world paragraph." }],
    };
    stage.loadTurn(turn);
    const dialogueEl = (stage as any).dialogueText as MockNode;
    expect(dialogueEl.innerHTML).toBe("Hello world paragraph.");

    // Simulate typing in progress by altering innerHTML
    dialogueEl.innerHTML = "Hel";

    // Trigger an asset progress update (which invokes render())
    stage.setAssetProgress({ current: 1, total: 3 });

    // With the fix, because paragraph.id and formatted text did not change,
    // renderDialogueContent should NOT overwrite dialogueEl.innerHTML back to start or formatted!
    expect(dialogueEl.innerHTML).toBe("Hel");
  });

  test("continue button pops out with data-vn-ready='true' only after text is finished typing", () => {
    const stage = new VnStage({ mount });
    const turn: VnTurnInput = {
      mode: "standard",
      paragraphs: [{ id: "p1", text: "Hello world paragraph." }],
    };
    stage.loadTurn(turn);
    const contBtn = (stage as any).continueButton as MockNode;

    // After loading with instant text (or completed typing), button is ready
    expect(contBtn.dataset.vnReady).toBe("true");

    // While typing is simulated as active
    (stage as any).isTyping = true;
    (stage as any).updateContinueButton();
    expect(contBtn.dataset.vnReady).toBe("false");

    // When typing completes, button is marked ready
    (stage as any).completeTypewriter();
    expect(contBtn.dataset.vnReady).toBe("true");
  });
});


describe("extended stage effects & ambient overlays", () => {
  let originalDocument: any;
  let mount: any;

  beforeEach(() => {
    originalDocument = (globalThis as any).document;
    (globalThis as any).document = {
      createElement: (tag: string) => new MockNode(tag),
      createElementNS: (_ns: string, tag: string) => new MockNode(tag),
    };
    mount = new MockNode("div");
  });

  afterEach(() => {
    (globalThis as any).document = originalDocument;
  });

  test("isStageEffect accepts every extended effect id", () => {
    const ids: StageEffect[] = [
      "shake", "flash_white", "flash_red", "zoom_in", "fade_to_black",
      "shake_hard", "rumble", "zoom_punch", "speed_lines", "fade_from_black",
      "fade_to_white", "lightning", "zoom_out", "tilt", "heartbeat",
      "blur_pulse", "sparkle_burst", "hearts_burst", "confetti",
    ];
    for (const id of ids) expect(isStageEffect(id)).toBe(true);
    expect(isStageEffect("explode")).toBe(false);
  });

  test("isAmbientEffect accepts exactly the ambient catalogue", () => {
    const ids = [
      "rain", "heavy_rain", "snow", "sakura", "fog", "fireflies", "embers",
      "vignette_dark", "sepia_flashback", "desaturate", "dream_haze", "danger_pulse",
    ];
    for (const id of ids) expect(isAmbientEffect(id)).toBe(true);
    expect(isAmbientEffect("shake")).toBe(false);
    expect(isAmbientEffect(null)).toBe(false);
    expect(isAmbientEffect("")).toBe(false);
  });

  test("shake_hard and rumble apply and clear their classes", async () => {
    const stage = new VnStage({ mount });
    const root = (stage as any).root as unknown as MockNode;
    stage.triggerEffect("shake_hard");
    expect(root.classList.contains("vn-shake-hard")).toBe(true);
    expect(root.dataset.vnShake).toBe("hard");
    await new Promise((r) => setTimeout(r, 560));
    expect(root.classList.contains("vn-shake-hard")).toBe(false);
    stage.triggerEffect("rumble");
    expect(root.classList.contains("vn-rumble")).toBe(true);
    expect(root.dataset.vnShake).toBe("rumble");
    await new Promise((r) => setTimeout(r, 860));
    expect(root.classList.contains("vn-rumble")).toBe(false);
  });

  test("zoom_out persists until reset; zoom_punch and tilt are timed", async () => {
    const stage = new VnStage({ mount });
    const scene = (stage as any).scene as unknown as MockNode;
    stage.triggerEffect("zoom_out");
    expect(scene.dataset.vnZoom).toBe("out");
    stage.resetZoom();
    expect(scene.dataset.vnZoom).toBeUndefined();

    stage.triggerEffect("zoom_punch");
    expect(scene.dataset.vnZoom).toBe("punch");
    expect(scene.classList.contains("vn-zoom-punch")).toBe(true);
    await new Promise((r) => setTimeout(r, 510));
    expect(scene.classList.contains("vn-zoom-punch")).toBe(false);

    stage.triggerEffect("tilt");
    expect(scene.dataset.vnTilt).toBe("true");
    await new Promise((r) => setTimeout(r, 760));
    expect(scene.dataset.vnTilt).toBeUndefined();
  });

  test("flash presets fade_from_black / fade_to_white / lightning drive the flash overlay", async () => {
    const stage = new VnStage({ mount });
    const flash = stage.getFlashOverlay() as unknown as MockNode;
    stage.triggerEffect("fade_from_black");
    expect(flash.dataset.vnFlash).toBe("fade_from_black");
    stage.triggerEffect("lightning");
    expect(flash.dataset.vnFlash).toBe("lightning");
    await new Promise((r) => setTimeout(r, 610));
    expect(flash.dataset.vnFlash).toBeUndefined();
  });

  test("particle bursts mount procedural SVG into the fx overlay and clear after their duration", async () => {
    const stage = new VnStage({ mount });
    const fx = stage.getFxOverlay() as unknown as MockNode;
    stage.triggerEffect("sparkle_burst");
    expect(fx.dataset.vnEffect).toBe("sparkle_burst");
    expect(fx.innerHTML).toContain("<svg");
    await new Promise((r) => setTimeout(r, 910));
    expect(fx.dataset.vnEffect).toBeUndefined();
    expect(fx.innerHTML).toBe("");

    stage.triggerEffect("confetti");
    expect(fx.dataset.vnEffect).toBe("confetti");
    expect(fx.innerHTML).toContain("<svg");
  });

  test("applyAmbient mounts weather markup, persists across paragraph advance, and clears on reset", () => {
    const stage = new VnStage({ mount });
    const scene = (stage as any).scene as unknown as MockNode;
    const overlay = stage.getAmbientOverlay() as unknown as MockNode;

    stage.loadTurn({ mode: "standard", paragraphs: [{ id: "p-rain", text: "Rain hammers the roof." }], choices: [], ambient: "rain" } as VnTurnInput);
    expect(stage.getCurrentAmbient()).toBe("rain");
    expect(scene.dataset.vnSceneAmbient).toBe("rain");
    expect(overlay.dataset.vnAmbient).toBe("rain");
    expect(overlay.innerHTML).toContain("vn-rain-bg");

    // Ambient survives loading a turn that does not mention ambient.
    stage.loadTurn({ mode: "standard", paragraphs: [{ id: "p0", text: "Hello." }], choices: [] } as VnTurnInput);
    expect(stage.getCurrentAmbient()).toBe("rain");

    // A turn with ambient: null explicitly clears it.
    stage.loadTurn({ mode: "standard", paragraphs: [{ id: "p1", text: "Later." }], choices: [], ambient: null } as VnTurnInput);
    expect(stage.getCurrentAmbient()).toBe(null);
    expect(overlay.innerHTML).toBe("");
    expect(scene.dataset.vnSceneAmbient).toBeUndefined();
  });

  test("heavy_rain markup carries the wet-lens droplets; mood grades mount without SVG", () => {
    const stage = new VnStage({ mount });
    const overlay = stage.getAmbientOverlay() as unknown as MockNode;
    stage.applyAmbient("heavy_rain");
    expect(overlay.innerHTML).toContain("data-vn-lens-droplets");
    stage.applyAmbient("vignette_dark");
    expect(overlay.dataset.vnAmbient).toBe("vignette_dark");
    expect(overlay.innerHTML).toBe("");
    stage.applyAmbient(null);
    expect(overlay.dataset.vnAmbient).toBeUndefined();
  });

  test("reset clears ambient state entirely", () => {
    const stage = new VnStage({ mount });
    stage.applyAmbient("snow");
    expect(stage.getCurrentAmbient()).toBe("snow");
    stage.reset();
    expect(stage.getCurrentAmbient()).toBe(null);
  });
});
