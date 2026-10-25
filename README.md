# Cue — Living Novel

Cue is a Lumiverse extension that turns a chat into a living visual novel. It replaces the native message and input surfaces only while Cue is open. Canonical chat messages remain the source of truth.

> The project was previously named *Visual Novel Preview*. Its install identifier remains `visual_novel_preview` so existing installations upgrade in place.

The preview includes:

NovelAI profiles automatically use model-aware prompt formatting. V4+ receives separate scene and character captions and numerical emphasis; V3 keeps a combined prompt with bracket emphasis. The saved profile model is used unless Cue overrides it. Negative numerical emphasis requires V4.5 or newer.

Under Advanced, NovelAI has toggles for model-specific quality tags and default negative tags. Custom positive prefixes and edited or empty negatives are preserved. Automatic quality tags are written into the request so they can be inspected; V4.5 Curated includes `rating:general` and reduced feet emphasis. These options do not affect other providers. The Lumiverse NovelAI adapter must also include the accompanying change that honors `qualityToggle: false` and empty negatives.

- paragraph-by-paragraph reveal with a final acknowledgement gate
- Previous button and Left Arrow to reread earlier paragraphs in the current reply. Going back pauses Auto and Skip, keeps your response draft, and does not rewind the chat.
- **Skip** runs to the end of the reply and stops at Your turn. **Auto** stays on across replies: it pauses at Your turn (it never sends anything) and goes on when the next reply arrives.
- Keys: Enter, Space or Right Arrow continue, Left Arrow goes back, L opens History, A toggles Auto, S skips, 1–9 pick a suggested reply. They work from any button on the stage, never while you type in the reply box (Escape leaves it, keeping the draft). Scrolling up over the dialogue box opens History. A long paragraph scrolls inside the box instead of covering the scene: a tap, Continue or Enter shows its next page first, then moves on.
- an **opening card** for each reply (the scene's place, time and weather over the card's own background picture) and a **location label** at the top left while reading; see [Opening card and waiting screen](#opening-card-and-waiting-screen)
- a **waiting screen** while the next reply is written: the last scene's characters, lines and moves over a backdrop, with what you sent
- One **Your turn** for everyone: the reply box is always there (Enter sends, Shift+Enter adds a line; on phones Send sits beside it; an Enter in the first half second after the box takes focus, an input-method confirm and a held Enter never send, Ctrl+Enter always does), with suggested replies above it when the reply offers choices or **Suggest replies** is on (on for new installs; settings saved before Your turn was unified come back with it off unless the old reply mode was CYOA, since suggestions cost story-reader tokens on every reply)
- a single native image pipeline — planner → asset scheduler — with per-provider bounded concurrency and progressive delivery
- previous-image retention and decode-before-swap so a late image never blanks the stage
- exactly one centered protagonist per frame: no second character, crowd, or bystander
- a frozen per-chat character-identity/tag block, migrated automatically from the legacy visual-profile record
- a closed pose/expression catalogue, with deterministic selection by default
- fixed 16:9 camera scene planning and explicit scene-boundary checks
- swipe, edit, delete, duplicate-submit, and stale-image reconciliation
- view-gated generation: Cue only plans turns and generates images for chats whose Cue view is open; closing the view (or leaving the chat) aborts the in-flight image batch and marks it cancelled, opening the view plans the latest reply only when nothing current is stored, and reopening it resumes the stopped pictures of the current turn once the stopped request has returned, so a picture is never asked for twice at once (a stopped picture is never counted as done or shown as failed)
- one silent retry for a picture that failed for a passing reason (a timeout, a dropped connection, a busy provider: HTTP 408, 425, 429, 5xx); refusals, bad requests, missing credits and auth errors are reported at once and wait for Try again
- per-user and per-chat persisted continuity
- a settings tab, a user-selectable scene-image fit (Cover / Contain / Stretch / Original size / Scale down), ten built-in theme presets (Lumiverse, Golden hour, Boxed console, Paper novel, Midnight noir, Yamaku classic, Literature club, plus three stage layouts: Cinema — boxless subtitles over a dark gradient with spoken words in bold white; NVL — the turn's paragraphs stack as a full page over a darkened scene; Daylight — a bright stage with a white translucent box), and a shadow-DOM custom CSS contract that is always the final styling layer
- optional **sprite mode**: reusable character cut-outs (4, 8 or 12 expressions each) over reusable backgrounds, staged per paragraph, with a sprite library in settings (see [Sprite mode](#sprite-mode))
- an always-accessible **Back to chat** control that restores native Lumiverse

It targets Lumiverse staging `1.1.6`, audited at commit `33dfa9ee62999fa3e2567066ed5cdadf61635323`, and `lumiverse-spindle-types` `0.6.59`. System One needs a Lumiverse with Decision models (staging `1.2.5`, October 2026, or newer).

## Optional System One decisions

System One asks Lumiverse's default Decision connection. Set it up in Lumiverse, not in Cue: **Connections → Decision models**, add a connection (TypeSafe, OpenRouter or NanoGPT, with its key and a Jev model) and turn on **Set as default Decision connection**. Lumiverse keeps the key, URL and model; Cue sends only Jev's typed `state` and `questions` through `spindle.decisions`, which needs the `decisions` permission.

The **Connections** settings section has one switch, **Use System One for presentation and familiar scenes**, and under it the **Decision connection** line: the name and model of Lumiverse's default Decision connection, or what to set up in Lumiverse (no default connection, no key on it, the permission off, or a Lumiverse without Decision models). **Check again** looks again (turning System One on does too), and **Open Lumiverse Connections** closes Settings and opens Lumiverse's Connections drawer. **Compare** (log agreement with the story reader without changing the turn) is under **Advanced → Models and parameters** and saves as you change it. Whenever System One cannot answer, Cue uses its existing story reader; when a turn fails because of the setup, a Lumiverse notice says what to set up, once until System One answers again.

Cue no longer keeps a System One key, URL or model of its own. A config saved with them still loads (they are dropped), and the first Decision connection check deletes the key Cue stored before, so add the key once in Lumiverse instead.

**Compare** logs decision latency, input tokens, and speaker/expression agreement without changing the turn. **Use for presentation and familiar scenes** applies confident speaker, expression, and audio decisions. For replies of up to seven short paragraphs, Cue can reuse a known scene without calling the prose planner when Jev finds no scene or visual change. Longer replies use the story reader and split Jev's presentation questions into requests that fit the API limits. This setting is off by default. Jev also gets two small requests per reply: whether the reply starts in the same place as before, and whether each known character changed clothes in the whole reply. A confident "same" keeps the previous outfit and place even when the story reader describes them in new words (see [docs/SPRITE_MODE.md](./docs/SPRITE_MODE.md#outfit-and-place-continuity)). Without Jev, a text check keeps a reworded outfit.

## Image pipeline and identity

When System One is On and returns confident expression decisions, the picture limit applies to new renders after cache lookup. Cue checks expressions across the classified paragraphs, reuses compatible images without spending generation slots, and generates distinct missing images in paragraph order up to the limit. Repeated requests for the same missing image share its render. Other misses keep the current image; uncertain continuation paragraphs and repeated expressions do not force a swap. Jev currently classifies the first 24 paragraphs. Off, Compare, unavailable classifiers, and native card art retain their existing image-budget behavior.

Generated scene images come from the one built-in path: `src/backend/runtime/planner.ts`, then `src/backend/runtime/images.ts`, then the per-provider `AssetScheduler`. The sidecar planner proposes only scene boundaries, environments, and paragraph cues. It never supplies free-form pose, expression, or a prompt delta; those fields are emitted empty and ignored by the prompt compiler.

Every image shows exactly one centered protagonist composed from a stable identity/tag block and a pose suffix from a finite catalogue. The tag block is frozen per chat and is never auto-updated by a later turn. By default, pose is selected by a pure function of paragraph index and text; optional System One decisions can choose another pose from the same catalogue. The camera is fixed to a centered, eye-level, medium-wide 16:9 composition with the lower quarter clear for the dialogue surface.

**Image size.** Scene pictures are wide, so Cue asks for a landscape size. **Advanced → Image size** sets it for ComfyUI and SwarmUI in both modes: **Standard** 912×624 (the default) or **Upscaled** 1216×832. It saves at once and is hidden for NovelAI, which always gets 1216×832, its largest size that costs no Anlas (unless you pick another size under **Pictures → NovelAI → Image dimensions**; NovelAI's steps, guidance, sampler and seed are under **Advanced → NovelAI sampling**). A `width` and `height` in your **Image parameters (JSON)** win, so a workflow you sized yourself keeps its size. Other providers get no size from Cue.

**ComfyUI reference switch.** Without a reference image (reference anchoring off, no portrait yet, an idle sprite, a background plate, a key moment), Cue used to send only `denoise: 0.0`. That sets the IP-Adapter strength to 0, but the IP-Adapter still loads and runs. Optional: add a Boolean node that turns the IP-Adapter on/off (for example a switch between the IP-Adapter model and the plain model), map its value as **Custom** in the Lumiverse workflow setup, and give it a title with "IP-Adapter" or "reference". Cue turns it on only when it sends a reference. Without a reference, Cue turns it off and sends no `denoise: 0.0`. Cue sends the value in `comfyui_custom_fields`, together with your own `comfyui_custom_fields` (or `custom`) from **Image parameters (JSON)**; a value you set there for the same field wins. Without such a field nothing changes.

**NovelAI V5 reference inset.** NovelAI Diffusion V5 takes no reference image, so in sprite mode with reference anchoring on, Cue keeps a character's expressions close to its idle sprite another way (technique by "bequiet", arca.live): your browser places the idle picture in the left half of a 1216×832 canvas, NovelAI V5 inpainting (`nai-diffusion-5-full-inpainting`, prompt starting with `split screen`) repaints the right half, and the sprite is cut out of that half (608×832). It applies to NovelAI connections on a `nai-diffusion-5*` model, for every expression except the idle, which renders as before. Your steps, guidance, sampler and **Image parameters (JSON)** (including your own `rawRequestOverride`) still apply. If NovelAI rejects the request (for example the model name), Cue renders that expression the plain way and stops trying the inset for that connection and model until the backend restarts; a busy or failing NovelAI (for example 429 or 5xx) only fails that render, as any render, and the inset stays on; if the browser cannot draw the canvas, it renders the plain way too. A new idle sprite queues its inset expressions again. NovelAI V4.5 (Precise Reference) and other providers are unchanged. Details and a probe script to check it with your own key: [docs/SPRITE_MODE.md](./docs/SPRITE_MODE.md#novelai-v5-reference-inset).

The pipeline never mutates canonical chat messages. It writes only extension-owned projections: per-turn records, per-chat state, and the single-character visual-state identity record.

As with any generative system, image-provider speed and visual identity quality depend on the selected model, provider, and prompt settings. Cue does not promise a specific provider result.

RisuAI card greetings that pack several alternative scenes into one message are macro-resolved before planning, so only the selected scene is shown. Limitation: no host event fires when a scene picker in the chat is clicked, so a changed selection is picked up only when Cue is reopened, when state is requested again, through the Try again control on the waiting card (`vn_refresh`), or through Try again on a visible turn (`vn_retry_turn` re-resolves first and replans when the selection changed). Volatile macros such as `{{random}}`, `{{roll}}` or `{{time}}` in a message re-resolve on every check without counting as a new scene; a message whose host resolution fails keeps its stored turn.

## Sprite mode

Scene mode (the default) paints a full picture for each scene. That takes 20–50 s per picture, so Cue limits pictures per reply. **Sprite mode** pays for pictures once and then reuses them:

- **Character sprites.** For each character, outfit and image style, Cue makes a set of expressions. **Expressions per character** (**Advanced**, right after **Image size**; sprite mode only) sets the size: **4 (fastest)**, the default (idle, smile, sad, angry); **8** (adds laughing, surprised, embarrassed, smug); or **12 (all)** (adds crying, worried, thinking, scared). A feeling outside the set shows the nearest expression in the set, for example worried shows sad. An image you already have is always used, whatever the size. Changing the size deletes nothing; a bigger size makes the missing ones the next time the character appears. Each sprite is drawn on a white background with your image connection, then cut out in your browser.
- **Backgrounds.** One empty background ("plate") per place, time of day and weather.
- **Staging.** For every paragraph, Cue chooses who stands where, with which expression, motion, emote and light. Every paragraph can change expression, and there is no picture limit per reply.

**Turn it on.** Open the Cue settings tab, then **Pictures**. Keep **Generated illustrations**, and under **How the story is shown** choose **Character sprites**. It saves at once. **Pictures per reply** does not apply in sprite mode; Cue keeps your choice for scene mode.

**First-run cost.** The first time a character appears, Cue makes their set. The order is: the reply's background first, then the expressions the reply uses, one at a time in the order they appear, then the reply's key moment (if any), and only then the rest of the set. A new reply goes ahead of that rest. Rare expressions (in 12 only) are made last, when a reply needs them. Each new place needs one background. These are normal requests to your image connection, so the first replies cost about as much as scene mode. After that, the same character, outfit and style reuse their set in every chat. Generation runs only while a Cue view is open.

**Cut-out quality.** **Best** downloads an 88 MB segmentation model (ISNet-anime in half precision; 176 MB on GPUs without half-precision support, and a model downloaded by an earlier version is kept) once from Hugging Face. The browser keeps it, so later visits do not download it again. The download starts in the background with the first cut-out (or at once with **Download model**); the stage shows its progress, the first sprites are cut with **Basic** meanwhile, and they are cut again with the model as soon as it arrives. **Remove downloaded model** frees the space. **Basic** never downloads anything and removes the plain background without a model; edges can be rougher, mostly on white clothes and hair. A different model address goes under **Advanced → Models and parameters → Sprite cut-out model URL** (https only, saved when you leave the field). If your image workflow already removes the background and saves a transparent PNG (for example ComfyUI's **Remove Background** node), Cue keeps that transparency and skips its own cut-out. **Studio** (experimental) cuts with BiRefNet, the model ComfyUI's background removal uses, on your graphics card: closer cut-outs at about 0.8 s per sprite. It needs WebGPU with half-precision support and about 3 GB of graphics memory, and a model file (about 500 MB) you serve yourself, set under **Advanced → Models and parameters → Studio cut-out model URL** (see docs/SPRITE_MODE.md, "Studio cut-out"). It downloads in the background while sprites are cut with **Best**; those are cut again with Studio when it arrives. Where it cannot run (phones, devices under 8 GB of memory, no half-precision WebGPU), settings say so and sprites are cut with **Best**; if it fails on your device, it is not tried again until you press **Try Studio again**.

**Classifier staging.** Without System One, Cue stages from the story reader's plan: the speakers stand on stage, and expressions come from the cues. With **System One** on (**Connections**, with a default Decision connection in Lumiverse), Jev answers small choice and yes/no questions for each paragraph: who is present, which expression, motion and emote, how strong, which light. It also notices a place you have already visited, even when it is described differently, so the background is reused. These questions run in parallel and take well under a second. Uncertain answers keep the previous choice, so sprites do not flicker.

**Key moments.** Sprites cannot show everything: a kiss, a fight, someone sitting or running. Under **How the story is shown**, **Key moments** (sprite mode only) offers **Sprites only** (the default) and **Picture for a key moment**. With the second, Cue picks at most 1 paragraph per reply and paints a full scene picture for it with the normal scene-picture pipeline (same prompts, cache and image connection). Without System One, Cue picks a paragraph whose narration shows contact, a fight or a pose a standing sprite cannot show, or a new scene that opens with nobody on stage. With System One, Jev rates each paragraph that has a picture cue ("how important and visual is this moment" and "can a standing sprite show this?"), and Cue takes the top one above a threshold. When you reach that paragraph and the picture is ready, it crossfades in and the sprites fade out; the next paragraph brings the background and sprites back. Until the picture is ready, the sprites stay (Cue does not wait). Retrying the turn regenerates a failed picture and keeps finished ones; a failed picture never blocks the sprites. The setting applies from the next reply. Limit: the scene prompt describes the character, expression, held object and place, not the body pose, so the picture shows the moment's setting and mood more than the exact action.

**The library.** **Pictures → Sprite library** lists your characters (ready count out of the set size, 4, 8 or 12; every expression on a checkerboard with its status) and backgrounds. From there you can **Prepare sprites for this chat** ahead of time, **Regenerate** an expression or background, **Re-cut** a sprite from its original picture, and **Delete** a set or background (Cue asks you to confirm). The library is kept per user and bounded to the newest 64 sets and 128 backgrounds.

**Limits.** A change of image style (connection, model, prompt prefix or suffix, negative prompt) starts new sets. Until an expression is ready, the nearest ready one stands in. A character with nothing ready yet shows a "Preparing" badge instead of a sprite; when all of a character's images failed, the badge says so and its **Try again** makes them again (a cut-out that failed is redone from its render). v1 has no lip flap or blinking and no sprite for your persona. See [docs/SPRITE_MODE.md](docs/SPRITE_MODE.md) for the design.

**Who stands out.** The speaker steps forward a little (3% larger) and the others drop to half brightness (and blur by 1 px with **Blur characters who are not speaking**), but only while the speaker is on stage: narration, your own lines and a voice that is not on stage leave everyone bright. Characters fade in and rise a few pixels as they enter (0.15 s), slide to new places in 0.4 s and change expression with a 0.2 s cross-fade.

## Character size and outline

Pictures can be framed differently: a waist-up sprite, a close-up expression, a card's full-body picture. **Settings → Look → Character size** (sprite mode) draws every face at the same size, so a character's head no longer grows or shrinks between expressions or next to someone else:

- **Same face size, keep heights** (default): feet stay on the floor, so a tall character still stands taller.
- **Same face size, heads in line**: the taller characters also sink until every head is at the same height (nobody is lifted off the floor).
- **Off**: each picture is sized by its own height, as before.

**Face size** (15% of a standing character's height by default), **Largest zoom** and **Smallest zoom** (160% and 60%), and **Centre faces in their place** (100%: the face sits on the middle of the character's place) fine-tune it; **Default sizes** puts them back. A full-body picture never grows past the top of the screen. **Character look** also has **Outline colour** for the sticker outline (white by default). Check: `bun run test:sprite-size`.

## Stage feel

**Settings → Look** holds a few small touches. In sprite mode, **Character motion** has **Press a character to make it bounce** (on by default): clicking or tapping a character squishes it and it bounces back, and that click does not turn the page; clicking anywhere else, Enter or Space still does. Right after the character groups, **Stage feel** (both modes) has:

- **Click effect**: **Sparks** (default) shows a small burst of gold sparks where you click or tap; **Sparks + !** adds a little "!" with a pop sound; **Off**. Motion **Still** and the system's reduced-motion setting turn the sparks and the bounce off.
- **Interface sounds** (off by default) with its own volume: a soft tick as the text types and a pop on a "!" click, a character press, or a tap that changes a line or card on the waiting screen. They play alongside Choir's music and effects, but stay quiet while Cue or Choir reads the story aloud.
- **Inner voices**: lines spoken by a voice in a character's head (the skills from games like Disco Elysium, such as Logic or Inland Empire, are known already) dim everyone on stage and make the screen edges glow in the voice's colour for that paragraph. Add your own names here, separated by commas (for example `Conscience, The Ancient Reptilian Brain`).

The picture, the characters and the buttons can no longer be selected or dragged by mistake (a double-click no longer paints the browser's selection over the scene); the dialogue and History stay selectable.

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

## Opening card and waiting screen

Settings → Reading has two groups for how a reply opens and what shows while the next one is written.

**Opening card** (on for new installs). A new reply opens on a card: "Scene · Seiran Academy", the place in large serif type ("Classroom 2-B, Seiran Academy"), then its weather, time of day and length ("clear · after school · 7 paragraphs"), a gold rule that grows in, and a status line ("Preparing the scene…", then "Ready"). The card stays at least **Shown at least** (1.5 s by default, 0–5 s) and until the reply's first picture is ready or will not come, but never longer than 5 s, since the text can be read while pictures load. With **Start a new reply by itself** on, it then closes by itself; off, it says "Ready · tap to start" and waits. A tap, Enter, Space or Right Arrow starts reading; S starts and skips to Your turn. The first paragraph types, plays its effect and sound, is read aloud and enters History only once the card has closed. **Replay the opening card** shows it again and reads the reply from the start.

- **Use the card's own background picture**: a character asset named `bg`, `background`, `배경` or `backdrop` goes behind the opening card and the waiting screen. Without one, or with this off, the scene on the stage is used.
- **Show the place at the top left while reading**: a small "Location" label with the place, time and weather of the paragraph being read. It follows scene changes inside a reply and is hidden while the opening card or the waiting screen covers the stage.

**While you wait.** After you send, the stage shows a waiting screen until the next reply arrives. It has the status line ("Mira is writing the next scene…", "Setting the next scene…" while the scene is planned) and a "You sent" card. Choose a **Backdrop**:

| Backdrop | Looks like |
| --- | --- |
| Scene card (default) | The scene card on the card's background picture, words at the bottom left. |
| Tidy | A dark veil, "— Scene —" and the place centred, everyone's faces in rings. |
| Light loading screen | Pale blue stripes, a "Now loading…" banner, a rotating tip and a progress bar. |
| Cast introduction | A violet dark with the scene's name, everyone filling in from a silhouette. |
| Off | Only the status line, as before. |

…and what goes **On top**:

| Recap | Shows |
| --- | --- |
| Automatic (default) | A line-up for up to three characters, flashback cards from four. |
| Cast line-up | Everyone who was on stage at the end, side by side, with a speech bubble of one of their lines and how they said it ("Hops", "Angry", "Smile"). Tap a character: they bounce and say their next line, and their picture changes to the one of that line. The bubbles also change by themselves, one character at a time. |
| Flashback cards | One character at a time with their last line, their picture beside the card; tap for the next. |
| Scene film | The reply as a strip of cards scrolling by (it pauses under the pointer); tap a card to read the paragraph whole. |
| Off | Just the backdrop. |

Inner voices (Disco Elysium skills such as LOGIC or 논리) appear in the cards and the film in their family colour, without a picture. **Preview the waiting screen** opens Cue with the reply on the stage; tap away from the characters or press Escape to close it. With **Motion** on Still, or the OS "reduce motion" setting, everything shows without movement.

**Your turn.** The reply box has **Previous**, **From the start** and **Close**. Close (or turning off **Open the reply box when the reply ends**) leaves the last scene in view with a **Reply** button; a tap or Enter opens the box. While a reply is sent, the box stays and the button reads "Sending…". History's **Whole reply** lists every paragraph of the reply, the ones not read yet marked.

The layout is checked in a real browser on desktop and on a 393×851 phone: `bun run test:scene-flow` (screenshots in `.cache/scene-flow/`).

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
- The tags are display markup only. Cue removes them from planner and image prompts and from text sent to Choir for read aloud, so they are never spoken.
- The **Motion** setting (Look; config `effectIntensity`) covers text effects too: with **Full** (default) tagged words move, **Gentle** makes their motion smaller and slower, and **Still** (config value `off`) keeps their colours, glow and sizes without movement (and plays no scene effects). The OS "reduce motion" setting always behaves as Still for text. Settings saved with the old separate text-effects setting on "static" or "off" come back with Motion on **Still** ("off", plain text without colours, is no longer offered). History always shows effects Still.
- **Display regex rules** run before the tags are read, so a rule can add effects. For example, to make every "magic" shimmer: `/\b(magic)\b/gi => <rainbow>$1</rainbow>`.
- **Teaching the model.** Paste this into a character card, lorebook entry, or preset (Settings also shows it with a Copy button):

  ```text
  Text effects: in dialogue you may wrap a few words in one of these tags to style them in the visual novel:
  <shake> <tremble> <wave> <bounce> <rainbow> <glow> <pulse> <glitch> <whisper> <shout> <fade>
  Examples: "<shake>Get down!</shake>", "<whisper>don't tell anyone</whisper>", "<rainbow><wave>la la la</wave></rainbow>".
  Use them rarely (at most one or two per reply), only for strong moments, wrap only the words that need it, and always close every tag.
  ```

Custom CSS can restyle effects through `[data-vn-text-fx="<id>"]`, the per-letter `[data-vn-text-fx-ch]` spans (index in `--vn-ch`), and the tuning properties `--vn-text-fx-amp`, `--vn-text-fx-speed`, `--vn-text-fx-glow`, `--vn-text-fx-rainbow-mix`, `--vn-text-fx-rainbow-1` … `-7`, and `--vn-text-fx-split-a` / `-b`.

## Music and sound pack

`cue-audio-pack.zip` holds 24 music tracks and 24 sound effects made for Cue: one clear mood or sound per file (`bgm_romance_sweet`, `bgm_tension_suspense`, `sfx_door_knock`, `sfx_heartbeat`, ...), music loudness-matched, sound effects trimmed and levelled. Every file is CC0 or CC BY; `CREDITS.md` inside the zip lists each source and credit line, so keep it with the pack when you share it.

To install, unzip it, open the **Cue** settings tab, **Sound → Music library → Import music folder…**, choose the `cue-audio` folder, then **Check library** (24 BGM / 24 SFX). Cue offers System One the first 24 music tracks and the first 24 sound effects sorted by path, so remove an older pack from `data/extensions/visual_novel_preview/storage/audio/` first. **Check library** rescans the folder, so files added or removed there by hand show up without a restart.

### Sound from Choir

With the Choir companion extension installed, Choir provides the sound instead of the pack whenever both have sound. While Choir reads each paragraph aloud, it chooses sound effects and looping ambience from Freesound and background music from Kevin MacLeod's incompetech catalog. Ambience and music keep playing into the next paragraph. While Choir has sound on in the chat (music, or effects and ambience with a Freesound key) and reads here (Cue's read aloud, or Choir's own Auto), Cue's own pack stays quiet, so the two never play over each other. Otherwise, for example with Choir's sound switched off, the pack plays as before. Turn Choir's sound effects, ambience and music on or off, enter the Freesound API key and set the volumes in Choir's mixer. The credit for the current track ("Title" Kevin MacLeod (incompetech.com) · CC BY 4.0) shows under the read-aloud controls.

## Run the standalone preview

```powershell
bun install --frozen-lockfile
bun run serve:demo
```

Open `http://localhost:4173` for the scene demo (Your turn with suggested replies; `?suggestions=off` shows the reply box alone).
Open `http://localhost:4173/?sprites` for a short sprite-mode scene with the fixture sprites (also takes `&preset=<theme preset id>` and `&suggestions=off`).

## Install into a local Lumiverse staging checkout

Build the bundles:

```powershell
bun run verify
```

Copy this directory, including `dist`, into:

```text
data\extensions\visual_novel_preview\repo
```

Enable the extension and grant its requested permissions in Lumiverse. Enter from **Cue** in the chat header, **Composer Extras → Open Cue**, or **Open Cue** at the top of the **Cue** settings tab. The settings tab controls connections, generation limits, planning context, prompts, scene-image fit, the visual-novel theme preset, and the custom CSS layer.

Opening an existing chat bootstraps its latest assistant reply automatically. A new empty chat opens at **Your turn**: write the first message in the reply box and the story starts there.

The overlay feature-detects the staging component override API. If that API is absent, it leaves native chat intact and reports that the build is unsupported.

## Development

### Pinned status cards and inline HTML

Open **Panels** at the top left of Cue. The button shows only when the chat has something for it: a card in the reply so far, a pinned card, a status rule or a SimTracker card to capture. Without any, **Advanced → Panels → Open Panels tools** in the **Cue** settings tab opens Cue with the drawer on its advanced tools. Newly planned replies expose complete HTML/SVG blocks when their paragraph is reached. Choose **Pin this card** for a saved snapshot, or **Keep it updated** for a uniquely identified status source. Drag the title, drag the lower-right resize handle, or use arrow keys on the title; Shift + arrows resizes. Positions and pins are stored per chat in this browser. **Reset positions** recovers misplaced cards; **Unpin all** removes saved cards.

SimTracker is optional. Panels shows available cards from the current reply first; **Advanced tools** holds SimTracker capture, pasted HTML, and status template rules. Opening or closing advanced tools does not disable saved rules or pinned updates.

Settings are split into sections — **Reading**, **Look**, **Pictures**, **Sound**, **Voice**, **Connections** and **Advanced** — shown as a side rail on wide screens and a tab strip on narrow ones; the search box at the top jumps to any setting, and the last open section is remembered. Every setting saves as you change it; text fields save when you leave them (or press Ctrl+S). After an **Advanced** change (prompts, story-reader context, model overrides, JSON parameters, text filtering, custom CSS) **Undo** is offered for a few seconds. JSON and URL fields save only when they are valid: an invalid one keeps its text, is marked, and the section shows how many fields are not saved.

**Settings for one character.** While a chat with a character card is open, the top of Settings shows **Settings for: All characters / <name> only**. Choose **<name> only**, and what you change is saved for that card alone: every chat with it uses it, every other card keeps the shared settings. That covers the look and reading settings: theme and layout, pictures or sprites and key moments, picture fit, text size and speed, motion and text effects, custom CSS and display regex rules, the reply box, opening card, place label and waiting screen, character motion, look and size, and stage feel. Settings every character shares (connections, where pictures come from and their models and prompts, sound, voices, System One, storage and logs) are dimmed there with a note. A setting the character has its own value for is marked, with **Use shared** beside it; **Use shared settings for <name>** (click twice to confirm) drops them all. A group chat or the home screen has only the shared settings, and Settings goes back to **All characters** whenever another chat opens. Saves from before this keep working exactly as they were.

For a regex status template, expand **Add status template rule**, enter the pattern without slash delimiters, flags, and the multiline HTML replacement. Captures through `$36` and named captures are supported and escaped. Host macros in replacements are resolved through Lumiverse without committing variable changes. Use **Refresh live sources** after changing language variables. Rules operate on the first 200,000 source characters and reveal at the end of the turn. Multiple matches offer snapshots only, to avoid following the wrong character.

Rules do not change filtering. **Ignored tags** hides whole blocks from dialogue and image planning; **Display regex rules** affects dialogue only. Recognized ignored status tags remain available as plain-text cards. Complete HTML blocks are extracted separately before narrative planning. Previously cached plans may not contain panel sources.

**Skip non-story blocks** (Advanced, text filtering, on by default) keeps what is not story out of the dialogue box, speech and the plan: status and tracker lines, the model's reasoning or planning, recaps, choice menus, out-of-character notes, profile sheets and image placeholders. It works line by line, also inside a paragraph. Fixed rules remove, without any request, comments, reasoning tags, form controls, hidden elements, placeholder lines and rules, and move bracketed or braced field lines (`[Mood: tired | Trust: 40%]`, `{Date: … | Time: …}`) to a card; `<tracker>`/`<status>`-style elements become cards. Formatting the dialogue box renders (`<font>`, `<span>`, `<ruby>`, `<br>`, text effects, …) and code stay as written. One small check through the story reader's connection then labels each remaining line story or not (Choir's line check prompt; temperature 0 unless the story reader's parameters set one). It runs alongside the story reader, so the first paragraph is not held back unless the check is the slower request. The removed lines stay readable in a **Not story** card in Panels (**Keep it updated** follows it from reply to reply); reasoning, scripts and form controls are dropped. The story reader still reads the carded status lines (place, time, outfit) in a block of their own. A reply with no story lines shows one line pointing to Panels. Answers are cached per chat for the exact lines checked, so a retry or reopen costs nothing; earlier replies reach the story reader with their cached labels applied. If the check fails or the provider refuses the reply twice (the second try sends only line beginnings), the reply is shown whole, as with the setting off; a connection whose two tries both fail on three replies in a row is not asked again for five minutes.

Frames allow CSS layouts, SVG drawings, and CSS-only checkbox/radio interactions, but no scripts or navigation. Remote images/fonts are blocked unless explicitly enabled for that frame. A content update rebuilds that card's frame; other cards retain their state. Followed values from previous turns are hidden until the source appears in the current turn. Snapshot pins deliberately remain visible.

For stock SimTracker, let its card render in normal chat, open Cue, open **Panels** (it shows for the card), then choose **Capture SimTracker snapshot** under **Advanced tools**. This captures markup and checkbox state, not JavaScript behavior. Live updates require the companion adapter in [integrations/simtracker-vn-bridge.ts](./integrations/simtracker-vn-bridge.ts), wired to SimTracker's own template output. It is not installed into SimTracker automatically. The adapter must return only the requested chat/message/swipe's cards, call `refresh()` after updates, and `destroy()` on teardown. No DOM nodes are moved between extensions.

### Game engine extensions

A rules engine such as Warp can play alongside Cue:

- **Moves on the stage.** Its choices (with success odds) appear as chips at **Your turn**, above the suggested replies and the reply box. Picking one shows it as your line and hands it back to the engine, which rolls and sends the message. The contract lives in [src/frontend/host/game-bridge.ts](./src/frontend/host/game-bridge.ts): the engine sends `vn-game-state-v1` (`{ version: 1, provider, chatId, choices: [{ id, label, group?, detail?, odds? }], busy? }`), VN answers picks with `vn-game-pick-v1` and asks for a fresh state with `vn-game-request-v1`. Up to 12 moves are shown.
- **Live status cards.** Providers named `warp` (as well as `simtracker`) may publish **Keep it updated** cards over the panel bridge above.
- **Moods for expressions.** An engine may leave `metadata.vn_hints = { moods: { Name: "flustered" }, notes: [...] }` on a reply or on the player message it answers. The planner reads it as data and prefers expressions that match.

Browser regression checks:

```powershell
bunx playwright install chromium
bun run test:panels
bun run test:character-settings
```

```powershell
bun run test
bun run typecheck
bun run build
bun run build:demo
```

See [SPEECH.md](./SPEECH.md) for read aloud (off by default, voiced by the Choir extension), its contracts, and its truthful limitations.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the viability decision, staging host contract, image pipeline, deterministic single-character identity, data ownership, state machines, and remaining preview limits.
