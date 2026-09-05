# Cue — Living Novel architecture

## Viability decision

The overlay is viable on Lumiverse staging. The decisive API is `ctx.ui.registerComponentOverride`, combined with an `app-overlay` mount. While VN mode is active, the extension replaces `BubbleMessage`, `MinimalMessage`, and `InputArea` with null components and renders its own full-screen stage. Destroying those override handles restores native chat immediately.

This is a staging contract, not a portable main-branch contract yet. The extension therefore feature-detects it at activation time. It never edits Lumiverse source or hides native UI permanently.

There are two host limitations:

1. `InputArea` exposes no send or stop callbacks. VN submissions cross the frontend/backend bridge, then use `spindle.chat.appendMessage(..., { triggerGeneration: true })`.
2. Spindle exposes no public stop method for a normal generation started that way. The overlay keeps an Exit control outside user CSS so the user can always return to the native composer and stop there.

## System map

```text
Lumiverse staging host
  |
  +-- frontend context
  |     +-- input-bar action
  |     +-- settings tab
  |     +-- app-overlay mount
  |     +-- component overrides
  |     +-- backend message bridge
  |              |
  |              v
  |        VN frontend controller
  |              |
  |              +-- VnStage
  |              |     +-- reveal/input state store
  |              |     +-- nested theme shadow root
  |              |     +-- image preload and decode
  |              |
  |              +-- safety shadow root
  |                    +-- permanent Exit control
  |
  +-- backend Spindle worker
        +-- generation and message events
        +-- request router
        +-- per-chat planning queue
        +-- context assembly
        +-- scene and cue planner
        +-- upper-body single-subject prompt compiler (vendored Inlay)
        +-- per-provider image scheduler
        +-- reference portrait store
        +-- audio catalog and import
        +-- chat mutation
        +-- per-user storage
```

## Source layout

| Area | Responsibility |
|---|---|
| `src/frontend/host` | staging API feature detection, activation, overrides, chat switching, frontend/backend routing |
| `src/frontend/stage` | framework-free full-screen VN renderer, accessibility, keyboard input, image swaps |
| `src/frontend/store` | deterministic paragraph, acknowledgement, choice, and input gating |
| `src/frontend/settings` | Lumiverse settings surface |
| `src/frontend/theme` | stable `data-vn-*` selectors, base theme, scene-image fit attribute, CSS isolation, network-fetch stripping |
| `src/backend/runtime/controller.ts` | host event handling, submission reconciliation, active-turn ownership, visual-state and portrait load/save |
| `src/backend/runtime/planner.ts` | sidecar request, JSON repair and fallback plan, scene/cue/choice construction, active-character and attire attribution, per-paragraph speaker nameplates, deterministic expression assignment |
| `src/backend/runtime/images.ts` | deterministic prompt compilation through the vendored Inlay compiler, image generation, per-provider asset scheduling, reference-portrait anchoring, asset updates |
| `src/backend/runtime/storage.ts` | versioned per-user config, per-chat state, protagonist visual state, per-chat portrait store, durable character-appearance memory, serialized writes |
| `src/backend/runtime/audio-catalog.ts` | audio library scan, BGM/SFX categorization, tag matching |
| `src/backend/inlay-prompt` | vendored Inlay prompt compiler: tag assembly, visibility filtering, environment sections, ComfyUI/NovelAI syntax rendering |
| `src/backend/core/visual-state.ts` | frozen protagonist tag block, schema-v1 profile migration |
| `src/backend/core` | host-neutral queues, contracts, continuity reduction, boundary decisions, stale guards |
| `src/shared/character.ts` | closed pose/expression catalogue (92 entries), pure expression selection, single-character identity types |
| `src/shared/contracts.ts` | strict Zod trust-boundary schemas |
| `src/protocol.ts` | narrow frontend/backend message protocol |

## Turn flow

