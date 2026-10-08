# Cue — Living Novel

Cue is a Lumiverse extension that turns a chat into a living visual novel. It replaces the native message and input surfaces only while VN mode is active. Canonical chat messages remain the source of truth.

> The project was previously named *Visual Novel Preview*. Its install identifier remains `visual_novel_preview` so existing installations upgrade in place.

The preview includes:

NovelAI profiles automatically use model-aware prompt formatting. V4+ receives separate scene and character captions and numerical emphasis; V3 keeps a combined prompt with bracket emphasis. The saved profile model is used unless Cue overrides it. Negative numerical emphasis requires V4.5 or newer.

Under Advanced, NovelAI has toggles for model-specific quality tags and default negative tags. Custom positive prefixes and edited or empty negatives are preserved. Automatic quality tags are written into the request so they can be inspected; V4.5 Curated includes `rating:general` and reduced feet emphasis. These options do not affect other providers. The Lumiverse NovelAI adapter must also include the accompanying change that honors `qualityToggle: false` and empty negatives.

- paragraph-by-paragraph reveal with a final acknowledgement gate
- Previous button and Left Arrow to reread earlier paragraphs in the current reply. Going back pauses Auto and Skip, keeps your response draft, and does not rewind the chat. Skip still uses your selected mode.
- Standard typed-response and CYOA choice modes
- a single native image pipeline — planner → asset scheduler — with per-provider bounded concurrency and progressive delivery
- previous-image retention and decode-before-swap so a late image never blanks the stage
- exactly one centered protagonist per frame: no second character, crowd, or bystander
- a frozen per-chat character-identity/tag block, migrated automatically from the legacy visual-profile record
- a closed pose/expression catalogue, with deterministic selection by default
- fixed 16:9 camera scene planning and explicit scene-boundary checks
- swipe, edit, delete, duplicate-submit, and stale-image reconciliation
- view-gated generation: Cue only plans turns and generates images for chats whose Cue view is open; closing the view (or leaving the chat) aborts the in-flight image batch and marks it cancelled, opening the view plans the latest reply only when nothing current is stored, and cancelled images wait for a manual Retry instead of resuming on their own
- per-user and per-chat persisted continuity
- a settings tab, a user-selectable scene-image fit (Cover / Contain / Stretch / Original size / Scale down), seven built-in theme presets (Lumiverse, Golden hour, Boxed console, Paper novel, Midnight noir, Yamaku classic, Literature club), and a shadow-DOM custom CSS contract that is always the final styling layer
- optional **sprite mode**: reusable character cut-outs (4, 8 or 12 expressions each) over reusable backgrounds, staged per paragraph, with a sprite library in settings (see [Sprite mode](#sprite-mode))
- an always-accessible **Back to chat** control that restores native Lumiverse

It targets Lumiverse staging `1.1.6`, audited at commit `33dfa9ee62999fa3e2567066ed5cdadf61635323`, and `lumiverse-spindle-types` `0.6.23`.

## Optional System One decisions

The **Connections** settings section configures Cue's own System One URL and model (applied with **Apply**). Save the API key there; Lumiverse encrypts it in Cue's private enclave. Cue sends Jev's typed `state` and `questions` request through the Spindle HTTP proxy. This requires the `cors_proxy` permission. If no key is saved or the request fails, Cue uses its existing story reader.

**Compare** logs decision latency, input tokens, and speaker/expression agreement without changing the turn. **Use for presentation and familiar scenes** applies confident speaker, expression, and audio decisions. For replies of up to seven short paragraphs, Cue can reuse a known scene without calling the prose planner when Jev finds no scene or visual change. Longer replies use the story reader and split Jev's presentation questions into requests that fit the API limits. This setting is off by default.

## Image pipeline and identity

When System One is On and returns confident expression decisions, the picture limit applies to new renders after cache lookup. Cue checks expressions across the classified paragraphs, reuses compatible images without spending generation slots, and generates distinct missing images in paragraph order up to the limit. Repeated requests for the same missing image share its render. Other misses keep the current image; uncertain continuation paragraphs and repeated expressions do not force a swap. Jev currently classifies the first 24 paragraphs. Off, Compare, unavailable classifiers, and native card art retain their existing image-budget behavior.

Generated scene images come from the one built-in path: `src/backend/runtime/planner.ts`, then `src/backend/runtime/images.ts`, then the per-provider `AssetScheduler`. The sidecar planner proposes only scene boundaries, environments, and paragraph cues. It never supplies free-form pose, expression, or a prompt delta; those fields are emitted empty and ignored by the prompt compiler.

Every image shows exactly one centered protagonist composed from a stable identity/tag block and a pose suffix from a finite catalogue. The tag block is frozen per chat and is never auto-updated by a later turn. By default, pose is selected by a pure function of paragraph index and text; optional System One decisions can choose another pose from the same catalogue. The camera is fixed to a centered, eye-level, medium-wide 16:9 composition with the lower quarter clear for the dialogue surface.

**Image size.** Scene pictures are wide, so Cue asks for a landscape size. **Pictures → Image size** sets it for ComfyUI and SwarmUI in both modes: **Standard** 912×624 (the default) or **Upscaled** 1216×832. NovelAI always gets 1216×832, its largest size that costs no Anlas (unless you pick another size under NovelAI **Image dimensions**). A `width` and `height` in your **Image parameters (JSON)** win, so a workflow you sized yourself keeps its size. Other providers get no size from Cue.

**ComfyUI reference switch.** Without a reference image (reference anchoring off, no portrait yet, an idle sprite, a background plate, a key moment), Cue used to send only `denoise: 0.0`. That sets the IP-Adapter strength to 0, but the IP-Adapter still loads and runs. Optional: add a Boolean node that turns the IP-Adapter on/off (for example a switch between the IP-Adapter model and the plain model), map its value as **Custom** in the Lumiverse workflow setup, and give it a title with "IP-Adapter" or "reference". Cue turns it on only when it sends a reference. Without a reference, Cue turns it off and sends no `denoise: 0.0`. Cue sends the value in `comfyui_custom_fields`, together with your own `comfyui_custom_fields` (or `custom`) from **Image parameters (JSON)**; a value you set there for the same field wins. Without such a field nothing changes.

The pipeline never mutates canonical chat messages. It writes only extension-owned projections: per-turn records, per-chat state, and the single-character visual-state identity record.

As with any generative system, image-provider speed and visual identity quality depend on the selected model, provider, and prompt settings. Cue does not promise a specific provider result.

RisuAI card greetings that pack several alternative scenes into one message are macro-resolved before planning, so only the selected scene is shown. Limitation: no host event fires when a scene picker in the chat is clicked, so a changed selection is picked up only when Cue is reopened, when state is requested again, through the Try again control on the waiting card (`vn_refresh`), or through Try again on a visible turn (`vn_retry_turn` re-resolves first and replans when the selection changed). Volatile macros such as `{{random}}`, `{{roll}}` or `{{time}}` in a message re-resolve on every check without counting as a new scene; a message whose host resolution fails keeps its stored turn.

## Sprite mode

Scene mode (the default) paints a full picture for each scene. That takes 20–50 s per picture, so Cue limits pictures per reply. **Sprite mode** pays for pictures once and then reuses them:

- **Character sprites.** For each character, outfit and image style, Cue makes a set of expressions. **Expressions per character** (under **Image size**) sets the size: **4 (fastest)**, the default (idle, smile, sad, angry); **8** (adds laughing, surprised, embarrassed, smug); or **12 (all)** (adds crying, worried, thinking, scared). A feeling outside the set shows the nearest expression in the set, for example worried shows sad. An image you already have is always used, whatever the size. Changing the size deletes nothing; a bigger size makes the missing ones the next time the character appears. Each sprite is drawn on a white background with your image connection, then cut out in your browser.
- **Backgrounds.** One empty background ("plate") per place, time of day and weather.
- **Staging.** For every paragraph, Cue chooses who stands where, with which expression, motion, emote and light. Every paragraph can change expression, and there is no picture limit per reply.

**Turn it on.** Open the Cue settings tab, then **Pictures**. Keep **Generated illustrations**, and under **How the story is shown** choose **Character sprites**. It saves at once. **Pictures per reply** does not apply in sprite mode; Cue keeps your choice for scene mode.

**First-run cost.** The first time a character appears, Cue makes their set. The order is: the reply's background first, then the expressions the reply uses, one at a time in the order they appear, then the reply's key moment (if any), and only then the rest of the set. A new reply goes ahead of that rest. Rare expressions (in 12 only) are made last, when a reply needs them. Each new place needs one background. These are normal requests to your image connection, so the first replies cost about as much as scene mode. After that, the same character, outfit and style reuse their set in every chat. Generation runs only while a Cue view is open.

**Cut-out quality.** **Best** downloads a 176 MB segmentation model (ISNet-anime) once from Hugging Face. The browser keeps it, so later visits do not download it again. The download starts with the first cut-out, or at once with **Download model**. **Remove downloaded model** frees the space. **Basic** never downloads anything and removes the plain background without a model; edges can be rougher, mostly on white clothes and hair. A different model address goes under **Advanced → Models and parameters → Sprite cut-out model URL** (https only, saved with **Apply**).

**Classifier staging.** Without System One, Cue stages from the story reader's plan: the speakers stand on stage, and expressions come from the cues. With **System One** on (**Connections**, key saved), Jev answers small choice and yes/no questions for each paragraph: who is present, which expression, motion and emote, how strong, which light. It also notices a place you have already visited, even when it is described differently, so the background is reused. These questions run in parallel and take well under a second. Uncertain answers keep the previous choice, so sprites do not flicker.

**Key moments.** Sprites cannot show everything: a kiss, a fight, someone sitting or running. Under **How the story is shown**, **Key moments** (sprite mode only) offers **Sprites only** (the default) and **Picture for a key moment**. With the second, Cue picks at most 1 paragraph per reply and paints a full scene picture for it with the normal scene-picture pipeline (same prompts, cache and image connection). Without System One, Cue picks a paragraph whose narration shows contact, a fight or a pose a standing sprite cannot show, or a new scene that opens with nobody on stage. With System One, Jev rates each paragraph that has a picture cue ("how important and visual is this moment" and "can a standing sprite show this?"), and Cue takes the top one above a threshold. When you reach that paragraph and the picture is ready, it crossfades in and the sprites fade out; the next paragraph brings the background and sprites back. Until the picture is ready, the sprites stay (Cue does not wait). Retrying the turn regenerates a failed picture and keeps finished ones; a failed picture never blocks the sprites. The setting applies from the next reply. Limit: the scene prompt describes the character, expression, held object and place, not the body pose, so the picture shows the moment's setting and mood more than the exact action.

**The library.** **Pictures → Sprite library** lists your characters (ready count out of 12, every expression on a checkerboard with its status) and backgrounds. From there you can **Prepare sprites for this chat** ahead of time, **Regenerate** an expression or background, **Re-cut** a sprite from its original picture, and **Delete** a set or background (Cue asks you to confirm). The library is kept per user and bounded to the newest 64 sets and 128 backgrounds.

**Limits.** A change of image style (connection, model, prompt prefix or suffix, negative prompt) starts new sets. Until an expression is ready, the nearest ready one stands in. A character with nothing ready yet shows a "Preparing" badge instead of a sprite. v1 has no lip flap or blinking, no parallax, and no sprite for your persona. See [docs/SPRITE_MODE.md](docs/SPRITE_MODE.md) for the design.

## Scene image reuse (temporary cache)

Cue keeps a small, in-memory cache of the scene images it generated so an
exact-compatible cue can reuse an image instead of sending a new provider
request. The cache is reuse-first and generate-on-miss; it never generates
ahead of time and never relaxes a match.

**What "exact compatible" means.** A cached image is reused only when all of
these are identical: the durable character id and subject class (never just
the display name), the resolved appearance tags and wardrobe, the effective
environment (location, time and weather, lighting, description, persistent
elements), the closed-catalogue pose/expression, the bounded action/prop, the
camera framing, and the exact provider request (positive and negative prompt,
connection and workflow, provider, model, your image parameters, the image
size Cue sends, prompt syntax, and the reference-anchoring toggle). Scene ids, cue ids, paragraph
numbers, the turn key and free-form
`promptDelta` are not part of the match, so alternating speakers (Mira, Alex,
Mira) in the same room still reuse. Composition and camera locks are not
rendered into prompts and are ignored. Cues whose planner run did not persist
a character id, resolved appearance and subject class never use the cache.

**Lifetime.**

- Memory only, per backend worker. A Lumiverse restart starts empty. Nothing
  is written to storage and no image bytes are held: entries are pointers
  (image id, URL, provenance). Bounded to 256 entries / 1 MiB of metadata,
  least-recently-used first.
- Scoped to one user and one chat. Switching chats releases the previous
  chat's entries. The backend learns the active chat from the host
  `CHAT_SWITCHED` event and from the frontend's `vn_get_state` request (sent
  on every chat switch); a chat that only ever produced generation events
  without either signal is released when its message is deleted or the
  worker restarts.
- Scoped to one physical scene episode. The planner keeps `priorSceneId`
  across speaker switches and changes it only on a real boundary (location
  change, major time jump, environment replacement, forced). Entries from an
  earlier episode are retired, so leaving a room and returning to an identical
  room does not reuse the earlier visit. Deleting the active message (chat
  scene lineage restarts) releases the whole chat scope.
- Late results are never admitted. Every new generation, swipe, edit,
  regeneration, cancel and asset batch start advances the chat's admission
  epoch; a provider result that arrives afterwards is kept for its own turn
  record but not cached.
- Forced regeneration ("Regenerate reply" / "Try again"): unfinished jobs are
  re-made without a lookup and any image they showed is dropped from the
  cache. Finished images are kept, as before.
- Missing assets: before a reuse the extension checks `images.get`; a deleted
  or unverifiable image is dropped and normal generation runs. `IMAGE_DELETED`
  host events drop entries too.
- Eviction or invalidation never deletes an image and never rewrites a stored
  turn; historical turns keep their image ids.

**Extra swaps beyond the image cap.** The planner still generates at most
`maxImagesPerTurn` images. Cues beyond the cap are kept as reuse-only
candidates (`cacheCues`, up to 16). A candidate becomes an extra image only
when an exact-compatible image is already cached: at planning time (it then
appears in the first turn view) or later in the same turn when a budgeted image
lands (it then arrives as a normal asset update). A candidate with no cached
match produces nothing: no job, no request, no error, no retry. Such assets
are marked `source: "cache"` and are excluded from generation progress and
from the "Try again" wording.

**Concurrent requests.** If two compatible cues are in flight at once (for
example a superseded batch still running), only one owns the provider
request; the other waits and shares the result. An aborted owner releases the
waiter immediately; a failed owner fails the waiter once (no retry cascade).

**Reference anchoring first.** The portrait decision runs before any reuse.
A render that must capture a character's portrait (anchoring on, no
compatible portrait yet) is always generated, never served from the cache; it
is still stored for later cues. Toggling reference anchoring on or off changes
compatibility, so images made under the other setting are not reused.

