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
        +-- fixed-camera single-character prompt compiler
        +-- per-provider image scheduler
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
| `src/backend/runtime/controller.ts` | host event handling, submission reconciliation, active-turn ownership, single-character load/save |
| `src/backend/runtime/planner.ts` | sidecar request, fallback plan, fixed camera, exactly-one-protagonist scene/cue/choice construction, deterministic pose assignment |
| `src/backend/runtime/images.ts` | deterministic prompt compilation, image generation, per-provider asset scheduling, asset updates |
| `src/backend/runtime/storage.ts` | versioned per-user config, per-chat state, frozen single-character visual state, serialized writes |
| `src/backend/core/visual-state.ts` | immutable single-character identity registry, frozen tag block, schema-v1 profile migration |
| `src/backend/core` | host-neutral queues, contracts, continuity reduction, boundary decisions, stale guards |
| `src/shared/character.ts` | closed pose/expression catalogue, pure pose selection, frozen single-character identity types |
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
  -> ask sidecar for scenes, cues, and optional choices
  -> resolve the frozen single-character identity (seed once, then freeze) and assign each cue a closed-catalogue pose
  -> validate claimed scene changes against objective evidence
  -> persist TurnPlan and the single-character visual state
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
- exactly one protagonist via `cast` (a single name) and the frozen identity/tag block (`identityPrompt`)
- a reusable base prompt
- a fixed, centered 16:9 camera lock
- composition constraints and prior-scene lineage
- zero or more paragraph cues

The planner may propose a boundary, but the deterministic boundary reducer accepts a new scene only for an initial scene, location change, major time jump, environment replacement, or explicit force. Emotion, pose, ordinary action, punctuation, and camera wording do not create a new scene. Where a boundary is not justified, the previous scene (and its camera, composition, and base prompt) is reused so the frame stays stable.

Camera framing is fixed to an eye-level, medium-wide, 50mm-equivalent, centered-subject composition with the lower quarter kept free for dialogue. This matches the supplied reference frames: the character stays centered, background geometry remains stable, and the dialogue or choice surface occupies the lower portion without covering the face. The lock is carried verbatim on every scene, so no scene can widen or re-frame the shot in a way that breaks the composition.

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
chats/<chat-id>/state.json
chats/<chat-id>/visual-state.json
turns/<chat-id>/<assistant-message-id>/<swipe-id>.json
```

Per-path writes are serialized because `userStorage` has no transaction or compare-and-swap operation. Chat state points to the active turn and carries the latest accepted scene and terminal continuity. The visual-state record holds the frozen single-character identity and the latest environment descriptor.

## Image pipeline

The extension has one native image pipeline. `planner.ts` asks a sidecar model — or a deterministic fallback planner when the sidecar is unavailable — for scene boundaries, environments, and paragraph cues, then builds a strict `TurnPlan`. `images.ts` compiles each cue into a prompt with `compileImagePrompt` and turns the plan into asset jobs with `createAssetJobs`, which a per-provider scheduler (`AssetScheduler`) generates with bounded concurrency and delivers progressively to the browser.

The compiled prompt is:

```text
prefix + (identity: <tags>, solo | solo) + basePrompt + camera + composition + pose suffix + suffix
```

The sidecar never supplies free-form `action`, `expression`, or prompt content. Those cue fields are emitted empty and ignored by the compiler, so no unbounded pose/expression vocabulary can re-enter the prompt. `PROMPT_PREFIX` and `PROMPT_SUFFIX` come from `config.ts`; the camera and composition come from the scene's fixed camera lock; the pose suffix comes from the closed catalogue.

Where the extension owns the data, behavior is deterministic: a byte-identical content fingerprint keyed by message, swipe, and content makes generation events, reconnects, and edits idempotent; stale asset results are rejected by ownership guards; previous visual state is reused so the scene prompt and composition stay stable until a justified boundary; and the pipeline never mutates the canonical chat message.

### Exactly one protagonist

The planner instruction requires exactly one protagonist and explicitly forbids a second character, a crowd, a bystander, or "another" person. Its `characters` output is a single entry, and every scene `cast` is exactly `[protagonist.name]`. The prompt compiler forces `solo` into every compiled prompt, so a multi-character or background character frame cannot be generated from the planned scene.

### Frozen identity and tag block

The protagonist's physical identity is a frozen per-chat tag block stored at `chats/<chat-id>/visual-state.json` as:

```text
{ schemaVersion: 2, protagonist: { name, tags }, environment, updatedAt }
```

On a fresh chat it is seeded once from the planner's single `characters` entry, whose comma-separated description becomes the normalized `tags` list. After seeding, the identity is immutable: `resolveSingleCharacter` returns the existing state whenever a name is already present, and `saveSingleCharacterState` never overwrites a stored `protagonist`. A later turn therefore cannot drift the appearance even if the sidecar proposes a different description. Only `environment` and `updatedAt` advance, and only on a real scene or environment change.

Legacy `{ schemaVersion: 1, profiles }` records are migrated transparently on read. The first profile — or an explicit `protagonistName` — is promoted to the frozen protagonist and its comma-separated `description` split into normalized, de-duplicated tags. No manual migration or storage rewrite is needed for existing chats, and nothing mutates the canonical chat message.

### Closed pose/expression catalogue

Pose and expression belong to a closed, bounded catalogue (`POSE_EXPRESSION_CATALOGUE`, ≤ 16 entries, unique ids, non-empty suffixes). Selection is a pure function of `(paragraphIndex, paragraphText)`: a keyword match in the text wins, otherwise the set is indexed by paragraph index with a stable wrap-around. Each cue stores only a `poseExpressionId`; `compileImagePrompt` resolves it back to its exact suffix. Unknown or absent ids fall back to the first catalogue entry, so old stored cues and corrupt ids still resolve deterministically. The same paragraph always produces the same compiled prompt.

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
