# Visual Novel Preview architecture

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
        +-- provider-scoped image scheduler
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
| `src/frontend/theme` | stable `data-vn-*` selectors, base theme, CSS isolation, network-fetch stripping |
| `src/backend/runtime/controller.ts` | host event handling, submission reconciliation, active-turn ownership |
| `src/backend/runtime/planner.ts` | sidecar request, fallback plan, fixed camera, scene/cue/choice construction |
| `src/backend/runtime/images.ts` | prompt compilation, image generation, asset updates |
| `src/backend/runtime/storage.ts` | versioned per-user config, per-chat continuity, serialized writes |
| `src/backend/core` | host-neutral queues, contracts, continuity reduction, boundary decisions, stale guards |
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
  -> validate claimed scene changes against objective evidence
  -> persist TurnPlan
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

## Scene model

A scene owns:

- structured location, time, weather, lighting, and persistent environment elements
- cast names and continuity state
- a reusable base prompt
- a fixed camera lock
- composition constraints and prior-scene lineage
- zero or more paragraph cues

The planner may propose a boundary, but the deterministic boundary reducer accepts a new scene only for an initial scene, location change, major time jump, environment replacement, or explicit force. Emotion, pose, ordinary action, punctuation, and camera wording do not create a new scene.

Camera framing is fixed to an eye-level, medium-wide, 50mm-equivalent, centered-subject composition with the lower quarter kept free for dialogue. This matches the supplied reference frames: the character stays centered, background geometry remains stable, and the dialogue or choice surface occupies the lower portion without covering the face.

## Asset state machine

```text
queued -> generating -> generated -> browser_ready
                    \-> failed
queued/generating   \-> cancelled
```

`generated` means the provider returned a persisted image ID and URL. `browser_ready` means the active browser decoded that image successfully. Those are intentionally separate states.

Jobs carry their owning turn key, scene ID, scene revision, paragraph index, prompt fingerprint, provider key, and priority. Concurrency is enforced per provider. This lets another provider progress without violating a slow provider's limit.

## Canonical data and storage

Lumiverse chat messages are canonical. Paragraphs, choices, scenes, cues, and asset state are extension-owned projections. Stored records are versioned and scoped by user:

```text
config.json
chats/<chat-id>/state.json
turns/<chat-id>/<assistant-message-id>/<swipe-id>.json
```

Per-path writes are serialized because `userStorage` has no transaction or compare-and-swap operation. Chat state points to the active turn and carries the latest accepted scene and terminal continuity.

## Inlay reuse map

The preview intentionally adapts architecture from Inlay Illustrator staging, with permission from its owner. The context work comes directly from the design of Inlay's `src/backend/context.ts` and `src/backend/continuity-context.ts`:

| Inlay idea | VN use |
|---|---|
| per-user, per-chat scheduling | prevents one chat from blocking another and preserves operator isolation |
| serialized extension storage | protects config and active-turn records from overlapping writes |
| source fingerprints and duplicate suppression | makes generation events, reconnects, and edits idempotent |
| stale-result ownership guards | prevents old image results from replacing a newer swipe or scene |
| progressive image generation | prefetches every relevant paragraph image while keeping readable content available |
| previous visual state reuse | keeps the scene prompt and composition stable until a justified boundary |
| context-aware prompting | failure-isolated chat, card, persona, and activated-lore lookups; bounded blocks; macro resolution; visual-segment preference |
| identity separate from rolling continuity | reused scenes retain their stored identity baseline, while a new scene refreshes from current host data |
| connection fallback | uses selected connections when configured and Lumiverse defaults otherwise |
| debug fallback reporting | exposes sidecar failures without making the chat unreadable |

The VN-specific renderer, paragraph acknowledgement model, CYOA protocol, fixed-camera scene contract, component overrides, settings UI, browser-readiness handshake, and safe Exit layer are new for this extension.

Not copied into the preview are Inlay's inline message widgets, lightbox, rerolls, avatar-vision enrichment, Asset/Creative/Static/Dynamic mode family, manual generation workflow, image-prompt studies, or evaluation harnesses. They solve a different presentation problem and would expand the preview beyond its purpose.

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