**Limitations.** Exact match only. The captured portrait itself is not part
of the match (only the toggle is), so once a portrait exists, renders anchored
to it and the capture render of the same appearance count as compatible (the
ComfyUI reference switch follows the reference and is not part of the match either); your
own reference or source settings in image parameters do count. A swipe that re-enters a room
starts a new episode. The cache does not survive a restart. Reuse means the
same Lumiverse image id is shown in several turns; deleting it from the
gallery affects all of them, exactly as today.

**Debugging.** With **Debug logging** on, `[VN] scene-cache ...` lines report
each hit (with the source message and an estimate of the generation time
avoided), each miss with its reason (`absent`, `evicted`, `invalidated`,
`episode_retired`, `bypass`, `portrait_capture`, `asset_missing`,
`asset_unverifiable`, `identity_unresolved`), each store and rejection (`stale_admission`,
`aborted`, `no_image_id`), waits for in-flight owners, candidate resolutions,
scope releases, and a per-batch summary (hits, shared, avoided, stores,
misses, rejects, waits, evictions, entries, bytes).

## Text effects

Dialogue can style a few words with an inline tag. Wrap the words and close the tag:

| Markup | Effect | Looks like / use for | Moves |
| --- | --- | --- | --- |
| `<shake>Get down!</shake>` | Shake | Letters jolt hard and fast. Shouts, impacts, fear. | letters |
| `<tremble>I-I'm fine.</tremble>` | Tremble | A small nervous quiver. Cold, nerves, holding back tears. | letters |
| `<wave>La la la~</wave>` | Wave | Letters ripple up and down in turn. Sing-song, teasing, dreamy. | letters |
| `<bounce>We won!</bounce>` | Bounce | Letters hop one after another. Excited, cheerful. | letters |
| `<rainbow>Magic!</rainbow>` | Rainbow | Colours flow through the letters. Magic, wonder, silliness. | letters |
| `<glow>The seal breaks.</glow>` | Glow | A soft, breathing light around the words. Spells, revelations. | whole words |
| `<pulse>Ba-dump.</pulse>` | Pulse | Words swell like a heartbeat. Emphasis, longing. | whole words |
| `<glitch>SYSTEM ERROR</glitch>` | Glitch | Colour split with sudden digital tearing. Machines, corruption. | letters |
| `<whisper>don't tell anyone</whisper>` | Whisper | Small, faint, slightly italic. Secrets, asides. | none |
| `<shout>STOP!</shout>` | Shout | Large and bold; each letter punches in. Yelling. | letters |
| `<fade>Remember me...</fade>` | Fade | Letters drift in slowly, then flicker like a ghost. Memories, the uncanny. | letters |

