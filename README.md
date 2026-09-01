# Cue — Living Novel

Cue is a Lumiverse extension that turns a chat into a living visual novel. It replaces the native message and input surfaces only while VN mode is active. Canonical chat messages remain the source of truth.

> The project was previously named *Visual Novel Preview*; the package and docs still refer to that history in a few places.

The preview includes:

- paragraph-by-paragraph reveal with a final acknowledgement gate
- Standard typed-response and CYOA choice modes
- parallel image prefetch with previous-image retention
- fixed-camera scene planning and explicit scene-boundary checks
- swipe, edit, delete, duplicate-submit, and stale-image reconciliation
- per-user and per-chat persisted continuity
- a settings tab and shadow-DOM custom CSS contract
- an always-accessible Exit control that restores native Lumiverse

It targets Lumiverse staging `1.1.6`, audited at commit `33dfa9ee62999fa3e2567066ed5cdadf61635323`, and `lumiverse-spindle-types` `0.6.23`.

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

Enable the extension and grant its requested permissions in Lumiverse. Enter from **Visual novel** in the chat header, or **Composer Extras → Open visual novel**. The settings tab controls connections, generation limits, planning context, prompts, and theme CSS.

Opening an existing chat bootstraps its latest assistant reply automatically. A new empty chat needs its first normal assistant reply before there is anything to present.

The overlay feature-detects the staging component override API. If that API is absent, it leaves native chat intact and reports that the build is unsupported.

## Development

```powershell
bun run test
bun run typecheck
bun run build
bun run build:demo
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the viability decision, staging host contract, Inlay reuse map, data ownership, state machines, and remaining preview limits.
