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
| `spriteCutout` | `"studio"` (BiRefNet, experimental) \| `"best"` (model) \| `"basic"` (no download) | `"best"` | at once (everyday) |
| `spriteModelUrl` | https URL | ISNet-anime on Hugging Face (its float16 copy downloads where it runs) | Advanced (Apply) |
| `spriteStudioModelUrl` | https URL, or http on this machine; `""` = none | `""` ("studio" cuts like "best") | Advanced (Apply) |
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
             (NovelAI V5 + anchoring, not idle:
              -> vn_novelai_inset {requestId, layout, imageId: idle} ->  frontend inset service
                                                                  fetch the idle, draw canvas + mask
              <- vn_novelai_inset_result chunks (image, mask) ---
              -> image gen (inpainting, 1216x832 canvas) -> imageId, crop = right half)
             -> vn_sprite_cut {requestId, imageId, crop?}  ----->  frontend cut service
                                                                  fetch /api/v1/images/<id>
                                                                  crop (inset renders only)
                                                                  cutSprite() (pre-cut: keep alpha;
                                                                  else ISNet + flood fill)
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
  outfit and style in another chat reuses the set. Every lookup goes through
  `resolveSpriteSet` (`sprites/views.ts`): when the exact key is not in the
  library, a set with the same style, name and identity and the same outfit
  by `sameOutfit` (`src/shared/outfit.ts`; two usual outfits also match)
  stands in (most ready images first, then the latest used), so a reworded
  outfit, another branch or another chat does not make a new set.
- `plateKeyFor({ location, timeOfDay, weather }, styleKey)`.
- `styleKey` = hash of the image connection, model override, prompt prefix,
  suffix, negative, NovelAI quality toggles, active series reference tag, and
  a sprite prompt version. A style change starts new sets.

Each sprite image: status (`SpriteImageStatus`), raw image id, cut image id +
URL, bbox, size, error, attempts. Failed images can be regenerated; a cut can
be redone (`recut`) from the raw image.

Generation runs only while a Cue view is open for the user (same rule as
scene mode), through the existing per-provider scheduler and concurrency.

### Outfit and place continuity

The planner describes the outfit again on most turns, often in new words.
Before staging and image prompts, the cue timeline (`core/cue-state.ts`)
asks `decideOutfit` (`core/change-decisions.ts`, the one swappable decision;
the Jev questions are `wardrobeQuestions` and `SCENE_QUESTION` in
`runtime/system-one.ts`) whenever the planner's outfit differs from the
current one:

- System One on: one extra request per reply (in parallel with the
  per-paragraph batches) sends the whole reply, cleaned (no HTML tags, no
  80+ character blobs), and asks per known character with an outfit in
  continuity (not the persona; at most 3, the previous scene character
  first) a choice (same_outfit / changed_outfit) and a yes/no, with the
  outfit in the question. Score = mean of P(changed_outfit) and the yes/no
  (max over chunks when the reply needs more than one 64 KiB request).
  Score > 0.4 takes the planner's outfit; else the current outfit stays.
- No Jev answer (off, failed, character not asked): the `sameOutfit` text
  check (garment categories and colours; fit, fabric and state words,
  legwear, footwear and accessories are ignored) keeps a reworded outfit.
  A planner outfit that repeats one overruled earlier in the turn stays
  overruled.

A kept outfit is the same text everywhere (scene, cues, terminal state,
continuity), so the sprite set key does not change.

Place: one more request sends the previous scene (location, time of day,
weather; never the planner's scene) and the start of the reply (the first
2 chunks of <= 3000 characters) with one 6-option choice. Score = 1 -
P(same_place) - P(same_place_reworded) - P(flashback_or_call); <= 0.5 keeps
the previous location, time of day and weather for the turn's first scene
(the plate key stays); a later scene in the turn is the planner's. The same
score is the `sceneChange` flag of the continuation rule. Debug logging
prints one `wardrobe` line per decision and one `scene:` line with the scores.

### Prompts

