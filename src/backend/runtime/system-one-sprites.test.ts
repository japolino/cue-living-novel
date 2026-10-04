import assert from "node:assert/strict";
import test from "node:test";
import type { SpindleAPI } from "lumiverse-spindle-types";
import { POSE_EXPRESSION_CATALOGUE } from "../../shared/character.js";
import { SPRITE_HOT_SET, SPRITE_INTERACTIONS, plateKeyFor, type SpritePlateRef } from "../../shared/sprites.js";
import { assertStagingInvariants, makePlan, stagingInput } from "./__fixtures__/sprite-staging-plans.js";
import { buildSpriteStaging, deterministicSpriteStaging, type SpriteStagingInput } from "./sprite-staging.js";
import {
  MAX_CLASSIFIED_PARAGRAPHS,
  SPRITE_EXPRESSION_GUIDE,
  SPRITE_REQUEST_BYTE_LIMIT,
  SPRITE_THRESHOLDS,
} from "./system-one-sprites.js";

type Question = { type: "noul" | "choice" | "score"; instructions: string; criteria?: unknown };
type Body = { model: string; state: Record<string, any>; questions: Record<string, Question> };
type Answers = Record<string, unknown>;

/** Low-confidence default answers: the first option at 0.3, noul 0.5, score 0.2 confidence. */
function lowAnswers(body: Body): Answers {
  return Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
    if (question.type === "noul") return [key, { type: "noul", noul: 0.5 }];
    if (question.type === "score") return [key, { type: "score", score: 2, legend: {}, probabilities: {}, confidence: 0.2 }];
    const first = Object.keys(question.criteria as Record<string, unknown>)[0]!;
    return [key, { type: "choice", choice: first, confidence: 0.3, probabilities: { [first]: 0.3 } }];
  }));
}

const choice = (value: string, confidence: number) => ({ type: "choice", choice: value, confidence, probabilities: { [value]: confidence } });
const noul = (value: number) => ({ type: "noul", noul: value });
const score = (value: number, confidence: number) => ({ type: "score", score: value, legend: {}, probabilities: {}, confidence });

type Mock = { spindle: SpindleAPI; bodies: Body[]; logs: string[]; maxInFlight: () => number };

function mockSpindle(answer: (body: Body, call: number) => Answers | Promise<Answers> | { status: number; body: string }, options: { key?: string | null } = {}): Mock {
  const bodies: Body[] = [];
  const logs: string[] = [];
  let inFlight = 0;
  let max = 0;
  const spindle = {
    enclave: { get: async () => (options.key === undefined ? "test-secret" : options.key) },
    cors: async (url: string, request: { method: string; headers: Record<string, string>; body: string }) => {
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      assert.equal(request.method, "POST");
      assert.equal(request.headers.Authorization, "Bearer test-secret");
      assert.ok(new TextEncoder().encode(request.body).length <= SPRITE_REQUEST_BYTE_LIMIT, "body within the byte budget");
      const body = JSON.parse(request.body) as Body;
      bodies.push(body);
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      const result = await answer(body, bodies.length - 1);
      if (result && typeof (result as { status?: unknown }).status === "number" && typeof (result as { body?: unknown }).body === "string") return result;
      return { status: 200, body: JSON.stringify({ model: "jev-1.13.0", answers: result, usage: { input_tokens: 300, output_tokens: 20 } }) };
    },
    log: { warn: (line: string) => logs.push(line), info: (line: string) => logs.push(line) },
  } as unknown as SpindleAPI;
  return { spindle, bodies, logs, maxInFlight: () => max };
}

const on = { systemOneMode: "on" as const };

/** Mira (scene subject) and Kai talking in the library. */
function duoPlan(paragraphs = ["\"Hi,\" Mira says.", "\"Hey,\" Kai says.", "Mira looks at Kai.", "\"Well?\" Kai asks."]) {
  return makePlan({ paragraphs, speakers: paragraphs.map((_, index) => (index % 2 ? "Kai" : "Mira")) });
}