- Tags are case-insensitive and nest: `<rainbow><wave>la la</wave></rainbow>` gives rainbow letters that also ripple. Markdown works inside (`<shout>**NO**</shout>`).
- A tag that is never closed, or a stray closing tag, is dropped; it never swallows the rest of the paragraph. Unknown tags (`<sparkle>`) and tags with attributes stay visible as plain text, like other unsupported HTML. Tags inside backticks stay literal.
- The output form `<span data-vn-text-fx="wave">…</span>` is also accepted. Only catalogue ids pass the sanitizer; any other value is removed.
- The tags are display markup only. Cue removes them from planner and image prompts and from text sent to speech (TTS), so they are never read aloud.
- The **Text effects** setting (config `textEffects`) has three modes: **Animated** (default), **Still** (config value `static`: colours, glow, and sizes stay; nothing moves), and **Off** (plain text). The OS "reduce motion" setting always behaves as Still. Effect intensity **Gentle** makes text motion smaller and slower. History always shows effects Still.
- **Display regex rules** run before the tags are read, so a rule can add effects. For example, to make every "magic" shimmer: `/\b(magic)\b/gi => <rainbow>$1</rainbow>`.
- **Teaching the model.** Paste this into a character card, lorebook entry, or preset (Settings also shows it with a Copy button):

  ```text
  Text effects: in dialogue you may wrap a few words in one of these tags to style them in the visual novel:
  <shake> <tremble> <wave> <bounce> <rainbow> <glow> <pulse> <glitch> <whisper> <shout> <fade>
  Examples: "<shake>Get down!</shake>", "<whisper>don't tell anyone</whisper>", "<rainbow><wave>la la la</wave></rainbow>".
  Use them rarely (at most one or two per reply), only for strong moments, wrap only the words that need it, and always close every tag.
  ```