```text
GENERATION_STARTED
  -> stage enters waiting state

GENERATION_ENDED
  -> locate saved assistant message
  -> key by chat + message + swipe + content fingerprint + revision
  -> enqueue one planning job for that chat
  -> gather recent and enabled structured context
  -> ask sidecar for scenes, cues, speakers, and optional choices
  -> resolve the protagonist identity (seed once from planner/card/appearance memory, then freeze) and map each cue's expression onto the closed catalogue
  -> attribute each paragraph to a literal speaker nameplate and each cue to its active character, attire, and optional BGM/SFX
  -> validate claimed scene changes against objective evidence
  -> persist TurnPlan, the visual state, and any new appearance memory
  -> show paragraph 0 immediately
  -> enqueue all cue images by visible/next/background priority

image result
  -> verify active turn and scene revision
  -> persist generated asset
  -> send URL to browser
  -> preload and decode without clearing previous image
  -> swap only after decode succeeds
  -> acknowledge browser readiness to backend
```

Entering VN mode in an existing chat with no stored projection first sends the current config, then plans the latest non-empty assistant message through this same queue. The stage shows `Planning scene` while that bootstrap is running. Simultaneous state requests deduplicate to one plan.

If an image is late, the previous decoded image remains visible. If an obsolete image finishes after an edit, swipe, deletion, or newer turn, the ownership guards reject it.

## Reveal and input state

The current paragraph is readable before any response control appears. Each click or supported key advances one paragraph. The final paragraph needs its own acknowledgement. Only then does the stage reveal either generated/authored choices or the typed composer.

Choices are presentation metadata. Selecting one submits its configured value as a normal user message. Standard input does the same with typed text. Both routes attach a unique request ID. If Lumiverse writes the user message but fails while starting generation, the backend checks chat history before reporting the failure and never retries the same request blindly.

## Scene image fit

The rendered scene image obeys a user-selectable fit preset persisted in `config.json`. `VnStage` writes a `data-vn-scene-image-fit` attribute on the scene image element whenever the saved config changes, and the base theme maps each value to the matching CSS `object-fit` (cover, contain, fill, none, scale-down). Cover stays the backward-compatible default, `object-position` remains centered, and the fit is driven from config rather than user-supplied custom CSS, so it applies inside the shadow DOM regardless of theme.

## Theme presets

The stage ships exactly five built-in visual presets: **Lumiverse**, **Golden hour**, **Boxed console**, **Paper novel**, and **Midnight noir**. Their ids are the single canonical, host-neutral `THEME_PRESET_IDS` tuple and the derived `VisualNovelThemePreset` type, both declared in `src/config.ts` so the shared config module never imports frontend or browser code. `src/frontend/theme/presets.ts` only supplies the CSS payload (`THEME_PRESET_CSS`) keyed by those ids; the settings selector (`THEME_PRESET_OPTIONS`) and the config normalizer consume the same tuple, so the three can never drift. The removed experimental `retro-crt` id is gone everywhere.

Inside the nested theme shadow root the style layers are appended in a fixed cascade order, made explicit by `THEME_STYLE_LAYER_ORDER` (`src/frontend/theme/style-layers.ts`):

1. `base` — the platform `VN_BASE_CSS` (stable `data-vn-*` selectors, the scene-image fit mapping, and default `--vn-*` values).
2. `preset` — exactly one scoped block from `THEME_PRESET_CSS`, selected by `data-vn-preset="<id>"`. The preset *style element* lives in `themeRoot`, after base and before user CSS, and never in the outer safety root.
3. `user` — the sanitized custom-CSS layer. It is always last, so a user rule of equal specificity wins over a preset rule.

The `Lumiverse` preset maps the VN custom properties onto the real host tokens the Lumiverse page exposes — `--lumiverse-text`, `--lumiverse-text-muted`, `--lumiverse-primary` (accent), `--lumiverse-card-bg` (card), `--lumiverse-border`, `--lumiverse-font-family`, and `--lumiverse-*` key-control tokens (`primary-contrast`, `fill-medium`, `bg-elevated`) — each with a hard fallback so a host that does not export a token still renders the original default look.

