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

### Pinned status cards and inline HTML

Open **Panels** at the top left of VN. Newly planned replies expose complete HTML/SVG blocks when their paragraph is reached. Choose **Pin this card** for a saved snapshot, or **Keep it updated** for a uniquely identified status source. Drag the title, drag the lower-right resize handle, or use arrow keys on the title; Shift + arrows resizes. Positions and pins are stored per chat in this browser. **Reset positions** recovers misplaced cards; **Unpin all** removes saved cards.

SimTracker is optional. Panels shows available cards from the current reply first; **Advanced tools** holds SimTracker capture, pasted HTML, and status template rules. Opening or closing advanced tools does not disable saved rules or pinned updates.

Settings starts with presentation, AI connections, reading, and audio. Expand **Advanced settings** for prompt editing, context controls, model overrides, JSON parameters, text filtering, and custom CSS. These controls keep their saved values while hidden.

For a regex status template, expand **Add status template rule**, enter the pattern without slash delimiters, flags, and the multiline HTML replacement. Captures through `$36` and named captures are supported and escaped. Host macros in replacements are resolved through Lumiverse without committing variable changes. Use **Refresh live sources** after changing language variables. Rules operate on the first 200,000 source characters and reveal at the end of the turn. Multiple matches offer snapshots only, to avoid following the wrong character.

Rules do not change filtering. **Ignored tags** hides whole blocks from dialogue and image planning; **Display regex rules** affects dialogue only. Recognized ignored status tags remain available as plain-text cards. Complete HTML blocks are extracted separately before narrative planning. Previously cached plans may not contain panel sources.

Frames allow CSS layouts, SVG drawings, and CSS-only checkbox/radio interactions, but no scripts or navigation. Remote images/fonts are blocked unless explicitly enabled for that frame. A content update rebuilds that card's frame; other cards retain their state. Followed values from previous turns are hidden until the source appears in the current turn. Snapshot pins deliberately remain visible.

For stock SimTracker, let its card render in normal chat, open VN, then choose **Capture SimTracker snapshot**. This captures markup and checkbox state, not JavaScript behavior. Live updates require the companion adapter in [integrations/simtracker-vn-bridge.ts](./integrations/simtracker-vn-bridge.ts), wired to SimTracker's own template output. It is not installed into SimTracker automatically. The adapter must return only the requested chat/message/swipe's cards, call `refresh()` after updates, and `destroy()` on teardown. No DOM nodes are moved between extensions.

Browser regression checks:

```powershell
bunx playwright install chromium
bun run test:panels
```

```powershell
bun run test
bun run typecheck
bun run build
bun run build:demo
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the viability decision, staging host contract, image pipeline, deterministic single-character identity, data ownership, state machines, and remaining preview limits.
