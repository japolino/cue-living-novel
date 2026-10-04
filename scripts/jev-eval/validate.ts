/**
 * Static checks for the labeled dataset. Run: bun run scripts/jev-eval/validate.ts
 */
import { EMOTES, EXPRESSIONS, INTERACTIONS, LIGHTS, MOTIONS, type EvalReply } from "./types.js";
import { PLATES } from "./dataset/plates.js";
import { REPLIES } from "./dataset/index.js";

const errors: string[] = [];
const expressionIds = new Set<string>(EXPRESSIONS);
const motionIds = new Set<string>(MOTIONS);
const emoteIds = new Set<string>(EMOTES);
const lightIds = new Set<string>(LIGHTS);
const interactionIds = new Set<string>(INTERACTIONS);
const plateIds = new Set(PLATES.map((plate) => plate.id));

function check(reply: EvalReply): number {
  const at = (where: string, message: string) => errors.push(`${reply.id} ${where}: ${message}`);
  const castNames = new Set(reply.cast.map((member) => member.name));
  if (castNames.has(reply.persona)) at("cast", "the persona must not be a cast member");
  if (!reply.scenes.length || reply.scenes[0]!.start !== 0) at("scenes", "first scene must start at 0");
  for (const [index, scene] of reply.scenes.entries()) {
    if (index && scene.start <= reply.scenes[index - 1]!.start) at(`s${index}`, "scene starts must increase");
    if (scene.start >= reply.paragraphs.length) at(`s${index}`, "scene starts after the last paragraph");
    if (!lightIds.has(scene.light)) at(`s${index}`, `bad light ${scene.light}`);
    for (const light of scene.lightOk ?? []) if (!lightIds.has(light)) at(`s${index}`, `bad lightOk ${light}`);
    if (scene.plate !== null && !plateIds.has(scene.plate)) at(`s${index}`, `unknown plate ${scene.plate}`);
    if (scene.character && !castNames.has(scene.character)) at(`s${index}`, `scene character ${scene.character} not in cast`);
    for (const name of scene.cast) if (!castNames.has(name)) at(`s${index}`, `scene cast ${name} not in cast`);
  }
  let defining = 0;
  const seen = new Map<string, number>();
  let sceneIndex = 0;
  for (const [index, paragraph] of reply.paragraphs.entries()) {
    const where = `p${index}`;
    while (sceneIndex + 1 < reply.scenes.length && reply.scenes[sceneIndex + 1]!.start <= index) {
      sceneIndex += 1;
      seen.clear();
    }
    if (!paragraph.text.trim()) at(where, "empty text");
    for (const name of paragraph.present) if (!castNames.has(name)) at(where, `present ${name} not in cast`);
    for (const [name, label] of Object.entries(paragraph.chars ?? {})) {
      if (!paragraph.present.includes(name)) at(where, `labels for ${name}, who is not present`);
      for (const id of [label.e, ...(label.eo ?? [])]) if (!expressionIds.has(id)) at(where, `bad expression ${id}`);
      for (const id of [label.m ?? "none", ...(label.mo ?? [])]) if (!motionIds.has(id)) at(where, `bad motion ${id}`);
      for (const id of [label.em ?? "none", ...(label.emo ?? [])]) if (!emoteIds.has(id)) at(where, `bad emote ${id}`);
      if (label.i !== undefined && (label.i < 1 || label.i > 5)) at(where, "intensity out of range");
    }
    for (const name of paragraph.present) {
      if (!seen.has(name) && !paragraph.chars?.[name]) at(where, `${name} first present in this scene without labels`);
      seen.set(name, index);
    }
    if (paragraph.cue && !castNames.has(paragraph.cue.character)) at(where, `cue character ${paragraph.cue.character} not in cast`);
    for (const name of paragraph.leaves ?? []) if (!castNames.has(name)) at(where, `leaves ${name} not in cast`);
    if (paragraph.km) {
      if (!interactionIds.has(paragraph.km.interaction)) at(where, `bad interaction ${paragraph.km.interaction}`);
      for (const id of paragraph.km.interactionOk ?? []) if (!interactionIds.has(id)) at(where, `bad interactionOk ${id}`);
      if (paragraph.km.level === 4) defining += 1;
    }
  }
  if (defining > 1) at("km", "more than one defining (level 4) moment");
  return reply.paragraphs.length;
}

const ids = new Set<string>();
let paragraphs = 0;
for (const reply of REPLIES) {
  if (ids.has(reply.id)) errors.push(`duplicate id ${reply.id}`);
  ids.add(reply.id);
  paragraphs += check(reply);
}
const revisits = REPLIES.flatMap((reply) => reply.scenes).filter((scene) => scene.plate !== null).length;
console.log(`replies=${REPLIES.length} paragraphs=${paragraphs} scenes=${REPLIES.reduce((n, r) => n + r.scenes.length, 0)} revisits=${revisits}`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("dataset OK");