- Sprite: style prefix + subject + character creation / series reference tag
  (when enabled) + identity tags + attire + expression suffix
  (`SPRITE_EXPRESSION_TAGS` for smile, sad and angry, otherwise
  `POSE_EXPRESSION_CATALOGUE`) + sprite framing (`SPRITE_FRAMING_TAGS`) +
  style suffix. Negative: style negative + `SPRITE_NEGATIVE_TAGS`. Portrait
  size where the provider takes a size (`spriteImageSize`; NovelAI always
  832×1216). One shared seed per set where the provider takes a seed, and
  the set's `idle` render as reference image where reference anchoring is on
  and supported, for consistency (see "Seeds, reference strength and the
  duplicate check"). NovelAI V5 takes no reference image: there an
  expression is a reference inset of the idle (see "NovelAI V5 reference
  inset").
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
  - Anima 2.9B, October 2026 (idles only; 4 characters × 4 seeds = 16 per
    variant; pure-white background / figure touching a side / head touching
    the top / two figures): today's framing 14 / 1 / 4 / 0; without `no
    shadow` (29 Danbooru posts, so hardly a tag) 13 / 0 / 6 / 0; with
    `tachi-e` 14 / 2 / 7 / 0; with the Anima model card's quality tags
    (`score_7, safe` and its negative) 11 / 3 / 5 / 0. None of these beat
    today's framing, so it is unchanged. The model card's quality tags also
    changed the drawing style (softer, more rendered), turned one white
    blouse pink and gave one idle crossed arms.
  - Faces of the 4 set (`SPRITE_EXPRESSION_TAGS`): smile `smile, open mouth,
    happy`; sad `sad, frown, tearing up`; angry `angry, v-shaped eyebrows,
    frown, clenched teeth, arms at sides`. The catalogue's `gentle smile,
    eyes relaxed`, `sad expression, downcast eyes` and `furrowed brow, angry
    expression` are mostly not Danbooru tags. Scene prompts and key moments
    keep the catalogue. Anima 2.9B, October 2026: 4 characters × 2 seeds,
    expressions made from the set's idle at reference strength 0.5, judged
    blind from shuffled face crops. Clearly readable (rest weak or misread):
    smile 5/8 → 8/8, sad 4/8 → 8/8, angry 5/8 → 7/8. Without `arms at sides`
    the angry face put the hands on the hips in 3 of 8 sets (4 of 8 without
    the `angry` tag as well); with it 0 of 8, as today. Silhouette overlap
    with the idle (ISNet mask IoU) stayed close: smile 0.86 → 0.84, sad 0.88
    → 0.87, angry 0.86 → 0.85. Not tested on NovelAI; the tags are common
    Danbooru tags. Existing sets keep their images; only newly made
    expressions use the new tags.
  - Skin colour: in sprite identities a non-natural skin colour tag (`blue
    skin`, `light green skin`, `purple_skin`…) not already weighted gets
    weight 1.15 (`weightSkinColourTags`); natural tones (pale, fair, dark, tan,
    brown, light, white skin) and `colored skin` stay plain. Small evidence
    (N = 4 seeds): `(blue skin:1.2)` moved a slime girl's median hue from teal
    163° to blue 191°.
- Plate: style prefix + location, time of day, weather, description +
  `scenery, no humans, detailed background, wide shot` + style suffix.
  ComfyUI / SwarmUI then add two plain-language sentences
  (`plateSentence`): "An empty library, night, drawn as a detailed anime
  background. Nobody is in the picture." (with the description in between
  when it says more than the place). Negative: style negative + `1girl,
  1boy, people, person, character, text`. Landscape size
  (`spriteImageSize`; NovelAI always 1216×832).
  - Why the sentences: the Anima 2.9B card says short prompts give bland,
    simple backgrounds and natural language should be at least two
    sentences. Anima 2.9B, October 2026, 4 places (classroom afternoon,
    shopping street in evening rain, library at night, bedroom morning) × 4
    seeds: the night library came out black or nearly black in 3 of 4
    seeds without the sentences and 0 of 4 with them; over all 16 pairs the
    dark-pixel share fell from 0.43 to 0.36 and the sentence version had
    more edge detail in 10 of 16; daytime places looked about the same; no
    plate drew a person in either version (posters on a bedroom wall, which
    the description asks for, sometimes show characters). NovelAI plates
    are unchanged (not tested there). Existing plates are kept.

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
- **Reference switch (ComfyUI).** Optional: add a Boolean node that turns
  the IP-Adapter on/off (for example a switch between the IP-Adapter model
  and the plain model), map its value as Custom in the Lumiverse workflow
  setup, and give it a title with "IP-Adapter" or "reference". Cue turns it
  on only when it sends a reference (expressions with the idle reference)
  and off for idles, plates and key moments; then it sends no `denoise: 0.0`.
  Detection: the first `custom` mapping on a Boolean node (PrimitiveBoolean
  or a boolean input) whose title or class type matches
  `/ip[\s_-]?adapter|reference|\bref\b/i`
  (`src/backend/runtime/comfy-reference-switch.ts`, read from the connection
  profile and cached for 30 s per selection). The value goes in
  `comfyui_custom_fields` (merged with the user's `comfyui_custom_fields` or
  `custom`; the user's own value for that key wins). No such field, or a
  failed lookup: unchanged (`denoise: 0.0` without a reference).
- **Duplicate check (browser).** The cut-out kernel (`figureCheck`) checks
  the cut-out alpha: mask = alpha > 127; in the rows from 10% to 60% of the
  height, a row is split when it holds at least two opaque runs at least 25%
  of the width wide; the image has two figures when at least 40% of the rows
  are split. It travels as `twoFigures` in the cut meta (absent from older
  frontends). On the test set: precision 0.95, false-positive rate 1%,
  recall 0.55 (it finds figures standing apart, not overlapping groups or
  grids). It is a cheap retry trigger, not a guarantee.
- **Scenery check (browser).** For light-themed characters Anima often
  draws scenery behind the character (a wall panel, a disc or ring, floor
  bands, a window frame), and the cut keeps it: it is far from the
  background colour and touches the figure, so the flood fill never reaches
  it, whatever model made the mask. The kernel (`sceneryCheck`) compares the
  cut-out with the model's mask: a stray pixel is opaque in the cut-out
  (alpha > 127), scored below 0.1 by the mask and more than 8 px (L1) from
  every pixel the mask scores 0.5 or more. The cut-out has scenery when
  stray pixels are at least 3% of its opaque pixels. It travels as
  `scenery` in the cut meta; absent when there was no mask to check against
  ("basic", a pre-cut source, an older frontend), and then nothing is
  re-rolled. Which mask:
  - **Best**: the ISNet mask. Measured (October 2026, saved masks of the
    background-removal benchmark, the shipped kernel): 9 of the 10 hard
    light-themed renders with scenery flagged (shares 0.037–0.45; the dark
    ring of c17 sits inside ISNet's figure and is missed), plus c07
    (sparkles and a background patch kept, a fair re-roll); none of 45
    clean sprites asked for on white (12 hard, 19 bake-off, 14 reply test;
    highest 0.013). On the same subjects rendered on black 2 of 11 clean
    ones were flagged, where ISNet leaves out dark translucent wings (0.14)
    and fox tails (0.030): one wasted render each.
  - **Studio**: the Studio model's own mask, same threshold. 8 of 10 (c14's
    floor band is 0.017 there) plus c07, and c24 (BiRefNet leaves out the
    lamia's tail, and a floor band is kept); none of 31 clean (highest
    0.009).
  - **Pre-cut** (the workflow cut it, see "Server-side cut in ComfyUI"):
    no check. Its alpha is the workflow model's mask, so there is no second
    mask to compare with, and running the browser model only for the check
    would spend what the server-side cut saves (and ISNet disagrees with
    BiRefNet on tails, wings and glow, the false flags above). The raw
    ComfyUI cut already drops most of it: of the 10 renders, 6 come out
    clean, 2 keep part of a floor or wall, and the disc (c08) and the ring
    (c17) stay.
- **Acting on it (backend).** A fresh render flagged by its first check
  (two figures, or scenery) is dropped (its cut is not uploaded) and
  rendered again once (`autoRetried`, shared by both checks):
  - an expression with its own new seed;
  - the idle with a new set seed (`seedRound` + 1); every expression that
    already rendered, or is rendering, with the old set seed is queued again,
    so the set keeps one pose and the new idle as its reference.
  Scenery, like duplicates, comes with the composition, so it follows the
  seed. An expression drawn from the idle (ComfyUI img2img at 0.5, or a
  NovelAI V5 inset) also inherits the idle's scenery: it re-rolls for
  scenery only when the idle's own check came out clean (`scenery: false`),
  not when the idle kept scenery or was cut without the check (basic, or a
  workflow cut), which would cost one render per expression and break the
  shared pose. A flagged retry is kept and shown (never a loop); the Sprite
  library says "may show two figures" or "may show scenery behind" and
  Regenerate draws a new one. The check's result is stored per image
  (`twoFigures`, `scenery`; null until checked, and `scenery` stays null for
  a cut without a mask). Only the first cut of a render the backend just
  stored can bring the regeneration (it keeps those raw ids in memory): a
  Re-cut, the stage's Retry of a failed cut or save, or a cut after a
  backend restart keeps the render and shows the flag.
- **Waiting for the idle's check.** With anchoring, expressions already
  wait for the idle render; they now also wait for its first check (the
  cut-out), at most `IDLE_CHECK_WAIT_MS` (25 s) from the render, so a slow or
  closed browser cannot stall the queue (the service re-pumps when the wait
  runs out). The idle's cut goes first among pending cuts. An automatic
  retry of the idle is not waited for (its result is kept anyway). Without
  anchoring nothing waits; a flagged idle then re-queues the expressions
  made with the old seed.
- **User regenerate.** Regenerating the idle (alone or with the whole set)
  draws a new set seed: expressions not made yet use it, existing ones stay
  (except NovelAI V5 reference insets: those drawn from the old idle are
  rendered again from the new one, up to 11 renders, see "NovelAI V5
  reference inset"); a whole-set regenerate gives every expression the new
  seed. One other expression alone gets its own new seed, as before.

### NovelAI V5 reference inset

NovelAI Diffusion V5 has no Precise Reference or Vibe Transfer, and
Lumiverse drops `resolvedReferenceImages` for V5 models, so before this the
idle reference did nothing on V5 while expressions still waited for the
idle. The inset (technique by "bequiet", arca.live AI-art channel, posts
180786125, 185554190, 185642997) keeps a set consistent by inpainting:

1. A 1216×832 white canvas, the set's idle render (raw, on white) contained
   and centred in the left 608×832 box (832×1216 idle: drawn at x 19,
   569×832). A mask: black (keep) left, white (repaint) right; the edge at
   x = 608 sits on the 8-px latent grid (else a grey seam appears).
2. An inpainting request draws the right half copying the character and
   its art style from the left.
3. The cut-out is made from the right half (608×832).

When: provider `novelai`, effective model (`imageModel`, else the
connection's model) `nai-diffusion-5*`, reference anchoring on, an
expression (never the idle, which renders as before), and an idle render in
the set. Geometry: `NOVELAI_INSET_LAYOUTS` (`src/shared/novelai-inset.ts`,
one table, so a scene layout can be added). Request:
`compileNovelAiInsetRequest` (`src/backend/runtime/sprites/novelai-inset.ts`).

- **Composition (browser).** The backend runs without a canvas, so it sends
  `vn_novelai_inset { requestId, layout: "sprite", imageId }` (the idle's
  raw image id); the frontend (`src/frontend/sprites/inset-service.ts`,
  `canvas-tools.ts`) fetches the image, draws the canvas and the mask, and
  answers `vn_novelai_inset_result` chunks per part (`image`, `mask`). The
  backend checks both are PNGs of the canvas size. Wait: 15 s
  (`NOVELAI_INSET_TIMEOUT_MS`).
- **Request.** What Cue sends through `spindle.imageGen.generate`
  (`image`/`mask` are base64 PNGs):

  ```text
  model:      nai-diffusion-5-full-inpainting   (<model>-inpainting)
  prompt:     "split screen, " + the sprite's base prompt
  negative:   the sprite negative without "split screen" (also weighted or
              bracketed), plus "comic" ("multiple views" stays)
  parameters: the sprite parameters (seed, characterTags = the character
              caption unchanged: the V4+ caption, `girl` / `boy` /
              `other` first, no count tags; coords off, qualityToggle false,
              negativePrompt as above) and
              resolution: "1216x832"
              rawRequestOverride: '{"parameters":{"noise":0,"width":1216,"height":832,"image":"<png>","mask":"<png>"},"action":"infill"}'
  ```

  No `resolvedReferenceImages`. Steps, guidance and sampler stay the
  user's (Lumiverse defaults 28, 5, Euler Ancestral, Karras, rescale 0; the
  author used 14 steps, CFG 6.7). Lumiverse already sends
  `add_original_image: true` and `inpaintImg2ImgStrength: 1`, and
  deep-merges `rawRequestOverride` into the NovelAI body, where `action` and
  `parameters.*` are not protected (`model` is, hence the model field).
  Lumiverse merges extension parameters over the connection's defaults one
  level deep, so the inset's override would hide the user's: Cue merges in
  the one the plain request would use, Cue's Image parameters
  `rawRequestOverride` when set, else the connection's own (never both, as
  on the plain request). Order: `noise: 0` < the user's override < the
  inset's `action`, `image`, `mask` and canvas size (`width`, `height`: a
  user size would not match the canvas). The merge is Lumiverse's (objects
  merge, a nested `null` is written). An override that is not valid JSON
  skips the inset (plain expression).
- **Crop.** The raw render is the whole canvas. The cut request carries
  `crop` (608, 0, 608×832); the frontend crops before the cut-out and echoes
  the crop in the cut meta, so the face box and the two-figure check run on
  the cropped figure as before. The crop is stored on the library image
  (`crop`, absent on every other render), so Re-cut, a cut retry and the
  basic → best upgrade crop the same way. A cut without the echo (a page
  from before the inset) fails ("reload the page, then use Re-cut") instead
  of keeping both halves.
- **Fallbacks.** NovelAI rejects the request (HTTP 400, 404 or 422, or
  an error naming the model or the infill, for example an unknown model
  name): the expression is retried once as the plain request (portrait,
  unanchored, as V5 would draw it anyway), logged (debug logging), and the
  inset is off for that user, connection and inpainting model until the
  backend restarts; anchored expressions then stop waiting for the idle.
  Any other error (429 concurrent-generation lock, 408, 5xx, network,
  credits, a missing image id) fails the render as usual, with no plain
  retry, and the inset stays on for the next attempt. No canvas
  (browser error, timeout, a page without the inset service): the plain
  expression, and that idle is not offered to the browser again for 5
  minutes after an error or 1 minute after a timeout, or until the page
  reloads. A reloaded page (`vn_get_state`, view opened) gets the pending
  canvas requests again under the same id.
- **A new idle.** Each inset render records the idle render it was drawn
  from (`insetReference`, set before the canvas is asked for). When the set
  gets a new idle render (flagged idle, Regenerate, a failed idle rendered
  again), inset expressions drawn from another idle are queued again
  (rendered, being cut, cut failed, or still composing or rendering) and
  drawn from the new one. An inset render that ends while its idle is no
  longer the set's idle (for example the idle is rendering again) is not
  cut: it is queued again and waits for the new idle. Plain renders are
  left alone.
- **Keys.** The sprite style key does not change: a set can hold inset and
  plain (fallback) renders side by side, as it always could hold anchored
  and unanchored ones; the per-image `insetReference` is what ties a render
  to its idle. V4.5 Precise Reference and every other provider are
  unchanged.
- **Limits.** Output 608×832 (the stage scales sprites from the bbox, so a
  set may mix 608×832 insets with an 832×1216 idle). The reference's
  background bleeds in (the idle on white is the ideal reference). Too small
  a repaint area gives several figures. One character per inset.
- **Unverified** (no key during development): `nai-diffusion-5-full-inpainting`
  is the author's; `nai-diffusion-5-curated-inpainting` is a guess (logged
  as unverified; if NovelAI rejects it, the inset turns off). Lumiverse uses
  `/ai/generate-image-stream` unless the connection is set to non-streaming;
  whether infill works on the stream route is untested. Anlas cost: the
  author reports it free on Opus at 1216×832 and ≤ 28 steps. Result quality
  through Cue's prompts is untested. Cue adds no `strength` or `noise` beyond
  `noise: 0` (Lumiverse's `inpaintImg2ImgStrength: 1` stays). With the connection's V5 mode set to
  Furry, Lumiverse puts `fur dataset` before `split screen`.

**Probe.** `scripts/novelai-v5-inset-probe.ts` (not part of the build) sends
one inset request straight to NovelAI, with the body Lumiverse would build
for Cue's request, so the owner can check the model name, the routes, the
cost and the result with a real key:

```sh
# PowerShell: $env:NOVELAI_API_KEY = "..."   bash: export NOVELAI_API_KEY=...
bun scripts/novelai-v5-inset-probe.ts --reference idle.png --seed 42 --route both \
  --prompt "anime coloring, 1girl, solo, standing, simple background, white background" \
  --character "girl, silver hair, green eyes, school uniform, smile"
```

The key is read only from `NOVELAI_API_KEY` (never printed or written);
without it, or with `--dry-run`, nothing is sent. It writes `canvas.png`,
`mask.png`, `request.redacted.json` (image, mask and key redacted) and, per
route, `<route>-full.png` and `<route>-right.png` (the 608×832 half Cue cuts
out) to `.cache/improve/v5inset/`. Other options: `--negative`, `--model`
(e.g. `nai-diffusion-5-curated`), `--steps`, `--scale`, `--sampler`, `--raw`
(a user override to merge), `--route plain|stream|both`, `--out`, and
`--canvas WxH --strip N` to try an untested layout (reference in the left N
px, the rest repainted; e.g. a scene-mode candidate `--canvas 1472x704
--strip 448` with a scene `--negative`). The script composes the canvas with a tiny PNG codec; the extension draws it in the
browser, so resampling differs slightly.

## Order of work (backend, `sprites/jobs.ts`)

One scheduler per user runs sprites, plates and key moments with the
provider's concurrency. Work goes to the provider only when a slot is free,
so the order is decided at each start:

1. **Turn work**, in reading order of the latest turn (`state.need`: the
   first paragraph that needs each item):
   - the opening plate is the very first job; a later plate goes before the
     sprites needed at its paragraph;
   - then the expressions the reply uses, one at a time, by first
     appearance; with reference anchoring a character's idle comes first
     (NovelAI V5: while the reference inset is on).
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
- **Cast**: the persona never joins the cast (the turn's `userSpeaker`, else
  the active Lumiverse persona, plus generic names like "You"). Names resolve
  through the chat's character registry first: an alias ("Suzu") is its
  canonical member ("Rat Musume"), aliases count as mentions, and an empty
  identity gets the entry's tags. Stored staging from older turns is cleaned
  the same way when it is read (`sanitizeStoredStaging`: persona dropped,
  alias members folded into the canonical member), without rewriting the file.
  A speaker the planner kept only because the reply spells its name (a
  one-line barkeep, listed in `TurnPlan.nameplateOnlySpeakers`) shows a
  nameplate but never joins the cast, so no sprite set is generated for it.

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
- Emote placement: from the image's face box (`face`, see "Face boxes"):
  blush on the cheek line (62% down the face box, 0.9 face widths wide),
  side marks at the temple toward the stage centre, gloom over the forehead,
  sizes from the face width. Without a box, an estimate from the framing
  (`estimateSpriteFace`: full body when the figure ends above the image
  bottom, else a crop). Emotes sit in `[data-vn-sprite-marks]`, which
  breathes with the figure but is not mirrored (x is flipped in CSS).
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
for this chat, Regenerate, Re-cut, and Delete; the model URL and the Studio
model URL under Advanced. With Studio quality the model status covers both
models: whether the Studio model is downloaded (else **Download Studio
model**), its background download, and why Best cuts instead (**Try Studio
again**); a device that cannot run it gets Best's status, never the Studio
download. A model the browser did not store says it downloads again.

## Cut-out (frontend)

A NovelAI V5 inset render is first cropped to its repainted half (the cut
request's `crop`, see "NovelAI V5 reference inset"). Validated by the
bake-off (anime line art and lineless painterly styles): ISNet-anime mask → border flood fill over background-coloured pixels (mask >
0.7 guards against leaks) → enclosed near-background components whose mean
mask < 0.5 become background → separate components whose mean mask < 0.3
are dropped (brush specks) → defringe (un-mix the background colour from the
edge band) → duplicate check on the alpha (`figureCheck`) and scenery
check of the alpha against the mask (`sceneryCheck`), see "Seeds, reference
strength and the duplicate check". The background colour is the median of
the image border.
"basic" quality skips the model. The model is downloaded once from
`spriteModelUrl` and cached in the browser; onnxruntime-web is loaded lazily
(WebGPU, else WASM) so the frontend bundle stays small.

Half-precision download: for the default `spriteModelUrl` the browser
downloads `DEFAULT_SPRITE_MODEL_F16_URL` instead (the same ISNet-anime in
float16, onnx-community/anime-seg-ONNX, 88 MB instead of 176 MB;
`chooseCutoutModelUrl`). Exceptions: the float32 model is already cached
(kept, no second download), or WebGPU is there without the `shader-f16`
feature (onnxruntime-web cannot build the f16 session on that GPU and would
drop to WASM, so the float32 model downloads and keeps WebGPU speed). Without
WebGPU both run on WASM at the same speed. A custom `spriteModelUrl` is used
as it is. Measured (October 2026): cut alpha against float32 on 58 sprites
(bake-off, reply test, white-character set; ORT CPU) mean abs. difference
0.00001, IoU 0.99998 (min 0.9991); Edge WebGPU on an RTX 5060 106 ms vs 119
ms per inference, GPU memory +0.78 GB vs +1.47 GB; WASM 18 s vs 17 s (one
thread).

Pre-cut sources: when the generated image is already transparent (at least
half of its 1-px border has alpha ≤ 8 and some pixel is opaque, `isPreCut`),
the cut-out keeps the image's own alpha: no model, no flood fill, only the
bbox and the duplicate check (no scenery check: there is no second mask).
It reports quality "best" (so it is never
queued for a basic → best re-cut). This lets a ComfyUI workflow cut on the
GPU (see "Server-side cut in ComfyUI" below). Images with a few transparent
pixels on an opaque frame still count as on white. The check runs on the
image the cut-out gets, so a NovelAI V5 inset render is judged after its
crop, on the repainted half alone (on the whole canvas, the opaque reference
half would be half of the border).

### Server-side cut in ComfyUI (optional)

A ComfyUI workflow can cut sprites itself, on the GPU and with a stronger
model than the browser's (folded BiRefNet: IoU 0.976 on white-themed sprites
on white vs 0.946 for ISNet + kernel, bench notes below). Cue drives it with
a Boolean switch, like the reference switch: on for sprite renders, off for
plates, key moments and scene pictures, so only sprites come back
transparent. The browser keeps the alpha of a render that arrives
transparent (pre-cut, above) and skips its own model for it.

ComfyUI's native nodes do the cut: `LoadBackgroundRemovalModel`
(models/background_removal/, BiRefNet Swin-L checkpoints) →
`RemoveBackground` (IMAGE → MASK, 1 = character) → `InvertMask` →
`JoinImageWithAlpha` (which uses 1 − mask as alpha) gives an RGBA image. A
Boolean (`PrimitiveBoolean`) feeds the core If/Else Switch
(`ComfySwitchNode`), which passes the RGBA image (on) or the plain one (off)
to `SaveImage`. The switch is lazy: with it off the removal does not run.

Setup:

1. Model: put a BiRefNet checkpoint in ComfyUI/models/background_removal/
   (Comfy-Org's `birefnet.safetensors`, BiRefNet Swin-L general, MIT), and
   fold the input normalisation into it (see "Weights" below):
   `python_embeded\python.exe scripts\comfyui\fold_birefnet.py
   ComfyUI\models\background_removal\birefnet.safetensors
   ComfyUI\models\background_removal\birefnet_cue_folded.safetensors`.
   ToonOut (MIT weights, fine-tuned on a CC-BY-4.0 anime dataset) folds the
   same way and does a little worse on white (0.962).
2. Workflow: add the six nodes between your VAE Decode and Save Image.
   `docs/comfyui/sprite-cutout-example.json` is a complete example in API
   format (a plain checkpoint txt2img graph, nodes 10–16 are the cut-out
   branch): import it in Lumiverse as is, or drop it on ComfyUI and copy
   the branch into your own workflow. In your workflow the `image` inputs
   of Remove background and Join image with alpha, and the switch's
   `on_false`, come from your decoded image; the switch's output goes to
   Save Image.
3. Lumiverse workflow setup: map the Boolean's `value` as **Custom** and
   give the Boolean node a title that says on = cut out: "Cue sprite
   cut-out", "Remove background", "Transparent PNG". Cue reads the title's
   words: a cut-out ("cut-out", "cutout"), transparency, or removing the
   background ("remove (the) background/BG", "background removal"; not
   "Remove background noise"). A title with a negation ("Disable…",
   "Skip…", "No…", "without") or naming the reference is not the switch.
   Leave its saved value off: then anything that does not set it
   (Lumiverse's own image generation, other extensions) gets the plain
   image.

What Cue does (`findCutoutSwitch` / `cutoutSwitchParameters` in
`src/backend/runtime/comfy-reference-switch.ts`): the first `custom`
mapping on a Boolean whose title asks for the cut-out is the switch. Only
the title counts, and never on a node that removes the background itself
(rembg, BiRefNet, matting nodes: API prompts title a node with its class
name, and its own options such as `only_mask` are not the switch). A
title that also names the reference or the IP-Adapter stays the reference
switch. It is read from the connection profile with
the reference switch (one lookup, cached 30 s per selection). Sprite renders
send `true`, plates, key moments and scene pictures `false`, in
`comfyui_custom_fields` (merged with the user's `comfyui_custom_fields` or
`custom` and the reference switch). A value the user set for the key in
Cue's image parameters can only turn the cut-out off: `false` wins
everywhere, and `true` leaves Cue's choice (it never makes a scene, plate or
key moment transparent). The debug log says `cut-out switch 14:value -> on`
(node 14 in the example). Lumiverse applies the connection's ComfyUI
workflow for SwarmUI connections too, so Cue drives both switches there the
same way (without the ComfyUI-only `denoise: 0.0` for unreferenced images).

Lumiverse's Image Gen panel shows the mapped Boolean as an Enabled/Disabled
control and saves it, with every other Custom control, in the connection's
`default_parameters.comfyui_field_values.custom`. Lumiverse merges each
request over those defaults, and `comfyui_field_values` then replaces
`comfyui_custom_fields` as a whole (its `node_fields` beat both). So Cue
reads the connection's default parameters with the switches and sends
`comfyui_field_values` too: the saved values, the user's own custom fields,
then its switch values, with the switch keys taken out of `node_fields`.
Whatever the panel saved, sprites are cut and nothing else is, and the
reference switch follows the reference. The log notes a saved value it
overrode (`cut-out switch 14:value -> off (Image Gen panel had true)`).

No such field,
or a failed lookup: nothing changes. A sprite whose cut the workflow made
reports quality "best", gets the duplicate check on its alpha and no
scenery check (see "Scenery check" above); the raw render the backend keeps
(and sends as the idle reference) is the RGBA file, whose colour channels
hold the whole render (`JoinImageWithAlpha` keeps them, and ComfyUI's
`LoadImage` reads a reference as RGB).

Weights: ComfyUI's BiRefNet config (comfy/background_removal/birefnet.json)
feeds pixels 0..1 with mean 0 / std 1, not the ImageNet normalisation
BiRefNet was trained with, and the stock checkpoints are the original
weights. `scripts/comfyui/fold_birefnet.py` folds the normalisation into
the convolutions that read the image (exact for the patch embedding, exact
but for the outermost ring of the decoder's image-patch convs) and writes
fp16: on white, BiRefNet IoU 0.949 → 0.976, ToonOut 0.949 → 0.962. The other
way, editing birefnet.json to the ImageNet mean/std, would change it for
every workflow on that ComfyUI; upstreaming the normalisation is the
lasting fix.

Lumiverse keeps the PNG as ComfyUI saved it: its ComfyUI provider fetches
the output with `/view`, turns the bytes into a data URL
(`comfy-runner.ts`), and `saveImageFromDataUrl` → `uploadImages` writes
them to disk as they are (thumbnails go to separate files).

Bench notes (October 2026; synthetic ground truth from 6 white-themed
sprites rendered on black, composited on flat backgrounds):

- ComfyUI's BiRefNet config feeds pixels 0..1 with mean 0 / std 1, not the
  ImageNet normalisation BiRefNet was trained with. Folding the
  normalisation into the first convolutions of the checkpoint (patch embed
  and the decoder's image-patch convs) fixes it: on white, BiRefNet IoU
  0.976 vs 0.949 unfolded, ToonOut 0.962 vs 0.949.
- On white, folded BiRefNet (IoU 0.976, SAD 12) and ToonOut (0.962, SAD 19)
  beat the browser pipeline (ISNet + kernel 0.946, SAD 27), but no model
  won on every image (BiRefNet 0.904 on one, ISNet + kernel 0.799 on
  another, ToonOut never below 0.903). On mid grey both reach 0.994.
- ~0.7–1.4 s per image in batches on a GPU that was generating at the same
  time (no idle-GPU timing).

### Studio cut-out (opt-in, experimental)

`spriteCutout: "studio"` cuts with BiRefNet Swin-L, the model ComfyUI's
`RemoveBackground` node uses, in the browser: masks within IoU 0.997 of the
ComfyUI node's, at about 0.8 s per sprite on WebGPU. Nothing is hosted: the model file
comes from `spriteStudioModelUrl` (empty by default, then "studio" cuts like
"best"). Best stays the default.

The model is an export for onnxruntime-web's WebGPU backend, made outside the
repo (`.cache/improve/bgremoval/scripts/birefnet_export.py`, from the official
BiRefNet code): fp16 weights with fp32 inputs and outputs, a 1024×1024 input
stretched from the image (`fit: "stretch"` in `modelInput`; ISNet
letterboxes), RGB 0..1 in, with the ImageNet normalisation and the sigmoid in
the graph. Two rewrites make it run on WebGPU: the deformable convolutions
(ASPPDeformable) become exact GridSample + Conv (onnxruntime-web has no
DeformConv kernel), and the decoder's last concat of a 1024×1024 feature map
is split into two convolutions (the concat took about 1 GB and pushed an 8 GB
GPU into paging: 11 s per sprite before, 0.6 s after). The published
onnx-community exports (BiRefNet-ONNX fp16, BiRefNet_lite-ONNX fp16 and fp32)
do not run on WebGPU (Edge: "Too many storage buffers in shader. Current: 17,
Max is 16", also through transformers.js 4.3.1).

Where it runs: WebGPU with `shader-f16` only, checked before the download
(`getStudioCutoutSupport`), and not on phones (`navigator.userAgentData.mobile`),
on devices that report under 8 GB of memory (`navigator.deviceMemory`; a
judgement from the +3.1 GB of graphics memory measured below, integrated
graphics take theirs from RAM; browsers that do not report it are allowed) or
on a software WebGPU adapter. WebGPU's limits are no gate: the export ran with
the default limits (128 MiB storage binding, 256 MiB buffer, 8 storage buffers
per stage) with the same output as with the adapter's maximum buffer sizes (one
1024 px input: mean 0.50405 and 528613 foreground pixels in both, 612-616 ms warm).
Settings ask the same check and do not offer the Studio download where it
fails. WASM is never used for it (23 s per sprite at 512 px; at 1024 px the
browser passed 4.5 GB of RAM and was stopped). One cut-out model is loaded at
a time, so switching between Studio and Best reloads.

The download never runs inside a cut (the backend gives a cut 5 minutes, sized
for Best's 88 MB): a "studio" cut while the Studio model is not in the browser
starts its download in the background and cuts with Best; its progress shows
in settings over the loaded model's state. The cut after the download loads
the Studio model (seconds). Best cuts made meanwhile are marked `provisional`
(also when another tab holds the Studio model, see below) and get one silent
Studio re-cut the next time a Cue view opens, the same one-shot upgrade basic
cuts get: the re-cut replaces the cut only when the Studio model made it,
otherwise the old cut stays and the try is spent (a basic cut whose upgrade
came back provisional keeps one Studio try). Re-cut in the library does it at
once. A failed download is tried again after 1, 2 and 4 minutes, then not on
that page; settings' **Try Studio again** retries it.

When it fails: any Studio failure (the worker dies loading or running it, the
session cannot be built, onnxruntime cannot start, a run fails) stands for the
page, the worker that held it is stopped so Best loads on a fresh worker and
GPU device, the sprite is cut again with Best (and without a model on another
fresh worker if that dies too), and the model state's `note` says why. A
failure that kills the tab is caught per device: a localStorage marker
(`cue-sprite-cutout-studio-attempt`) goes up before the Studio model loads and
comes down after its first good cut or on a normal page close (`pagehide`);
a marker found on the next visit (holding the Studio lock, so not another
tab's load) means that visit uses Best and says so, and a failure the page saw
is kept there with its reason. **Try Studio again** in settings clears it.

One Studio session per device: a tab takes a Web Lock
(`cue-sprite-cutout-studio`) before loading the model and lets it go when the
model leaves; another Cue tab cuts with Best meanwhile. The model leaves the
worker as soon as it is not wanted: another quality, another or no Studio URL
(`syncStudioCutout`, on every config and every cut), and **Remove downloaded
model** unloads whatever the worker holds.

Storage: one Studio file in the browser. After a Studio download is stored,
the files of earlier Studio URLs are deleted (Best's is kept). When the
browser will not store it (storage full, private mode), the model loads from
memory for that page and its ready state carries `notStored`; settings say it
downloads again on the next visit (the same for Best). The browser keeps the
first file it downloaded from a URL: to switch to a new export behind the same
address, change the URL (for example add `?v=2`) or remove the downloaded
model.

Measured (October 2026, Edge 156, RTX 5060 8 GB, ComfyUI idle but resident):

| | general (birefnet) | ToonOut | Lucida |
|---|---|---|---|
| Synthetic white, 6 sprites: IoU / SAD through Cue's kernel | 0.9756 / 10.3 | 0.9594 / 19.1 | 0.9792 / 8.7 |
| The ComfyUI node on them (normalisation folded), same kernel | 0.9739 / 11.1 | 0.9604 / 18.5 | — |
| Synthetic white, 10 sprites: IoU through Cue's kernel | 0.9774 | 0.9645 | 0.9807 |
| Mask IoU vs the ComfyUI node, 19 bake-off sprites (mean / min) | 0.9975 / 0.988 | 0.9949 / 0.964 | — |
| Mask IoU vs PyTorch fp32 with the original ops, 9 sprites | 0.9990 | 0.9984 | — |
| Warm inference, 1024 px (one session, 103 images) | 614 ms | 609 ms | 614 ms |
| GPU memory while running | +2.9 GB | +3.0 GB | +3.3 GB |

Best (ISNet + kernel) on the same 6 / 10 sprites: IoU 0.946 / 0.957. Download:
499 MB (fp16), 995 MB (fp32). The Cue path itself (Worker, `cutSprite`, 12
synthetic + 19 bake-off sprites, general model; measured while the download still
ran inside the first cut): first cut 8.6 s (download
from localhost, session 4.0 s, first run 2.0 s), with an on-disk profile
17.6 s (the 499 MB cache write); after a reload, read from Cache Storage,
5.0 s; then 0.70 s model and 0.79 s per sprite (median); GPU +3.1 GB; the
machine's free RAM fell by 2.3 GB during the run. Its cut-outs match the
bench path (same model, mask resized in Python, Cue kernel): alpha IoU 0.9993
on the bake-off, 0.998 on the synthetic set. Smaller inputs are faster but
lose the quality: 768 px 333 ms (IoU 0.974), 512 px 183 ms (0.958). Headless
Chromium has no `shader-f16`: the fp16 session fails ("Program Transpose
requires f16"); the fp32 export runs there at 1.12 s warm (masks IoU 0.9992
against fp16) but is not wired up. A newer onnxruntime-web
(1.31.0-dev.20260914) ran the same export at 601 ms with identical masks.

Serving it locally: a static server on this machine. Lumiverse's page is on
another origin, so the server has to send CORS headers, for example
`bun -e "Bun.serve({ port: 8790, fetch: () => new Response(Bun.file('birefnet_general_1024_fp16.onnx'), { headers: { 'Access-Control-Allow-Origin': '*' } }) })"`,
then set the Studio model URL to `http://localhost:8790/birefnet_general_1024_fp16.onnx`.
Checked with the page on 127.0.0.1 and the model on localhost (another port),
before the download moved to the background: with the header the Studio model
loads; without it the download fails ("Failed to fetch"), Best cuts, the
settings note says the Studio model is not available, and the download was
tried again after 60 s (now 1, 2, then 4 minutes).

Hosting it (not done): a 499 MB file per model on an https host with CORS
(Hugging Face works like the ISNet default), plus attribution. BiRefNet code
and weights: MIT (ZhengPeng7/BiRefNet; Comfy-Org/BiRefNet repackages them
under MIT). ToonOut (joelseytre/toonout) and Lucida (egeorcun/lucida) weights:
MIT, fine-tuned on the joelseytre/toonout dataset, which is CC-BY-4.0, so the
model card has to credit the dataset. Converted weights carry the same terms
and need a note that they were converted.

`bun run test:sprite-cutout` checks the tier when `CUE_SPRITE_STUDIO_MODEL`
points at an exported file: the fallback in headless Chromium (no Studio
fetch), and in `CUE_SPRITE_STUDIO_CHANNEL` (for example `msedge`) a first
"studio" cut by Best that does not wait for the download, one download, then
the Studio cuts. How the tier fails (crashes, markers, the lock, backoff,
unloading, storage) is unit-tested with a fake runner
(`src/frontend/sprites/cutout/studio-failures.test.ts`).

### Face boxes

A small face detector (`DEFAULT_SPRITE_FACE_MODEL_URL`: deepghs
face_detect_v1.4_n, YOLOv8n, 12 MB, MIT) runs in the cut-out worker on WASM
("best" quality only), on the source image on white, stretched to 448x640.
Highest-scoring box above 0.5 wins. Bench on 275 library cut-outs (humans,
cat, rat, bee, slime and monster girls, old crops and full body): a face on
all 275, the 5 extra boxes are real second figures; ~280 ms per image in
Chromium WASM, one thread. The box rides on the cut meta and is stored on
the library image (`face`: box, null = none found, absent = unknown).
Backfill: when a staged set has ready images without `face`, the browser
detects them once in the background (`face-service.ts`, after a short delay,
one at a time) and sends `vn_sprite_face`; the backend stores it only if the
image still has that cut-out and no face, and broadcasts `vn_sprite_update`.

## Implementation notes (v1)

Code map:

| Area | Files |
|---|---|
| Shared contract | `src/shared/sprites.ts`, `src/shared/novelai-inset.ts` (inset geometry) |
| Staging | `src/backend/runtime/sprite-staging.ts`, `system-one-sprites.ts` |
| Library, prompts, jobs, cut bridge, NovelAI V5 inset (request, bridge), views | `src/backend/runtime/sprites/**` |
| Controller hooks | `src/backend/runtime/controller.ts` (`buildTurnView`, sprite request handlers) |
| Cut-out | `src/frontend/sprites/cutout/**` (`kernel.ts` is the DOM-free algorithm), `cut-service.ts` (crop of inset renders) |
| NovelAI V5 inset canvas | `src/frontend/sprites/inset-service.ts`, `canvas-tools.ts`; probe `scripts/novelai-v5-inset-probe.ts` |
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
  NovelAI: character caption on V4+ (`girl` / `boy` / `other` first, no
  count tags; `1girl` / `solo` stay in the base prompt, as NovelAI's
  multiple-characters guide says), `resolution` 832×1216 (plates and key
  moments 1216×832) whatever `spriteImageSize` says;
  ComfyUI / SwarmUI: `width`, `height` from `spriteImageSize` (standard
  624×912 / 912×624, upscaled 832×1216 / 1216×832), `seed`.
- With reference anchoring, `idle` is generated first and the other
  expressions use it as the reference (after its duplicate check, at most
  25 s); providers without anchoring skip it. NovelAI V5: the expressions
  are reference insets (1216×832 inpainting canvas, the right 608×832 cut
  out); see "NovelAI V5 reference inset".
- Cut bridge: ≤ 2 cuts in flight per user, chunks in any order, PNG signature
  and IHDR checked, 5-minute inactivity timeout, failed after 3 timeouts.
  A "basic" cut made while "best" or "studio" is selected is re-cut once on
  the next view open.

Cut-out runtime:

- onnxruntime-web 1.30.0, imported lazily from jsDelivr into a blob-URL
  module Worker (inline fallback); WebGPU first, then WASM. The model is
  cached in Cache Storage (IndexedDB on http origins).
- Model file: float16 copy by default (see "Half-precision download").
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
- Emotes follow the detected face box; without one, the framing estimate.

## Not in v1

Mouth/blink variants (lip flap), face-only repaint for expression variants,
persona sprite, a per-image natural orientation. Known gap: after switching back to scene mode, a
sprite-planned turn is replanned only on the next reply, swipe or refresh.
(Wave 2 added key-moment illustrations with two-character interactions, the
front ambient layer, parallax, grounding and rim light, the narrow 3-actor
layout, and removed the anchoring wait on providers that cannot anchor.)