/** The question key for a paragraph, character (named in the instructions) and kind. */
const keyFor = (body: Body, paragraph: number, name: string, suffix: string) => {
  return Object.keys(body.questions).find((key) => key.startsWith(`p${paragraph}_`) && key.endsWith(`_${suffix}`) && body.questions[key]!.instructions.includes(name));
};

function withAnswers(overrides: (body: Body, set: (paragraph: number, name: string, suffix: string, value: unknown) => void) => void) {
  return (body: Body): Answers => {
    const answers = lowAnswers(body);
    overrides(body, (paragraph, name, suffix, value) => {
      const key = keyFor(body, paragraph, name, suffix);
      if (key) answers[key] = value;
    });
    return answers;
  };
}

test("System One off or no saved key: deterministic staging, no request", async () => {
  const plan = duoPlan();
  const expected = deterministicSpriteStaging(stagingInput(plan));
  const off = mockSpindle(() => { throw new Error("must not call"); });
  assert.deepEqual(await buildSpriteStaging(off.spindle, stagingInput(plan)), expected);
  const noKey = mockSpindle(() => { throw new Error("must not call"); }, { key: null });
  assert.deepEqual(await buildSpriteStaging(noKey.spindle, stagingInput(plan, { config: on })), expected);
  assert.equal(off.bodies.length + noKey.bodies.length, 0);
});

test("question design: safe default first, closed catalogues, typed questions per candidate", async () => {
  const plan = duoPlan();
  const knownPlates: SpritePlateRef[] = [{ plateKey: "plate_known", location: "Old town library", timeOfDay: "evening", weather: null, description: "Tall shelves" }];
  const mock = mockSpindle((body) => lowAnswers(body));
  const staging = await buildSpriteStaging(mock.spindle, stagingInput(plan, { config: on, knownPlates }));
  assertStagingInvariants(staging, 4);
  assert.equal(mock.bodies.length, 1);
  const body = mock.bodies[0]!;
  assert.equal(body.model, "jev-latest");
  assert.deepEqual(Object.keys(body.state.paragraphs), ["p0", "p1", "p2", "p3"]);
  const questions = body.questions;
  // p0: Mira speaks (4 questions, no presence question); Kai is not a candidate yet.
  assert.deepEqual(Object.keys(questions).filter((key) => key.startsWith("p0_")).map((key) => key.replace(/^p0_c\d+_/, "")), ["expression", "motion", "emote", "intensity"]);
  // p1: Kai speaks (4) and Mira is on stage (5, with presence).
  assert.equal(Object.keys(questions).filter((key) => key.startsWith("p1_")).length, 9);
  for (const [key, question] of Object.entries(questions)) {
    assert.ok(["noul", "choice", "score"].includes(question.type), key);
    if (question.type === "choice") {
      const options = Object.keys(question.criteria as Record<string, unknown>);
      assert.ok(options.length >= 2 && options.length <= 255, `${key}: 2-255 options`);
      if (key.endsWith("_expression")) {
        assert.equal(options[0], "keep_current");
        assert.deepEqual(options.slice(1, 13), [...SPRITE_HOT_SET], "hot set right after keep_current");
        for (const option of options.slice(1)) assert.ok(POSE_EXPRESSION_CATALOGUE.some((entry) => entry.id === option), option);
      }
      if (key.endsWith("_motion") || key.endsWith("_emote")) assert.equal(options[0], "none");
      if (key.endsWith("_place")) assert.deepEqual(options, ["new_place", "place_1"]);
      if (key.endsWith("_light")) assert.equal(options[0], "indoor_warm", "the deterministic light first");
    }
    if (question.type === "score") assert.equal((question.criteria as string[]).length, 5);
  }
  assert.ok(questions.s0_light && questions.s0_place);
  for (const id of Object.keys(SPRITE_EXPRESSION_GUIDE)) assert.ok(body.state.expressions[id], id);
  // All answers were low confidence: identical to deterministic, but made by the classifier.
  const expected = deterministicSpriteStaging(stagingInput(plan, { knownPlates }));
  assert.equal(staging.source, "classifier");
  assert.deepEqual(staging.paragraphs, expected.paragraphs);
  assert.ok(mock.logs.some((line) => line.includes("Sprite staging classifier requests=1")));
});

