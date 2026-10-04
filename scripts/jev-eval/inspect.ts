
import { buildCase } from "./build.js";
import { ANSWERS_DIR, bodyHash, readCached } from "./common.js";
import { REPLIES } from "./dataset/index.js";
const mode = process.argv[2] ?? "emote";
for (const reply of REPLIES) {
  const kase = buildCase(reply);
  for (const batch of kase.batches) {
    const answers: any = readCached(ANSWERS_DIR, bodyHash(batch.body))?.response?.answers ?? {};
    for (const [q, info] of batch.meta) {
      const a = answers[q];
      if (!a) continue;
      const truth = kase.labels[(info as any).paragraph ?? 0];
      if (mode === "emote" && info.kind === "emote" && a.choice !== "none") {
        const name = kase.names.get(info.key)!;
        const c = truth?.chars.get(name);
        if (!c) continue;
        console.log(`${c.emSet.has(a.choice) ? "OK " : "BAD"} ${a.choice} ${a.confidence.toFixed(2)} truth=${[...c.emSet]} | ${reply.id} p${info.paragraph} ${name}: ${reply.paragraphs[info.paragraph]!.text.slice(0, 110)}`);
      }
      if (mode === "standing" && info.kind === "standing") {
        console.log(`${(a.noul >= 0.5) === truth!.km.standing ? "OK " : "BAD"} yes=${a.noul.toFixed(2)} truth=${truth!.km.standing} lvl=${truth!.km.level} | ${reply.id} p${info.paragraph}: ${reply.paragraphs[info.paragraph]!.text.slice(0, 110)}`);
      }
      if (mode === "motion" && info.kind === "motion" && a.choice !== "none") {
        const name = kase.names.get(info.key)!;
        const c = truth?.chars.get(name);
        if (!c) continue;
        console.log(`${c.mSet.has(a.choice) ? "OK " : "BAD"} ${a.choice} ${a.confidence.toFixed(2)} truth=${[...c.mSet]} | ${reply.id} p${info.paragraph} ${name}: ${reply.paragraphs[info.paragraph]!.text.slice(0, 110)}`);
      }
    }
  }
}