Custom CSS can restyle effects through `[data-vn-text-fx="<id>"]`, the per-letter `[data-vn-text-fx-ch]` spans (index in `--vn-ch`), and the tuning properties `--vn-text-fx-amp`, `--vn-text-fx-speed`, `--vn-text-fx-glow`, `--vn-text-fx-rainbow-mix`, `--vn-text-fx-rainbow-1` … `-7`, and `--vn-text-fx-split-a` / `-b`.

## Run the standalone preview

```powershell
bun install --frozen-lockfile
bun run serve:demo
```

Open `http://localhost:4173` for CYOA mode or `http://localhost:4173/?mode=standard` for typed input.
Open `http://localhost:4173/?sprites` for a short sprite-mode scene with the fixture sprites (also takes `&preset=<theme preset id>` and `&mode=standard`).

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

Settings are split into sections — **Reading**, **Look**, **Pictures**, **Sound**, **Voice**, **Connections** and **Advanced** — shown as a side rail on wide screens and a tab strip on narrow ones; the search box at the top jumps to any setting, and the last open section is remembered. Everyday settings save as you change them. **Advanced** (prompts, story-reader context, model overrides, JSON parameters, text filtering, custom CSS) and the System One fields wait for **Apply**: a bar shows how many changes are not applied yet, with **Apply** and **Discard**, and drafts survive switching sections.