test("batching: ≤7 paragraphs per request, all requests in parallel, every paragraph covered past 24", async () => {
  const paragraphs = Array.from({ length: 30 }, (_, index) => `"Line ${index}," Mira says.`);
  const plan = makePlan({ paragraphs, speakers: paragraphs.map(() => "Mira") });
  const mock = mockSpindle((body) => lowAnswers(body));
  await buildSpriteStaging(mock.spindle, stagingInput(plan, { config: on }));
  assert.equal(mock.bodies.length, 5);
  assert.equal(mock.maxInFlight(), 5, "requests run in parallel");
  const covered = new Set<number>();
  for (const body of mock.bodies) {
    const indexes = Object.keys(body.state.paragraphs).map((key) => Number(key.slice(1)));
    assert.ok(indexes.length <= 7);
    for (const index of indexes) {
      covered.add(index);
      assert.ok(body.questions[`p${index}_c0_expression`], `expression question for p${index}`);
    }
  }
  assert.equal(covered.size, 30);
  assert.ok(MAX_CLASSIFIED_PARAGRAPHS >= 100);
});

test("batching splits by bytes when paragraphs are long", async () => {
  const long = "Mira and Kai and Ren and Sora talk. ".repeat(55);
  const paragraphs = Array.from({ length: 14 }, () => long);
  const plan = makePlan({ paragraphs, speakers: paragraphs.map((_, index) => ["Mira", "Kai", "Ren", "Sora"][index % 4]!) });
  const mock = mockSpindle((body) => lowAnswers(body));
  const staging = await buildSpriteStaging(mock.spindle, stagingInput(plan, { config: on }));
  assertStagingInvariants(staging, 14);
  assert.ok(mock.bodies.length > 2, `split into ${mock.bodies.length} requests`);
  const covered = mock.bodies.flatMap((body) => Object.keys(body.state.paragraphs));
  assert.equal(new Set(covered).size, 14);
});

test("confident expressions apply; low confidence and keep_current hold; rare ones need more confidence", async () => {
  const plan = duoPlan(["\"Hi,\" Mira says.", "\"Hey,\" Kai says.", "Mira smiles at Kai.", "\"Well?\" Kai asks.", "\"Fine,\" Mira says."]);
  const mock = mockSpindle(withAnswers((_body, set) => {
    set(0, "Mira", "expression", choice("sad", 0.9));
    set(1, "Kai", "expression", choice("jealous", 0.55)); // rare, mid confidence -> hot fallback (angry)
    set(2, "Mira", "expression", choice("keep_current", 0.8)); // overrides the text keyword "smiles"
    set(3, "Kai", "expression", choice("lovestruck", 0.9)); // rare, confident -> rare
    set(4, "Mira", "expression", choice("laughing", 0.3)); // low -> deterministic/keep
  }));
  const staging = await buildSpriteStaging(mock.spindle, stagingInput(plan, { config: on }));
  assertStagingInvariants(staging, 5);
  const expr = (index: number, key: string) => staging.paragraphs[index]!.actors.find((actor) => actor.characterKey === key)?.expression;
  assert.equal(expr(0, "mira"), "sad");
  assert.equal(expr(1, "kai"), "angry");
  assert.equal(expr(2, "mira"), "sad");
  assert.equal(expr(3, "kai"), "lovestruck");
  assert.equal(expr(4, "mira"), "sad");
  assert.ok(SPRITE_THRESHOLDS.rareExpression > SPRITE_THRESHOLDS.hotExpression);
});

test("presence: confident no removes, confident yes adds, uncertain keeps", async () => {
  const plan = makePlan({
    paragraphs: ["\"Hi,\" Mira says.", "\"Bye,\" Kai says.", "Mira waves as Kai leaves. Ren watches from the door.", "Mira sits.", "Ren speaks up at last."],
    speakers: ["Mira", "Kai", "", "", "Ren"],
    cues: [{ p: 4, character: "Ren", pose: "idle", identity: "1boy, glasses" }],
  });
  const mock = mockSpindle(withAnswers((_body, set) => {
    set(2, "Kai", "present", noul(0.05));
    set(2, "Ren", "present", noul(0.92));
    set(3, "Ren", "present", noul(0.5));
  }));
  const staging = await buildSpriteStaging(mock.spindle, stagingInput(plan, { config: on }));
  assertStagingInvariants(staging, 5);
  const keys = (index: number) => staging.paragraphs[index]!.actors.map((actor) => actor.characterKey);
  assert.deepEqual(keys(1), ["mira", "kai"]);
  assert.deepEqual(keys(2), ["mira", "ren"]);
  assert.deepEqual(keys(3), ["mira", "ren"]);
  assert.deepEqual(keys(4), ["mira", "ren"]);
});

