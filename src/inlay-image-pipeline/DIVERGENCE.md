# Inlay Image Pipeline Transplant — Divergence Report

Source: https://github.com/japolino/inlay-illustrator (branch: **staging**)
Target: `src/inlay-image-pipeline/` in cue-living-novel

## Status

The Inlay image-generation subsystem was copied **verbatim** into an isolated tree.
Every transplanted `.ts` file is byte-identical to Inlay `staging` (verified with md5
at the time of transplant). The tree is:

```
src/inlay-image-pipeline/
  backend/      # Inlay src/backend (31 prod modules + 21 tests)
  shared/       # Inlay src/shared/config.ts + config.test.ts
  tsconfig.json # own tsconfig matching Inlay's compiler strictness
src/references/ # Inlay references/ fixtures (original-module/card.json etc.)
```

## Divergences (every material difference from Inlay)

### IMPORT/PATH ONLY

| # | Item | Detail |
|---|------|--------|
| D1 | `tsconfig.json` added inside `src/inlay-image-pipeline/` | New file, not in Inlay's pipeline tree. Required because Cue's root tsconfig enables `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`, which the Inlay code does not satisfy. The pipeline gets its own config **identical in strictness to Inlay's** (`strict: true`, no `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`). This is a build isolation, not a code change. |
| D2 | Root Cue `tsconfig.json` now `exclude`s `src/inlay-image-pipeline` and `src/references` | Necessary so Cue's stricter compile does not reject the isolated Inlay code. No effect on Inlay behavior. |
| D3 | `references/` fixture relocated from Inlay repo root to `src/references/` | The pipeline test `backend/prompt.test.ts` imports `../../references/original-module/card.json`. In Inlay that resolves from repo root; in Cue's `src/inlay-image-pipeline/backend/` it resolves to `src/references/`. Fixture content byte-identical; only the tree position differs. |

### HOST API ADAPTER

| # | Item | Detail |
|---|------|--------|
| D4 | Runtime `spindle` global | Inlay and Cue both expect the Lumiverse worker to provide a global `spindle` (`declare const spindle`). No code change needed in the pipeline. Cue injects the real instance via `globalThis.spindle` in the adapter (see adapter commit). |
| D5 | `lumiverse-spindle-types` version | Inlay dev-deps `0.6.2`; Cue has `0.6.23`. The pipeline typechecks clean against Cue's `0.6.23` under its own config (`skipLibCheck`). The `ImageGenRequestDTO.includeDataUrl` augmentation in `types.ts` is already present in `0.6.23`; interface merging is compatible (verified: pipeline typechecks exit 0). |

### CUE INPUT ADAPTER / CUE OUTPUT ADAPTER / REQUIRED BEHAVIOR CHANGE

| # | Item | Detail |
|---|------|--------|
| — | None in the pipeline tree yet | These belong to the Cue-side adapter (separate commit) and will be listed there. |

## Behavior preservation notes

No parser instruction, memory semantics, prompt construction, planning behavior,
state-update timing, or generation-sequencing logic was modified. The transplanted
modules call the Lumiverse host exactly as Inlay does. Any host call that Cue does
not surface is handled in the adapter, not in the pipeline.

## Classification legend

- **IMPORT/PATH ONLY**: module/import-placement changes; no behavior change.
- **HOST API ADAPTER**: runtime interface between pipeline and Lumiverse host; no logic change.
- **CUE INPUT ADAPTER**: Cue transforms its own source/context into pipeline inputs (outside tree).
- **CUE OUTPUT ADAPTER**: Cue maps pipeline results into its presentation state (outside tree).
- **REQUIRED BEHAVIOR CHANGE**: an Inlay behavior that cannot be preserved; expected to be extremely rare. **None identified so far.**
## COMMIT 3 — Cue <-> Inlay adapter

The adapter lives OUTSIDE the transplanted tree (`src/runtime/inlay-adapter.ts`).
It is Cue glue and does not modify Inlay internals. Its divergences are
classified as:

- **CUE INPUT ADAPTER**: `buildInlayConfig` maps Cue's `VisualNovelConfig` into a
  valid Inlay `Config`, defaulting Inlay-only tuning knobs Cue has no UI for.
  It never reinterprets Inlay concepts — it supplies values Inlay already expects.
- **HOST API ADAPTER**: `namespacedSpindle` proxy prefixes Inlay's userStorage
  paths (`config.json`, `states/`, `records/`, `workflows/`) under `inlay/` so
  they cannot collide with Cue's own storage, and captures the final
  `GeneratedRecord` Inlay reports through `sendToFrontend({type:"status", record})`.
- **CUE OUTPUT ADAPTER**: `mapInlaySlotsToCue` is a pure projection from Inlay
  `GeneratedRecord` slots into the per-paragraph background list Cue presents.
- **Required behavior change**: none. The adapter reads Inlay results and feeds
  Cue inputs; it does not alter Inlay's parsing, memory, prompt, planning, or
  generation sequencing.

### Runtime `spindle` handling (HOST API ADAPTER)

Inlay modules reference the module-global `spindle`. Cue's own modules receive
`spindle` as a parameter (verified: only `src/backend.ts` declares the global),
so the adapter safely installs a scoped proxied `spindle` for the duration of one
`generateForMessage` call (mutex-serialized to prevent cross-chat races), then
restores it. This is purely a host-interface adaptation; no Inlay code changes.

### Config compilation isolation

The adapter + pipeline compile under `tsconfig.inlay-adapter.json` (Inlay
strictness: `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes` off). The main
Cue `tsconfig.json` excludes the adapter, its test, and the pipeline tree so
Cue's strict flags never touch transplanted Inlay code.

