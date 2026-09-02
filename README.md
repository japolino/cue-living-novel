# Cue — Living Novel

Cue is a Lumiverse extension that turns a chat into a living visual novel. It replaces the native message and input surfaces only while VN mode is active. Canonical chat messages remain the source of truth.

> The project was previously named *Visual Novel Preview*. Its install identifier remains `visual_novel_preview` so existing installations upgrade in place.

The preview includes:

- paragraph-by-paragraph reveal with a final acknowledgement gate
- Standard typed-response and CYOA choice modes
- a single native image pipeline — planner → asset scheduler — with per-provider bounded concurrency and progressive delivery
- previous-image retention and decode-before-swap so a late image never blanks the stage
- exactly one centered protagonist per frame: no second character, crowd, or bystander
- a frozen per-chat character-identity/tag block, migrated automatically from the legacy visual-profile record
- a closed deterministic pose/expression catalogue chosen purely by paragraph index and text
- fixed 16:9 camera scene planning and explicit scene-boundary checks
- swipe, edit, delete, duplicate-submit, and stale-image reconciliation
- per-user and per-chat persisted continuity
- a settings tab, a user-selectable scene-image fit (Cover / Contain / Stretch / Original size / Scale down), five built-in theme presets (Lumiverse, Golden hour, Boxed console, Paper novel, Midnight noir), and a shadow-DOM custom CSS contract that is always the final styling layer
- an always-accessible Exit control that restores native Lumiverse

It targets Lumiverse staging `1.1.6`, audited at commit `33dfa9ee62999fa3e2567066ed5cdadf61635323`, and `lumiverse-spindle-types` `0.6.23`.

## Image pipeline and identity

Generated scene images come from the one built-in path: `src/backend/runtime/planner.ts`, then `src/backend/runtime/images.ts`, then the per-provider `AssetScheduler`. The sidecar planner proposes only scene boundaries, environments, and paragraph cues. It never supplies free-form pose, expression, or a prompt delta; those fields are emitted empty and ignored by the prompt compiler.

Every image shows exactly one centered protagonist composed from a stable identity/tag block and a pose suffix from a finite catalogue. The tag block is frozen per chat and is never auto-updated by a later turn. Pose is selected by a pure function of paragraph index and text, so a given paragraph always produces the same image. The camera is fixed to a centered, eye-level, medium-wide 16:9 composition with the lower quarter clear for the dialogue surface.

The pipeline never mutates canonical chat messages. It writes only extension-owned projections: per-turn records, per-chat state, and the single-character visual-state identity record.

As with any generative system, image-provider speed and visual identity quality depend on the selected model, provider, and prompt settings. Cue does not promise a specific provider result.

## Run the standalone preview

```powershell
bun install --frozen-lockfile
bun run serve:demo
```

Open `http://localhost:4173` for CYOA mode or `http://localhost:4173/?mode=standard` for typed input.

## Install into a local Lumiverse staging checkout

Build the bundles:

```powershell
bun run verify
```

Copy this directory, including `dist`, into:

```text
data\extensions\visual_novel_preview\repo
```

Enable the extension and grant its requested permissions in Lumiverse. Enter from **Visual novel** in the chat header, or **Composer Extras → Open visual novel**. The settings tab controls connections, generation limits, planning context, prompts, scene-image fit, the visual-novel theme preset, and the custom CSS layer.

Opening an existing chat bootstraps its latest assistant reply automatically. A new empty chat needs its first normal assistant reply before there is anything to present.

The overlay feature-detects the staging component override API. If that API is absent, it leaves native chat intact and reports that the build is unsupported.

## Development

```powershell
bun run test
bun run typecheck
bun run build
bun run build:demo
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the viability decision, staging host contract, image pipeline, deterministic single-character identity, data ownership, state machines, and remaining preview limits.