test("motion, emote and intensity overrides need confidence; none never erases a text cue", async () => {
  const plan = duoPlan(["\"Yes!\" Mira says.", "\"Okay,\" Kai says and nods.", "Mira thinks.", "Kai waits."]);
  const mock = mockSpindle(withAnswers((_body, set) => {
    set(0, "Mira", "motion", choice("hop", 0.85));
    set(0, "Mira", "emote", choice("sparkle", 0.8));
    set(0, "Mira", "intensity", score(3.6, 0.8));
    set(1, "Kai", "motion", choice("none", 0.95));
    set(2, "Mira", "motion", choice("shake", 0.4));
  }));
  const staging = await buildSpriteStaging(mock.spindle, stagingInput(plan, { config: on }));
  const actor = (index: number, key: string) => staging.paragraphs[index]!.actors.find((item) => item.characterKey === key)!;
  assert.deepEqual([actor(0, "mira").motion, actor(0, "mira").emote, actor(0, "mira").intensity], ["hop", "sparkle", 5]);
  assert.equal(actor(1, "kai").motion, "nod", "the explicit text cue stays");
  assert.equal(actor(2, "mira").motion, "none");
  assert.equal(actor(2, "mira").intensity, 3);
});

test("place reuse: a confident match reuses the known plate key, otherwise the scene's own key", async () => {
  const plan = duoPlan();
  const knownPlates: SpritePlateRef[] = [
    { plateKey: "plate_beach", location: "Beach", timeOfDay: "noon", weather: null, description: "Sand" },
    { plateKey: "plate_known", location: "Old town library", timeOfDay: "evening", weather: null, description: "Tall shelves" },
  ];
  const pick = (confidence: number) => mockSpindle((body) => {
    const answers = lowAnswers(body);
    const criteria = body.questions.s0_place!.criteria as Record<string, string>;
    const option = Object.keys(criteria).find((key) => criteria[key]!.startsWith("Old town library"))!;
    assert.equal(option, "place_1", "the closest known place is offered first");
    answers.s0_place = choice(option, confidence);
    return answers;
  });
  const reused = await buildSpriteStaging(pick(0.9).spindle, stagingInput(plan, { config: on, knownPlates }));
  assertStagingInvariants(reused, 4);
  assert.ok(reused.paragraphs.every((stage) => stage.plateKey === "plate_known"));
  assert.deepEqual(reused.plates, [knownPlates[1]]);
  const unsure = await buildSpriteStaging(pick(0.5).spindle, stagingInput(plan, { config: on, knownPlates }));
  assert.equal(unsure.paragraphs[0]!.plateKey, plateKeyFor({ location: "Library", timeOfDay: "evening" }, "style-1"));

  // The scene's own plate already exists: no place question.
  const own: SpritePlateRef = { plateKey: plateKeyFor({ location: "Library", timeOfDay: "evening" }, "style-1"), location: "Library", timeOfDay: "evening", weather: null, description: "" };
  const mock = mockSpindle((body) => lowAnswers(body));
  await buildSpriteStaging(mock.spindle, stagingInput(plan, { config: on, knownPlates: [...knownPlates, own] }));
  assert.equal(mock.bodies[0]!.questions.s0_place, undefined);
});

test("a confident light answer replaces the deterministic light for the scene", async () => {
  const plan = duoPlan();
  const mock = mockSpindle((body) => ({ ...lowAnswers(body), s0_light: choice("candle", 0.8) }));
  const staging = await buildSpriteStaging(mock.spindle, stagingInput(plan, { config: on }));
  assert.ok(staging.paragraphs.every((stage) => stage.light === "candle"));
  const unsure = mockSpindle((body) => ({ ...lowAnswers(body), s0_light: choice("candle", 0.4) }));
  assert.equal((await buildSpriteStaging(unsure.spindle, stagingInput(plan, { config: on }))).paragraphs[0]!.light, "indoor_warm");
});

