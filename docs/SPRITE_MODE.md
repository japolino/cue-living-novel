# Sprite mode — design

Status: v1 implemented (October 2026, Cue 1.8.0-beta). `src/shared/sprites.ts` holds
the shared types; `src/protocol.ts` holds the messages. "Implementation notes"
at the end records the concrete limits and numbers.

## Why

Scene mode paints a full 16:9 picture per cue: 20–50 s per picture, so Cue
rations pictures (at most `maxImagesPerTurn`). Sprite mode pays for pictures
once and reuses them:

- a **sprite set** per character + outfit + image style: 4, 8 or 12
  expressions (`spriteExpressionCount`, default 4; 12 is the whole hot set
  `SPRITE_HOT_SET`), generated on a plain white background and cut out in
  the browser;
- a **plate** per place + time of day + weather: an empty background
  ("scenery, no humans").

After that, staging a reply is a *choice* problem — who stands where, with
which expression, motion, emote and light — which the story reader or the
System One classifier (Jev: choice / score / yes-no, 70–500 ms, parallel
questions) answers per paragraph at almost no cost. Every paragraph gets its
own expression and there is no picture cap.

## Config (src/config.ts)

| Key | Values | Default | Saves |
|---|---|---|---|
| `presentationMode` | `"scene"` \| `"sprites"` | `"scene"` | at once (everyday) |
| `spriteCutout` | `"best"` (model) \| `"basic"` (no download) | `"best"` | at once (everyday) |
| `spriteModelUrl` | https URL | ISNet-anime on Hugging Face | Advanced (Apply) |
| `keyIllustrations` | `"off"` \| `"few"` (≤ 1 per reply) | `"off"` | at once (everyday, sprite mode only) |
| `spriteImageSize` | `"standard"` \| `"upscaled"` | `"standard"` | at once (everyday, both modes) |
| `spriteExpressionCount` | `4` \| `8` \| `12` | `4` | at once (everyday, sprite mode only) |

### Image size (`spriteImageSize`)

Applies to providers that take a width and height (ComfyUI, SwarmUI), in
sprite mode and in scene mode:

| Setting | Sprites | Plates | Key moments | Scene pictures |
|---|---|---|---|---|
| Standard (default) | 624×912 | 912×624 | 912×624 | 912×624 |
| Upscaled | 832×1216 | 1216×832 | 1216×832 | 1216×832 |

Standard is fast and fits small GPUs: on an RTX 5060 8 GB (≈ 2.7 GB free
VRAM) a 624×912 sprite takes ≈ 11 s; at 832×1216 the model spills out of
VRAM and a sprite takes 57–180 s. A sprite draws ≈ 900 px tall on a 1080p
stage, so 624×912 looks fine. Upscaled is sharper but slower.

NovelAI ignores the setting: it always gets its largest size that costs no
Anlas on Opus (≤ 1024×1024 = 1,048,576 pixels), 832×1216 for sprites and
1216×832 for plates, key moments and scene pictures. Providers that take no
size get none. `spriteImageSizeFor` / `sizeParameters` in
`runtime/image-size.ts` hold the rule (`sprites/prompts.ts` re-exports them).

