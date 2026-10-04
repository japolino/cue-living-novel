# Jev sprite-classifier evaluation

Calibrates `SPRITE_THRESHOLDS` and `KEY_MOMENT_THRESHOLDS`
(`src/backend/runtime/system-one-sprites.ts`, `sprites/key-moments.ts`)
against live System One (Jev). Not part of `bun run test`.

- `types.ts`: dataset types and the label semantics.
- `dataset/`: the labeled replies (`part-*.ts`) and the known plates.
  Labels are human judgement, never Jev output.
- `build.ts`: reply -> TurnPlan (planner shape) -> staging context ->
  deterministic staging -> `spriteClassifierInput` -> `buildSpriteRequests`
  (the exact request bodies Cue sends). Key-moment questions are asked for
  every paragraph (production asks only paragraphs with a paintable cue).
- `run.ts`: sends the bodies to Jev (<= 4 concurrent, backoff on 429/529/5xx)
  and caches raw answers by body hash in `.cache/jev-eval/answers/`
  (`--repeat=N` re-sends the first N replies into `answers-repeat/` for the
  determinism check; `--dry` prints request counts and bytes). Without a key it
  prints `skip` and exits 0.
- `evaluate.ts`: reads the cache (no key, no network), builds per-decision
  records, sweeps thresholds on a 0.05 grid by the utility in its header,
  and compares deterministic staging, the old thresholds and the best ones,
  per question and end to end (the real `stageParagraphs`). Writes
  `.cache/jev-eval/results/<label>.{json,md}`.
- `validate.ts`: static checks of the dataset.
- `inspect.ts`: lists cached answers against labels (`emote`, `motion`, `standing`) for error analysis.

Key: env `CUE_JEV_KEY`, or a file named by `CUE_JEV_KEY_FILE`, or
`~/.cue-secrets/jev.key`. It is never printed or written.

```
bun run scripts/jev-eval/validate.ts
bun run scripts/jev-eval/run.ts --dry
bun run scripts/jev-eval/run.ts
bun run scripts/jev-eval/run.ts --repeat=4
bun run scripts/jev-eval/evaluate.ts --label=final --pool   # --pool adds the repeat pass
bun x tsc -p scripts/jev-eval/tsconfig.json   # typecheck the harness
```

Request bodies change when the question wording changes, so a new wording
gets new cache entries; old answers stay cached under their own hash.