test("failures fall back to deterministic staging and never throw", async () => {
  const plan = duoPlan();
  const expected = deterministicSpriteStaging(stagingInput(plan));
  const scenarios: Array<[string, Mock, Partial<SpriteStagingInput> & { classifierTimeoutMs?: number; signal?: AbortSignal }]> = [
    ["network", mockSpindle(() => { throw new Error("offline"); }), {}],
    ["http 500", mockSpindle(() => ({ status: 500, body: "oops" })), {}],
    ["rate limit", mockSpindle(() => ({ status: 429, body: "{}" })), {}],
    ["not json", mockSpindle(() => ({ status: 200, body: "<html>" })), {}],
    ["wrong shape", mockSpindle(() => ({ status: 200, body: JSON.stringify({ result: [] }) })), {}],
    ["timeout", mockSpindle(() => new Promise<Answers>(() => {})), { classifierTimeoutMs: 30 }],
    ["model missing", mockSpindle((body) => lowAnswers(body)), { config: { ...on, systemOneModel: " " } } as Partial<SpriteStagingInput>],
    ["bad url", mockSpindle((body) => lowAnswers(body)), { config: { ...on, systemOneApiUrl: "http://remote.example" } } as Partial<SpriteStagingInput>],
  ];
  for (const [name, mock, extra] of scenarios) {
    const { config, ...rest } = extra as { config?: object };
    const staging = await buildSpriteStaging(mock.spindle, { ...stagingInput(plan, { config: { ...on, ...(config ?? {}) } }), ...rest });
    assert.deepEqual(staging, expected, name);
  }
});

test("abort: an aborted signal returns deterministic staging at once", async () => {
  const plan = duoPlan();
  const expected = deterministicSpriteStaging(stagingInput(plan));
  const before = new AbortController();
  before.abort();
  const idle = mockSpindle((body) => lowAnswers(body));
  assert.deepEqual(await buildSpriteStaging(idle.spindle, { ...stagingInput(plan, { config: on }), signal: before.signal }), expected);
  assert.equal(idle.bodies.length, 0);

  const during = new AbortController();
  const hanging = mockSpindle(() => {
    setTimeout(() => during.abort(), 1);
    return new Promise<Answers>(() => {});
  });
  const started = Date.now();
  assert.deepEqual(await buildSpriteStaging(hanging.spindle, { ...stagingInput(plan, { config: on }), signal: during.signal }), expected);
  assert.ok(Date.now() - started < 2_000);
});

test("one failed request only loses its own paragraphs", async () => {
  const paragraphs = Array.from({ length: 10 }, (_, index) => `"Line ${index}," Mira says.`);
  const plan = makePlan({ paragraphs, speakers: paragraphs.map(() => "Mira") });
  const mock = mockSpindle((body) => {
    if (body.state.paragraphs.p0) throw new Error("first batch down");
    return { ...lowAnswers(body), p8_c0_expression: choice("angry", 0.9) };
  });
  const staging = await buildSpriteStaging(mock.spindle, stagingInput(plan, { config: on }));
  const expected = deterministicSpriteStaging(stagingInput(plan));
  assertStagingInvariants(staging, 10);
  assert.equal(staging.source, "classifier");
  assert.deepEqual(staging.paragraphs.slice(0, 7), expected.paragraphs.slice(0, 7));
  assert.equal(staging.paragraphs[8]!.actors[0]!.expression, "angry");
  assert.ok(mock.logs.some((line) => line.includes("failed=1")));
});

test("malformed single answers are ignored, the rest still apply", async () => {
  const plan = duoPlan();
  const mock = mockSpindle((body) => ({
    ...lowAnswers(body),
    p0_c0_expression: choice("not_an_expression", 0.99),
    p0_c0_motion: { type: "choice", choice: "hop" },
    p0_c0_emote: choice("heart", 0.9),
  }));
  const staging = await buildSpriteStaging(mock.spindle, stagingInput(plan, { config: on }));
  const mira = staging.paragraphs[0]!.actors[0]!;
  assert.deepEqual([mira.expression, mira.motion, mira.emote], ["idle", "none", "heart"]);
});