Scene pictures (`runtime/images.ts`, `sceneSizeParameters`): before this,
scene requests carried no size, so a ComfyUI workflow rendered at its own
saved size (often portrait) while the stage shows a 16:9 picture. Now the
landscape size goes under the user's "Image parameters (JSON)": a `width` or
`height` there (or a `resolution` on NovelAI, which the NovelAI "Image
dimensions" control writes) wins, and Cue then adds no size. Sprite, plate and
key-moment requests keep their rule (their size goes over the user's
parameters). The scene size is part of the scene-cache request identity;
other providers add nothing, so their keys keep their bytes.

The size is not part of the style key, so changing it does not start new
sets: images already made stay, and only new or regenerated images use the
new size. A set can mix both sizes; both have the same aspect, and the stage
sizes a sprite from its normalized bbox, never from its pixel size.

### Expressions per character (`spriteExpressionCount`)

How many expressions Cue makes ahead for each set. Settings: "Expressions
per character", right after "Image size": 4 (fastest) / 8 / 12 (all). A
missing or unknown value is 4.

| Size | Set (generation order) |
|---|---|
| 4 (default) | idle, smile, sad, angry (`SPRITE_SET_4`) |
| 8 | idle, smile, laughing, sad, angry, surprised, embarrassed, smug (`SPRITE_SET_8`) |
| 12 | the hot set: the 8 + crying_with_eyes_open, worried, thinking, scared |

Mapping: any catalogue id goes to its 12-set fallback
(`SPRITE_EXPRESSION_FALLBACK`), then to the 8 or 4 set
(`SPRITE_REDUCE_TO_8`, `SPRITE_REDUCE_TO_4`; `spriteSetExpressionFor`):

| 12-set id | 8 | 4 |
|---|---|---|
| idle, smile, sad, angry | same | same |
| laughing | laughing | smile |
| crying_with_eyes_open | sad | sad |
| surprised | surprised | idle |
| embarrassed | embarrassed | smile |
| worried | sad | sad |
| thinking | idle | idle |
| smug | smug | smile |
| scared | surprised | sad |

Why these choices: in 4, "surprised" goes to idle, not smile, because a
smile reads as joy on a shocked or startled line. "Scared" goes to
surprised in 8 (the face is close) and to sad in 4 (fear is closer to
distress than to calm).

Rules:

- The planner and System One may still pick any expression; the mapping
  handles it. System One's "cheap" expressions are the active set: an
  answer outside it needs the rare-expression confidence, else the set's
  stand-in is used.
- Display (`bestAvailableExpression`, every size): the first ready image of
  `spriteExpressionChain` (the id, its 12-set fallback, its 8-set and 4-set
  stand-ins), else idle, else any ready image. So an image that exists is
  always used (an old "surprised" shows in 4 mode).
- Generation: for each actor, the first id of the chain that already
  exists means nothing to make; else the first id in the active set is
  made. Rare expressions are made on demand only in 12.
- Changing the size deletes nothing. A smaller size puts queued work outside
  the set back to "missing" (no image is lost). A bigger size makes the
  missing ones as fill-in the next time the set is used.
- The size is not part of the set key (`spriteSetKeyFor`).
- Views: a set lists the active set (missing ones too), then other images
  that exist (`spriteSetListing`). Ready counts ("2/4 ready", the badge
  "Preparing Mira 0/4") count the active set (`spriteSetReadyCount`).
  `SpriteTurnView.expressionCount` carries the size (absent: 12).
- "Prepare sprites for this chat" queues the active set. "Regenerate set"
  redoes the active set and the images that exist.

Scene mode is unchanged. In sprite mode no scene-image jobs run, except one
per reply for a key moment when `keyIllustrations` is `"few"` (see "Key
moments"); the planner still plans scenes, environments, speakers and cues
(they feed staging).

## Data flow

```
assistant reply
  -> planner (+ System One presentation, unchanged)          [existing]
  -> TurnPlan
  -> buildSpriteStaging(plan, ...)  => plan.spriteStaging      [backend: staging]
       classifier (Jev) when configured, else deterministic from the plan
  -> ensureForStaging(staging)                                  [backend: sprites]
       turn work ("visible"): the turn's plates and needed expressions
       then key moments, then rare expressions ("next", 12 only) and the
       rest of the set ("background"); see "Order of work"
  -> turnView(record) adds `sprites: SpriteTurnView`           [backend: sprites]
  -> vn_turn                                                    [frontend: stage]

sprite job:  prompt -> image gen (portrait) -> imageId
             -> vn_sprite_cut {requestId, imageId}  ---------->  frontend cut service
                                                                  fetch /api/v1/images/<id>
                                                                  cutSprite() (ISNet + flood fill)
             <- vn_sprite_cut_result chunks (PNG base64) ------
             -> spindle.images.upload(...) -> cut image id/url
             -> library: status "ready", bbox
             -> vn_sprite_update {setKey, image}  -------------->  stage + settings
plate job:   prompt -> image gen (landscape) -> ready -> vn_plate_update
```

The backend cannot read image bytes (`spindle.images.get` returns a URL), so
the logged-in frontend does the fetch and the cut, exactly like reference
images (`vn_reference_fetch`). Pending cuts are re-sent when a Cue view opens.

## Library (backend, per user, cross-chat)

Stored with `spindle.userStorage` (one JSON index, bounded: newest 64 sets,
128 plates). Keys:

- `spriteSetKeyFor({ name, identity, attire }, styleKey)` — same character,
  outfit and style in another chat reuses the set.
- `plateKeyFor({ location, timeOfDay, weather }, styleKey)`.
- `styleKey` = hash of the image connection, model override, prompt prefix,
  suffix, negative, NovelAI quality toggles, and a sprite prompt version.
  A style change starts new sets.

Each sprite image: status (`SpriteImageStatus`), raw image id, cut image id +
URL, bbox, size, error, attempts. Failed images can be regenerated; a cut can
be redone (`recut`) from the raw image.

Generation runs only while a Cue view is open for the user (same rule as
scene mode), through the existing per-provider scheduler and concurrency.

### Prompts

- Sprite: style prefix + identity tags + attire + expression suffix
  (`POSE_EXPRESSION_CATALOGUE`) + sprite framing (`SPRITE_FRAMING_TAGS`) +
  style suffix. Negative: style negative + `SPRITE_NEGATIVE_TAGS`. Portrait
  size where the provider takes a size (`spriteImageSize`; NovelAI always
  832×1216). One shared seed per set where the provider takes a seed, and
  the set's `idle` render as reference image where reference anchoring is on
  and supported, for consistency (see "Seeds, reference strength and the
  duplicate check").
  - Framing (prompt version `sprite-prompt-v2`): `solo, standing, centered,
    front view, straight-on, facing viewer, looking at viewer, cowboy shot,
    simple background, white background, no shadow`. Negative add-on:
    `scenery, background, shadow, drop shadow, gradient background, multiple
    people, text, multiple girls, 2girls, multiple views, split screen,
    border, from below, from above, dutch angle, cropped, out of frame`. This
    is variant V2 of the October 2026 ComfyUI tests. On idles alone (F2:
    Anima, 624×912, 3 characters × 4 seeds) it turned low-angle or tilted
    figures from ≈ 12/18 into ≈ 3/18. On whole sets (idle + angry, laughing,
    smug at reference strength 0.5, 3 characters × 3 seeds) it gave 0/27
    doubled expressions vs 3/27 for the old framing, and each set keeps one
    pose with only the face changing. A variant with a plain-language
    sentence ("The whole character is centered in the frame, seen straight on
    at eye level, with empty white space on both sides") and `feet out of
    frame` gave more side margin on idles, but on whole sets it made small
    full-body figures, more doubled expressions and large background
    creatures, so it is not used. Weights, if added, survive every syntax:
    ComfyUI `(tag:w)`, NovelAI V4+ `w::tag::`, legacy NovelAI braces. Still
    open: monster identities (`hellhound`, `slime girl`) sometimes draw a
    beast, pattern or text behind the figure (≈ 2–3 of 9 sets), and some
    seeds give a face close-up.
  - Skin colour: in sprite identities a non-natural skin colour tag (`blue
    skin`, `light green skin`, `purple_skin`…) not already weighted gets
    weight 1.15 (`weightSkinColourTags`); natural tones (pale, fair, dark, tan,
    brown, light, white skin) and `colored skin` stay plain. Small evidence
    (N = 4 seeds): `(blue skin:1.2)` moved a slime girl's median hue from teal
    163° to blue 191°.
- Plate: style prefix + location, time of day, weather, description +
  `scenery, no humans, detailed background, wide shot` + style suffix.
  Negative: style negative + `1girl, 1boy, people, person, character,
  text`. Landscape size (`spriteImageSize`; NovelAI always 1216×832).

### Seeds, reference strength and the duplicate check

Findings of the October 2026 ComfyUI tests (394 images): an extra figure
(two copies of the character side by side) follows the **seed**, not the
reference image. With the seed of a doubled idle, 13 of 16 expressions were
doubled too, even with a clean reference; with another seed 0 of 20, even
with the doubled idle as reference. Defects copy the same way (a black
frame: 4/4 at the same seed, 0/16 at another). The shared seed is still
wanted: it keeps one pose across the expressions.

- **Seeds.** First renders of a set use the set's shared seed
  (`StoredSpriteSet.seed`, round `seedRound`, `spriteSetSeedFor`). An image
  with `ownSeed` (after a failure, a single-expression regenerate or an
  automatic retry) uses `spriteSeedFor(setKey, attempts)`. Each image
  records the seed of its current render (`seed`).
- **Reference strength.** ComfyUI sprite expressions default to strength
  0.5 (`SPRITE_REFERENCE_STRENGTH`, sent as `denoise`, which the workflow
  maps to the IP-Adapter weight) when the user set neither
  `imageParameters.referenceStrength` nor `denoise`. 0.5 holds identity and
  outfit and copies less pose and fewer defects than 0.7; at 0 (no
  reference) the outfit drifts and duplicates are frequent. Scene images
  keep 0.7; NovelAI is unchanged.
- **Duplicate check (browser).** The cut-out kernel (`figureCheck`) checks
  the cut-out alpha: mask = alpha > 127; in the rows from 10% to 60% of the
  height, a row is split when it holds at least two opaque runs at least 25%
  of the width wide; the image has two figures when at least 40% of the rows
  are split. It travels as `twoFigures` in the cut meta (absent from older
  frontends). On the test set: precision 0.95, false-positive rate 1%,
  recall 0.55 (it finds figures standing apart, not overlapping groups or
  grids). It is a cheap retry trigger, not a guarantee.
- **Acting on it (backend).** A fresh render flagged by its first check is
  dropped (its cut is not uploaded) and rendered again once
  (`autoRetried`):
  - an expression with its own new seed;
  - the idle with a new set seed (`seedRound` + 1); every expression that
    already rendered, or is rendering, with the old set seed is queued again,
    so the set keeps one pose and the new idle as its reference.
  A flagged retry is kept and shown; the Sprite library says "may show two
  figures" and Regenerate draws a new one.
- **Waiting for the idle's check.** With anchoring, expressions already
  wait for the idle render; they now also wait for its first check (the
  cut-out), at most `IDLE_CHECK_WAIT_MS` (25 s) from the render, so a slow or
  closed browser cannot stall the queue (the service re-pumps when the wait
  runs out). The idle's cut goes first among pending cuts. An automatic
  retry of the idle is not waited for (its result is kept anyway). Without
  anchoring nothing waits; a flagged idle then re-queues the expressions
  made with the old seed.
- **User regenerate.** Regenerating the idle (alone or with the whole set)
  draws a new set seed: expressions not made yet use it, existing ones stay;
  a whole-set regenerate gives every expression the new seed. One other
  expression alone gets its own new seed, as before.

## Order of work (backend, `sprites/jobs.ts`)

One scheduler per user runs sprites, plates and key moments with the
provider's concurrency. Work goes to the provider only when a slot is free,
so the order is decided at each start:

1. **Turn work**, in reading order of the latest turn (`state.need`: the
   first paragraph that needs each item):
   - the opening plate is the very first job; a later plate goes before the
     sprites needed at its paragraph;
   - then the expressions the reply uses, one at a time, by first
     appearance; with reference anchoring a character's idle comes first.
   While an item waits for its idle (or the idle's two-figure check), items
   needed later wait too (one at a time). The wait is at most
   `IDLE_CHECK_WAIT_MS` (25 s).
2. **Key moments** (`runKeyMoments`): after the turn's plates and needed
   sprites are generated (none queued, waiting or running). They are turn
   content too, so they go before the fill-in.
3. **Rare expressions** (12 only) and then the **fill-in** (the rest of the
   set, the turn's characters in order of appearance): only when 1 and 2
   have nothing queued, waiting or running. This includes the gap while an
   idle's two-figure check is pending.

A newer turn replaces the reading order, so its work goes ahead of every
fill-in not started yet; an image already generating finishes. Work an
older turn needed and did not start keeps its priority, after the new turn's
work. A flagged idle re-queues the expressions made with the old seed as turn
work when the latest turn needs them, else as "next".

Lunch scene (3 characters, 29 paragraphs, one plate, anchoring, no key
moment; `bun scripts/sprite-turn-order.ts <stage-data.json>`):

| Size | Plate | Needed sprites | Rare | Fill-in | Total |
|---|---|---|---|---|---|
| 4 | 1 | 8 | 0 | 4 | 13 |
| 8 | 1 | 11 | 0 | 13 | 25 |
| 12 | 1 | 11 | 4 | 25 | 41 |

## Staging (backend)

`SpriteStaging` (stored on `TurnPlan.spriteStaging`): `cast`, `plates`, and
one `SpriteParagraphStage` per paragraph: up to `MAX_SPRITE_ACTORS` actors
(character key, catalogue expression id, slot, facing, focus, motion, emote,
intensity), the plate key, and the light preset.

- **Deterministic** (no classifier, or classifier failure): actors are the
  paragraph speakers that are cast members, kept on stage while their scene
  lasts; slots by order of appearance (1: center; 2: left, right; 3: left,
  center, right); focus on the speaker; expression from the cue's
  `poseExpressionId` or the deterministic selector; light from the scene's
  time of day / lighting words; motion and emote "none" except simple,
  conservative cues.
- **Classifier** (System One on, key saved): one request per 7 paragraphs,
  questions in parallel. Per paragraph and cast member: present (yes/no),
  expression (choice, `keep_current` first — Jev leans to the first option),
  motion and emote (choice, `none` first), intensity (score 1–5). Per scene:
  light (choice), and place reuse (choice among the user's known plates,
  `new_place` first) so a revisit reuses its plate even when worded
  differently. Low-confidence answers keep the previous value (no flicker).

## Key moments (sprite mode, `keyIllustrations: "few"`)

Sprites cannot show sitting, running, kissing, fighting or a reveal. A few
paragraphs per reply (`KEY_ILLUSTRATION_CAP`: off 0, few 1) get
`illustrate: true` on their `SpriteParagraphStage` and are shown as a full
scene illustration: the ordinary scene-image job of that paragraph's cue.

- **Choice** (`src/backend/runtime/sprites/key-moments.ts`). Only paragraphs
  with a paintable cue (budgeted `visualCues`, then reuse-only `cacheCues`;
  an unresolved identity is skipped) qualify. Deterministic rule, narration
  only (quoted speech ignored, negated verbs ignored): contact or a fight
  (kiss, hug, embrace, fight, punch, carry him…) ranks 3; a pose a standing
  cut-out cannot show (sit, kneel, lie down, run to, leap over, dance, fall
  to her knees…) or a `wielding` cue action ranks 2; a scene's first
  paragraph with nobody on stage ranks 1. The strongest wins, earliest on
  ties, within the cap. Classifier: per qualifying paragraph a `score`
  question (5 levels, "ordinary" first) and a `noul` "can a standing sprite
  show this?"; a level ≥ 3 with yes ≤ 0.5, or level 4 with yes ≤ 0.6
  qualifies (score confidence ≥ 0.5); top level first, then the lowest yes.
  When no score answer is confident, the deterministic rule decides.
- **Jobs** (controller). Planning in sprite mode creates the scene-image job
  of each flagged cue (`createAssetJobs`), and `startAssets` runs the normal
  pipeline on a plan narrowed to those cues (`keyIllustrationPlan`: no
  reuse-only candidates, no classifier budget), so prompts, scene cache,
  scheduler, concurrency and view gating are the scene-mode ones. The turn
  record is marked `settingsSnapshot.presentationMode = "sprites"`; scene
  mode replans such a turn. Retry keeps finished pictures and regenerates
  the rest (cache bypassed); reusing the stored turn (same reply processed
  again) resumes unfinished ones.
- **View**. The jobs stay in `TurnView.assets`; `TurnView.sprites.illustrations`
  mirrors them (`SpriteIllustrationView`: paragraph, job, `pending` /
  `ready` / `failed`, URL). When a job finishes or fails the backend re-sends
  the same turn (`vn_turn`), which the host applies as a same-turn update.
- **Stage**. On a paragraph with `illustrate` and a ready picture, the stage
  paints it through the scene layers (request id `illustration:…`, alt
  "Illustration for paragraph N") and, once it is on screen, fades the
  sprite layer out (350 ms, Web Animations, none with reduced motion or
  effects off); the staging still applies underneath. The next paragraph
  without the flag brings the plate (crossfade) and the sprites back; with
  no ready plate the picture is cleared. A pending or failed picture never
  hides the sprites.

## Stage (frontend)

Layers inside the stage root, back to front: plate (the existing scene image
layers, crossfaded) → ambient overlay (behind sprites) → `[data-vn-sprites]`
(one `[data-vn-sprite]` per actor) → ornaments, fx, dialogue.

- Slot layout for 1, 2 or 3 actors; sprites bottom-anchored, sized from the
  stage height and the cut-out bbox; slot changes animate.
- Expression change: crossfade between two image layers per actor.
- Focus: the speaker is bright and on top; others dim slightly.
- Motion and emotes: CSS/inline SVG, scaled by intensity, respect effect
  intensity and reduced motion. Idle breathing and a small talking bob while
  the focused speaker's line types out.
- Light: CSS filter presets per `SpriteLight`.
- A set with nothing ready shows no sprite and a status badge
  ("Preparing Mira 0/4"; the total is the set size); an unready expression
  shows `bestAvailableExpression`.
- Previous/History navigation re-applies the paragraph's stage.

## Settings (frontend)

Presentation mode control; image size (Standard / Upscaled, both modes:
scene pictures use the landscape size); expressions per character (4 / 8 / 12, sprite mode only); cut-out quality; model status (absent /
downloading / ready / unsupported) with Download and Remove; a sprite library
gallery (sets with their expressions on a checkerboard, plates) with Prepare
for this chat, Regenerate, Re-cut, and Delete; the model URL under Advanced.

## Cut-out (frontend)

Validated by the bake-off (anime line art and lineless painterly styles):
ISNet-anime mask → border flood fill over background-coloured pixels (mask >
0.7 guards against leaks) → enclosed near-background components whose mean
mask < 0.5 become background → separate components whose mean mask < 0.3
are dropped (brush specks) → defringe (un-mix the background colour from the
edge band) → duplicate check on the alpha (`figureCheck`, see "Seeds,
reference strength and the duplicate check"). The background colour is the
median of the image border.
"basic" quality skips the model. The model is downloaded once from
`spriteModelUrl` and cached in the browser; onnxruntime-web is loaded lazily
(WebGPU, else WASM) so the frontend bundle stays small.

## Implementation notes (v1)

Code map:

| Area | Files |
|---|---|
| Shared contract | `src/shared/sprites.ts` |
| Staging | `src/backend/runtime/sprite-staging.ts`, `system-one-sprites.ts` |
| Library, prompts, jobs, cut bridge, views | `src/backend/runtime/sprites/**` |
| Controller hooks | `src/backend/runtime/controller.ts` (`buildTurnView`, sprite request handlers) |
| Cut-out | `src/frontend/sprites/cutout/**` (`kernel.ts` is the DOM-free algorithm), `cut-service.ts` |
| Stage | `src/frontend/stage/sprite-layer.ts`, `src/frontend/theme/sprite-css.ts`, VnStage sprite API |
| Settings | `src/frontend/settings/sprite-library.ts`, sprite controls in `panel.ts` / `model.ts` |
| Browser checks | `bun run test:sprite-stage`, `bun run test:sprite-cutout` |

Classifier staging:

- At most 4 cast candidates per paragraph. Expression options: `keep_current`, the
  12 hot-set ids, then 42 curated rare catalogue ids (the same at every set
  size; the mapping handles the answer).
- Thresholds (`SPRITE_THRESHOLDS`, calibrated, see "Calibration"): present ≥ 0.75
  adds and ≤ 0.4 removes; keep ≥ 0.2; hot-set expression ≥ 0.15; rare
  expression ≥ 0.2, else its hot-set fallback (a rare id costs one
  generation; with 4 or 8, any id outside the set needs 0.2, else the
  set's stand-in is used); motion ≥ 0.8 and emote ≥ 0.75 (a confident `none` does not
  erase an explicit text cue); intensity ≥ 0.7; light ≥ 0.35; place reuse
  ≥ 0.7 (at most 96 known plates offered). Key moments
  (`KEY_MOMENT_THRESHOLDS`): score confidence ≥ 0.5, level ≥ 3 with
  standing yes ≤ 0.5 or level 4 with yes ≤ 0.6, interaction ≥ 0.4.
- Requests: ≤ 7 paragraphs and ≤ 60,000 bytes per body; all batches in
  parallel; up to 105 paragraphs classified (later ones keep deterministic
  staging); 8 s timeout; one retry on 429/529; a failed batch only loses its
  own paragraphs.

### Calibration (live Jev, October 2026)

Harness: `scripts/jev-eval` (see its README; not part of `bun run test`,
skips without a key). It turns each labeled reply into a planner-shaped
`TurnPlan`, runs the real staging context, deterministic staging,
`spriteClassifierInput` and `buildSpriteRequests`, sends the exact bodies to
`jev-latest` (jev-1.13.0) and caches the raw answers outside the repo.

- Dataset: 16 hand-labeled replies, 162 paragraphs, 24 scenes (slice of
  life, romance, comedy, action, horror, sci-fi, drama, fantasy; first,
  second and third person), 9 plate revisits worded differently plus
  distractor plates (same place at another time or weather), characters on
  the phone / remembered / leaving / arriving, negations, idioms, sarcasm.
  Per paragraph and cast member: present, expression (best + acceptable),
  motion, emote, intensity; per scene light and plate; per paragraph key
  moment level, "standing sprite can show it", interaction. 2,031 questions
  per pass; two passes of identical bodies (records below are pooled).
- Utility per item (final value = the answer if it passes its gate, else the
  deterministic value): +1 best label, +0.5 another acceptable value, −1
  wrong but unchanged, −2 wrong and changed by the classifier (visible),
  −3 wrong rare expression (visible and a generation). Grid 0.05; 1-D
  decisions use a 3-point smoothed utility; ties keep the old value. Rare
  is set 0.05 above hot (costs 1% utility) so the most uncertain rare
  answers still use their pre-generated fallback.
- Question changes kept: the emote question now asks for a visible reaction
  in the narration ("a feeling that is only spoken, implied, mild or hidden
  gets none"): non-`none` emote precision at 0.6 went from 47% (19%
  coverage) to 77% (5%), staged wrong emotes from 32 to 9 of 264 actors. The
  standing question now says yes for talk and facial reactions and no only
  for poses, contact or a view of the place: standing accuracy 52% → 77%
  (95% on level ≥ 3 paragraphs), mean yes 0.58 when a sprite can show it vs
  0.21 when not (was 0.24 vs 0.08).

Per decision (pooled, n items; accuracy of the final value; precision /
coverage of the answers that changed the deterministic value):

| Decision | n | deterministic | old thresholds | calibrated |
|---|---|---|---|---|
| presence | 442 | 83% | 92% (96% / 10%) | 94% (96% / 12%) |
| expression | 520 | 41% | 63% (79% / 44%) | 88% (87% / 79%) |
| motion | 520 | 97% | 96% (60% / 5%) | 98% (83% / 2%) |
| emote | 520 | 95% | 95% (77% / 5%) | 96% (100% / 2%) |
| intensity (with a motion or emote) | 144 | 92% | 90% (86% / 49%) | 92% (90% / 28%) |
| light | 48 | 83% | 100% | 100% |
| place reuse | 48 | 63% | 100% (100% / 38%) | 100% (100% / 38%) |
| interaction (moment paragraphs) | 192 | 74% | 91% (100% / 30%) | 95% (96% / 37%) |
| key-moment pick per reply (cap 1) | 32 | 6 right, 26 missed | 28 right, 2 wrong, 2 missed | 30 right, 2 wrong |

End to end (the real staging engine on the same plans, per actor): presence
89% deterministic → 94% old → 95% calibrated (ghost sprites 72 → 50 → 42);
expression 40% → 58% → 83% (same hot family 54% → 76% → 91%); motion
97% → 96% → 98%; emote 95% → 95% → 96%; light 85% → 100%; plate 63% →
100%, no wrong plate.

Observations: Jev's expression answer is right 78–100% in every confidence
band (confidence ≈ top probability with 56 options), far above the
deterministic selector, so its gates are low. Motion and emote answers below
≈ 0.75 are mostly wrong, and `none` is almost always acceptable, so they are
gated high. Light and place answers were never wrong. The answer's
`probabilities` grouped by hot-set family and the argmax intensity level
were tried and did not help. Determinism: identical bodies gave the same
answer for 97.7% of questions (mean |Δ| 0.02, max 0.21); different batching
of the same text moves results by a few points. Performance: p50 361 ms, p90
592 ms per request; ≈ 15.5k input tokens per request, ≈ 32k per reply
(≈ $0.0013); bodies ≤ 59.9 KB.

Limits: one annotator per reply and labels written for this purpose; the
thresholds are chosen on the same 16 replies they are scored on (flat
optima for expression, light and place; clear optima for motion and emote);
key-moment questions were asked for every paragraph (production asks only
paragraphs with a paintable cue); the "keep_current" value is scored
against the previous paragraph's label.

Library and generation:

- `sprites/library.json` per user; newest 64 sets / 128 plates by last use;
  evicted entries delete their images (best effort).
- One shared seed per set (`spriteSetSeedFor`); a single-expression
  regeneration gives that image its own seed, a new idle a new set seed.
  NovelAI: character caption on V4+, `resolution` 832×1216 (plates and key
  moments 1216×832) whatever `spriteImageSize` says;
  ComfyUI / SwarmUI: `width`, `height` from `spriteImageSize` (standard
  624×912 / 912×624, upscaled 832×1216 / 1216×832), `seed`.
- With reference anchoring, `idle` is generated first and the other
  expressions use it as the reference (after its duplicate check, at most
  25 s); providers without anchoring skip it.
- Cut bridge: ≤ 2 cuts in flight per user, chunks in any order, PNG signature
  and IHDR checked, 5-minute inactivity timeout, failed after 3 timeouts.
  A "basic" cut made while "best" is selected is re-cut once on the next view
  open.

Cut-out runtime:

- onnxruntime-web 1.30.0, imported lazily from jsDelivr into a blob-URL
  module Worker (inline fallback); WebGPU first, then WASM. The model is
  cached in Cache Storage (IndexedDB on http origins).
- Measured on the bake-off set (19 sprites, Chromium): fp32 + WebGPU ≈ 0.35–0.4 s
  per sprite (IoU 0.995 vs. the reference); fp32 + WASM ≈ 14–16 s; int8 runs
  on both but is not faster (ConvInteger falls back to the CPU on WebGPU);
  basic ≈ 0.1 s (IoU 0.954). The kernel alone ≈ 50 ms.
- Fallbacks: download failure → basic (retry after 60 s); no WebAssembly or
  session failure → "unsupported", basic until the user prepares again.
- Image size: the kernel's pixel parameters (edge band 3 px, holes > 30 px,
  4-px border strip; `bgMinPixels` 64 never binds, the 2% border share does
  at both sizes) were tuned on 832×1216 and are kept at 624×912. Check on 30
  real 624×912 sprites (fp32, WASM): the cut at 624×912 against the same
  image upscaled to 832×1216, cut, and scaled back: mean IoU 0.998 (min
  0.991), basic 0.999 (min 0.996), bbox within 0.002. Scaling the hole area
  to the image (17 px) or the band to 2 px changed nothing measurable (≤ 105
  px per image, IoU ±0.0003). `bun run test:sprite-cutout` repeats the check
  on the folder in `CUE_SPRITE_STANDARD`.

Queue order: see "Order of work". Work is handed to the provider only when
a slot is free.

Cut-out background colour: the median of the border pixels the model calls
background (without a model: light, near-neutral border pixels). Sprites that
fill the frame (big hair, wings, spider legs touching the edges) used to make
the plain border median the character's colour, and the cut-out kept the
white background.

Stage:

- Edges: the outer 6% of a sprite's left and right edges and 4% of its top fade
  out, so a figure drawn up to the image edge does not end in a straight cut.
- Portrait: figures stand on a floor just under the top of the dialogue chrome
  (`--vn-dialogue-top`, measured by the stage and only growing while the stage
  size stays the same) and fit the space above it; the lower 16% fades out.
- Facing rule: sprites are assumed to face the viewer or screen left
  (`SPRITE_NATURAL_FACING = "left"`); "right" mirrors around the bbox centre.
- Head position is estimated from the bbox top (emotes, blush).

## Not in v1

Mouth/blink variants (lip flap), face-only repaint for expression variants,
persona sprite, a per-image face box / natural orientation. Known gap: after switching back to scene mode, a
sprite-planned turn is replanned only on the next reply, swipe or refresh.
(Wave 2 added key-moment illustrations with two-character interactions, the
front ambient layer, parallax, grounding and rim light, the narrow 3-actor
layout, and removed the anchoring wait on providers that cannot anchor.)