For a regex status template, expand **Add status template rule**, enter the pattern without slash delimiters, flags, and the multiline HTML replacement. Captures through `$36` and named captures are supported and escaped. Host macros in replacements are resolved through Lumiverse without committing variable changes. Use **Refresh live sources** after changing language variables. Rules operate on the first 200,000 source characters and reveal at the end of the turn. Multiple matches offer snapshots only, to avoid following the wrong character.

Rules do not change filtering. **Ignored tags** hides whole blocks from dialogue and image planning; **Display regex rules** affects dialogue only. Recognized ignored status tags remain available as plain-text cards. Complete HTML blocks are extracted separately before narrative planning. Previously cached plans may not contain panel sources.

Frames allow CSS layouts, SVG drawings, and CSS-only checkbox/radio interactions, but no scripts or navigation. Remote images/fonts are blocked unless explicitly enabled for that frame. A content update rebuilds that card's frame; other cards retain their state. Followed values from previous turns are hidden until the source appears in the current turn. Snapshot pins deliberately remain visible.

For stock SimTracker, let its card render in normal chat, open VN, then choose **Capture SimTracker snapshot**. This captures markup and checkbox state, not JavaScript behavior. Live updates require the companion adapter in [integrations/simtracker-vn-bridge.ts](./integrations/simtracker-vn-bridge.ts), wired to SimTracker's own template output. It is not installed into SimTracker automatically. The adapter must return only the requested chat/message/swipe's cards, call `refresh()` after updates, and `destroy()` on teardown. No DOM nodes are moved between extensions.

### Game engine extensions

A rules engine such as Warp can play alongside VN mode:

- **Moves on the stage.** Its choices (with success odds) appear as chips at **Your turn**, above your own reply options, in both standard and CYOA mode. Picking one shows it as your line and hands it back to the engine, which rolls and sends the message. The contract lives in [src/frontend/host/game-bridge.ts](./src/frontend/host/game-bridge.ts): the engine sends `vn-game-state-v1` (`{ version: 1, provider, chatId, choices: [{ id, label, group?, detail?, odds? }], busy? }`), VN answers picks with `vn-game-pick-v1` and asks for a fresh state with `vn-game-request-v1`. Up to 12 moves are shown.
- **Live status cards.** Providers named `warp` (as well as `simtracker`) may publish **Keep it updated** cards over the panel bridge above.
- **Moods for expressions.** An engine may leave `metadata.vn_hints = { moods: { Name: "flustered" }, notes: [...] }` on a reply or on the player message it answers. The planner reads it as data and prefers expressions that match.

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

See [SPEECH.md](./SPEECH.md) for the default-off paragraph speech (TTS) feature, its contracts, and its truthful limitations.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the viability decision, staging host contract, image pipeline, deterministic single-character identity, data ownership, state machines, and remaining preview limits.