test("a rate-limited request is retried once", async () => {
  const plan = duoPlan();
  const mock = mockSpindle((body, call) => (call === 0 ? { status: 429, body: "{}" } : { ...lowAnswers(body), p0_c0_expression: choice("smug", 0.9) }));
  const staging = await buildSpriteStaging(mock.spindle, stagingInput(plan, { config: on }));
  assert.equal(mock.bodies.length, 2);
  assert.equal(staging.source, "classifier");
  assert.equal(staging.paragraphs[0]!.actors[0]!.expression, "smug");
});

/* ---- key moments (config keyIllustrations) ---- */

const few = { keyIllustrations: "few" as const, generateImages: true };

/** Mira on a date: p1 kisses (deterministic 3), p2 sits (2), p0/p3 ordinary; every paragraph has a cue. */
function datePlan() {
  const paragraphs = ["\"Hi,\" Mira says.", "Mira kisses Kai on the cheek.", "Mira sits on the bench.", "\"Shall we go?\" Mira asks."];
  return makePlan({
    paragraphs,
    speakers: ["Mira", null, null, "Mira"],
    cues: paragraphs.map((_, p) => ({ p, character: "Mira", pose: "smile", identity: "1girl, brown hair" })),
  });
}
const flags = (staging: { paragraphs: Array<{ illustrate?: boolean | undefined }> }) => staging.paragraphs.map((stage) => stage.illustrate === true);

test("key moments off: no flags and no key-moment questions", async () => {
  const plan = datePlan();
  assert.deepEqual(flags(deterministicSpriteStaging(stagingInput(plan))), [false, false, false, false]);
  const mock = mockSpindle((body) => lowAnswers(body));
  const staging = await buildSpriteStaging(mock.spindle, stagingInput(plan, { config: on }));
  assert.deepEqual(flags(staging), [false, false, false, false]);
  assert.ok(Object.keys(mock.bodies[0]!.questions).every((key) => !key.endsWith("_moment") && !key.endsWith("_standing")));
});

test("key moments few, deterministic: the strongest moment with a cue, at most one per reply", () => {
  const staging = deterministicSpriteStaging(stagingInput(datePlan(), { config: few }));
  assertStagingInvariants(staging, 4);
  assert.deepEqual(flags(staging), [false, true, false, false]);
  // Without generated images there is nothing to paint.
  assert.deepEqual(flags(deterministicSpriteStaging(stagingInput(datePlan(), { config: { ...few, generateImages: false } }))), [false, false, false, false]);
});

test("key moments few, classifier: one score and one yes/no per cue paragraph; the top confident moment wins", async () => {
  const plan = datePlan();
  const mock = mockSpindle((body) => {
    const answers = lowAnswers(body);
    answers.p2_moment = score(3, 0.8);
    answers.p2_standing = noul(0.1);
    answers.p3_moment = score(4, 0.9);
    answers.p3_standing = noul(0.2);
    answers.p0_moment = score(4, 0.3); // too uncertain to count
    return answers;
  });
  const staging = await buildSpriteStaging(mock.spindle, stagingInput(plan, { config: { ...on, ...few } }));
  assertStagingInvariants(staging, 4);
  const questions = mock.bodies[0]!.questions;
  for (const p of [0, 1, 2, 3]) {
    assert.equal(questions[`p${p}_moment`]?.type, "score");
    assert.equal((questions[`p${p}_moment`]!.criteria as string[]).length, 5);
    assert.ok((questions[`p${p}_moment`]!.criteria as string[])[0]!.startsWith("ordinary"), "the safe level first");
    assert.equal(questions[`p${p}_standing`]?.type, "noul");
  }
  assert.equal(staging.source, "classifier");
  assert.deepEqual(flags(staging), [false, false, false, true]);
});