The frontend controller applies the whole presentation config (theme preset, scene-image fit, custom CSS) on every save and on every `vn_state` / `vn_config` response through a single `applyVisualConfigToStage` helper, always from the *merged* config, so a saved patch never leaves the stage on stale values. The Exit control stays in the outer safety root, unreachable by any preset or user CSS.

## Scene model

A scene owns:

- structured location, time, weather, lighting, and persistent environment elements
- a `cast` list, an optional active `character` and `attire`, and the identity/tag block (`identityPrompt`)
- a reusable base prompt and a declared composition lock (planner metadata; the current compiler does not forward `basePrompt`, the composition lock, or a 16:9 requirement to the provider)
- prior-scene lineage
- a scene-scoped `ambient` effect id (weather/mood layer; persists until the next scene boundary)
- zero or more paragraph cues, each carrying an expression id, an optional one-shot `effect` id, and optional per-cue character, attire, BGM, and SFX

The planner may propose a boundary, but the deterministic boundary reducer accepts a new scene only for an initial scene, location change, major time jump, environment replacement, or explicit force. Emotion, pose, ordinary action, punctuation, and camera wording do not create a new scene. Where a boundary is not justified, the previous scene (and its camera, composition, and base prompt) is reused so the frame stays stable.

Compiled camera framing is fixed to `upper body, eye level, straight-on` for every cue. The scene still carries a declared composition lock and the dialogue-safe-region intent as planner metadata, but the compiler does not currently emit them; framing stability comes from the fixed camera tags plus scene reuse. Keeping faces clear of the dialogue UI therefore depends on the provider/workflow dimensions rather than an enforced prompt constraint.

## Stage effects

Stage visuals are layered procedurally (CSS + inline SVG only; no network assets):

- **Ambient effects** (scene scope): `rain`, `heavy_rain`, `snow`, `sakura`, `fog`, `fireflies`, `embers`, `vignette_dark`, `sepia_flashback`, `desaturate`, `dream_haze`, `danger_pulse`. The planner proposes one per scene (`PlannerSceneSchema.ambient`); it persists until the next accepted scene boundary. Weather effects animate real particle fields (multi-depth falling rain/snow, fluttering petals, drifting firefly glow, rising embers); `heavy_rain` adds a wet-lens pass (subtle blur plus refraction droplets). Grade effects (vignette, sepia, desaturate, haze, danger pulse) apply only to the scene image or a dedicated overlay — never to the dialogue box.
- **One-shot cue effects** (paragraph scope): `shake`, `shake_hard`, `rumble`, `zoom_in`, `zoom_out`, `zoom_punch`, `tilt`, `heartbeat`, `flash_white`, `flash_red`, `lightning`, `speed_lines`, `blur_pulse`, `fade_to_black`, `fade_from_black`, `fade_to_white`, `sparkle_burst`, `hearts_burst`, `confetti`. The planner attaches them to individual cues (`PlannerCueSchema.effect`) for dramatic beats only; each runs once and self-clears.

Pipeline: the planner emits raw strings which are normalized (trim, lowercase, spaces/hyphens to underscores) and validated against the closed catalogues in `src/shared/contracts.ts` — unknown ids are dropped to `null`/absent, never passed through. `TurnView` exposes per-paragraph `effects` and `ambients` arrays (omitted when empty) so the host can apply the turn's first ambient on load and paragraph-level overrides on reveal. The stage renders ambient markup inside the scene container (`data-vn-scene-ambient` drives scene-image filters; a sibling overlay carries particle/grade layers) and one-shot bursts in a dedicated fx overlay above the scene but below the dialogue box. Particle placement uses a seeded avalanche hash with stratified horizontal slots so fields cover the full width deterministically; all animation respects `prefers-reduced-motion` (static grade only, no motion).

## Asset state machine

```text
queued -> generating -> generated -> browser_ready
                    \-> failed
queued/generating   \-> cancelled
```

`generated` means the provider returned a persisted image ID and URL. `browser_ready` means the active browser decoded that image successfully. Those are intentionally separate states.

Jobs carry their owning turn key, scene ID, scene revision, paragraph index, prompt fingerprint, provider key, and priority. The prompt fingerprint includes the byte-identical identity/scene/camera block and the resolved pose id and suffix, so distinct poses and distinct identity states produce distinct jobs. Concurrency is enforced per provider. This lets another provider progress without violating a slow provider's limit.

## Canonical data and storage

Lumiverse chat messages are canonical. Paragraphs, choices, scenes, cues, and asset state are extension-owned projections. Stored records are versioned and scoped by user:

```text
config.json
character-appearance.json
character-appearance-migrated.json
chats/<chat-id>/state.json
chats/<chat-id>/visual-state.json
chats/<chat-id>/portraits.json
turns/<chat-id>/<assistant-message-id>/<swipe-id>.json
```

Per-path writes are serialized because `userStorage` has no transaction or compare-and-swap operation. Chat state points to the active turn and carries the latest accepted scene and terminal continuity. The visual-state record holds the frozen protagonist identity and the latest environment descriptor; the portrait record holds each character's canonical reference image ID and data; the appearance map remembers canonical tags per character name across chats.

## Image pipeline

The extension has one native image pipeline. `planner.ts` asks a sidecar model — or a deterministic fallback planner when the sidecar is unavailable — for scene boundaries, environments, paragraph cues (expression plus optional character, attire, BGM, SFX), per-paragraph speakers, and optional choices, then normalizes, repairs, and validates that JSON into a strict `TurnPlan` (one repair retry, then fallback). `images.ts` compiles each cue into a prompt with `compileImagePrompt` and turns the plan into asset jobs with `createAssetJobs`, which a per-provider scheduler (`AssetScheduler`) generates with bounded concurrency and delivers progressively to the browser.

Compilation goes through the vendored Inlay compiler (`src/backend/inlay-prompt`) configured for Anima-style tag assembly, ComfyUI section formatting, and `maxCharacters: 1`. The assembled prompt is, in order:

```text
prefix + subject (1girl|1boy|1other, solo) + identity tags (with any attire override applied)
       + expression/pose suffix + environment (location, time+weather, lighting, background elements)
       + camera (upper body, eye level, straight-on) + suffix
```

`PROMPT_PREFIX`, `PROMPT_SUFFIX`, and the negative prompt come from `config.ts`; the subject line is classified from the identity text; the pose suffix comes from the closed catalogue. The scene's `basePrompt`, composition lock, environment `description`, and declared aspect ratio are planner metadata that the current compiler does not forward to the provider.

Where the extension owns the data, behavior is deterministic: a byte-identical content fingerprint keyed by message, swipe, and content makes generation events, reconnects, and edits idempotent; stale asset results are rejected by ownership guards; previous visual state is reused so the scene prompt stays stable until a justified boundary; and the pipeline never mutates the canonical chat message.

### One subject per frame, switchable active character

The planner instruction requires exactly one visible character per frame and forbids a second character, a crowd, or a bystander; the compiler forces `solo` into every prompt. Unlike earlier builds, the visible character is not always the same protagonist: the planner's `characters` output may describe several cast members, a scene can name an active `character`, and an individual cue can switch it again (`cue.character`, with persona names filtered out). Attire can likewise be overridden per scene or per cue. The frame is single-subject, but the subject can change between cues.

### Identity, appearance memory, and tag block

Character and clothing events resolve in paragraph order before the image-count limit is applied. Each new cue stores its own `resolvedIdentity` and nullable `resolvedAttire`; scenes retain their opening state. `terminalVisualState` and indexed continuity deltas carry the final subject and wardrobe into the next turn, including changes after the last generated image. Opening-cue repair never copies a future character or outfit backward. Planner entries also accept open-ended `species` and `anatomy` fields, preserving unfamiliar visual traits without expanding a species whitelist.

The protagonist's physical identity is a frozen per-chat tag block stored at `chats/<chat-id>/visual-state.json` as:

```text
{ schemaVersion: 2, protagonist: { name, tags }, environment, updatedAt }
```

The active character's baseline is seeded from a matching planner entry, the card, or chat-scoped appearance memory. A later description of the same character cannot overwrite a usable baseline, but changing the active character selects that character's own baseline. Missing appearances never inherit another character's body. The image job reports an unresolved appearance and Retry reruns planning. Document-shaped noise is rejected rather than stored as canonical memory.