test("key moments few, classifier: nothing important enough means no illustration; no answers fall back to the rule", async () => {
  const plan = datePlan();
  const calm = mockSpindle((body) => {
    const answers = lowAnswers(body);
    for (const p of [0, 1, 2, 3]) answers[`p${p}_moment`] = score(1, 0.9);
    answers.p1_standing = noul(0.05);
    return answers;
  });
  assert.deepEqual(flags(await buildSpriteStaging(calm.spindle, stagingInput(plan, { config: { ...on, ...few } }))), [false, false, false, false]);
  const unsure = mockSpindle((body) => lowAnswers(body));
  assert.deepEqual(flags(await buildSpriteStaging(unsure.spindle, stagingInput(plan, { config: { ...on, ...few } }))), [false, true, false, false]);
});

test("key moments: a paragraph with only a key-moment question is still classified", async () => {
  // Nobody is cast (narration, no speaker, persona-only cue): the key-moment questions alone make the request.
  const plan = makePlan({
    paragraphs: ["The storm breaks over the harbour.", "Lightning splits the mast."],
    scenes: [{ start: 0, location: "Harbour", character: null, cast: [] }],
    cues: [{ p: 1, character: "You", pose: "scared", identity: "1boy, black coat" }],
  });
  const mock = mockSpindle((body) => ({ ...lowAnswers(body), p1_moment: score(4, 0.9), p1_standing: noul(0.1) }));
  const staging = await buildSpriteStaging(mock.spindle, stagingInput(plan, { config: { ...on, ...few } }));
  const body = mock.bodies.find((candidate) => candidate.questions.p1_moment)!;
  assert.deepEqual(Object.keys(body.questions).filter((key) => key.startsWith("p1_")).sort(), ["p1_interaction", "p1_moment", "p1_standing"]);
  assert.equal(staging.paragraphs[1]!.actors.length, 0);
  assert.equal(flags(staging)[1], true);
});

test("key moments: a choice question for the interaction (none first); a confident answer sets the moment, else the text rule", async () => {
  const plan = datePlan();
  const confident = mockSpindle((body) => ({ ...lowAnswers(body), p2_moment: score(4, 0.9), p2_standing: noul(0.1), p2_interaction: choice("sitting_together", 0.8) }));
  const staging = await buildSpriteStaging(confident.spindle, stagingInput(plan, { config: { ...on, ...few } }));
  const question = confident.bodies[0]!.questions.p2_interaction!;
  assert.equal(question.type, "choice");
  const options = Object.keys(question.criteria as Record<string, unknown>);
  assert.equal(options[0], "none", "the safe default first");
  assert.deepEqual([...options].sort(), [...SPRITE_INTERACTIONS].sort());
  assert.deepEqual(flags(staging), [false, false, true, false]);
  assert.equal(staging.paragraphs[2]!.moment?.interaction, "sitting_together");
  assert.deepEqual(staging.paragraphs[2]!.moment?.characters, staging.paragraphs[2]!.actors.map((actor) => actor.characterKey).slice(0, 1));
  // Low confidence (or a confident "none"): the narration rule decides ("sits on the bench").
  for (const answer of [choice("dancing", 0.4), choice("none", 0.95)]) {
    const mock = mockSpindle((body) => ({ ...lowAnswers(body), p2_moment: score(4, 0.9), p2_standing: noul(0.1), p2_interaction: answer }));
    const result = await buildSpriteStaging(mock.spindle, stagingInput(plan, { config: { ...on, ...few } }));
    assert.equal(result.paragraphs[2]!.moment?.interaction, "sitting");
  }
});

test("key moments few, deterministic: the chosen paragraph stores its interaction and characters", () => {
  const staging = deterministicSpriteStaging(stagingInput(datePlan(), { config: few }));
  const moment = staging.paragraphs[1]!.moment!;
  assert.equal(moment.interaction, "kiss");
  // Kai is not a cast member: Mira alone, first-person kiss.
  assert.equal(moment.partner, true);
  assert.equal(moment.characters.length, 1);
  assert.ok(staging.cast.some((member) => member.characterKey === moment.characters[0]));
  assert.ok(staging.paragraphs.every((stage, index) => index === 1 || stage.moment === undefined));
});