A roster at `chats/<chat-id>/characters.json` remembers appearances within each chat. Runtime planning and image generation do not import the old user-wide `character-appearance.json` by name, since unrelated chats can reuse names such as Guard. Existing per-chat visual state seeds the scoped roster on the next planned turn; other cast members are relearned from matching planner entries. Legacy storage APIs remain available for compatibility.

### Reference portrait anchoring

When reference anchoring is enabled, supported providers capture a character portrait in `chats/<chat-id>/portraits.json`. Reuse requires a matching fingerprint of the normalized name, identity tags, provider, connection/workflow and configured model. Unversioned or incompatible portraits are not sent to the provider; a successful fresh capture replaces them. Concurrent cues for the same character wait for capture, while unrelated characters can render concurrently. NovelAI receives director reference images; ComfyUI and SwarmUI receive source images. Unsupported providers do not anchor.

### Closed pose/expression catalogue

Pose and expression belong to a closed, bounded catalogue (`POSE_EXPRESSION_CATALOGUE`, currently 92 entries, hard cap 128, unique ids, non-empty suffixes). The planner proposes a cue `expression`; a valid catalogue id is used directly, otherwise selection falls back to a pure function of `(paragraphIndex, paragraphText)` — keyword match first, then a stable paragraph-index wrap-around. Each cue stores only a `poseExpressionId`; `compileImagePrompt` resolves it back to its exact suffix. Unknown or absent ids fall back to the first catalogue entry, so old stored cues and corrupt ids still resolve deterministically. The same paragraph and plan always produce the same compiled prompt.

## Audio pipeline

Audio is optional and user-supplied. The settings panel imports audio files from any folder in chunks that fit the host's 4 MB message limit; `audio-catalog.ts` scans the stored library, classifies each file as BGM or SFX from its path keywords, and derives searchable tags from file and folder names. When a library is present, the planner is asked for optional per-cue `bgm` and `sfx` names, which the frontend `audio-engine` resolves against the catalog and plays with looped music and one-shot effects. Chats without an audio library skip all of this: the planner is not asked for audio cues.

## Staging host contract

The audited remote staging commit is `33dfa9ee62999fa3e2567066ed5cdadf61635323`.

- Full-screen content mounts with `ctx.ui.mountApp({ position: "app-overlay" })`.
- Runtime overrides register through `ctx.ui.registerComponentOverride({ host, mode, priority, component })`.
- Lower numeric override priority wins. This preview uses priority `10`.
- Destroying a handle restores the underlying host component.
- Permission revocation clears host overrides. The frontend also exits VN mode when it receives an `app_manipulation` revocation event.
- Published types `0.6.23` do not accurately declare the staging override call, so one narrow local adapter contains the mismatch.

Primary references:

- [Lumiverse app mounts](https://docs.lumiverse.chat/frontend-api/ui-placement/#app-mounts-requires-app_manipulation)
- [Lumiverse frontend/backend communication](https://docs.lumiverse.chat/frontend-api/backend-communication/)
- [Lumiverse chat mutation](https://docs.lumiverse.chat/backend-api/chat-mutation/#append-and-generate)
- [Lumiverse backend events](https://docs.lumiverse.chat/backend-api/events/)
- [Lumiverse image generation](https://docs.lumiverse.chat/backend-api/image-generation/)
- [staging override registry](https://github.com/prolix-oc/Lumiverse/blob/33dfa9ee62999fa3e2567066ed5cdadf61635323/frontend/src/lib/spindle/component-override-registry.tsx)

## Preview boundaries

The preview proves the overlay and interaction architecture. It does not promise image-provider speed or visual identity quality, which depend on the selected model, provider, and prompt settings. Regular non-stream image generation cannot be cancelled upstream, so cancellation is cooperative and stale completions are discarded.

The overlay contract should be treated as staging-only until the same API lands in Lumiverse main. A future type-package release should replace the local staging adapter once it exposes the real override signature.
