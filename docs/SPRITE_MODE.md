# Sprite mode — design

Status: v1 implementation in progress (October 2026). This file is the contract
for the parallel implementation. `src/shared/sprites.ts` holds the shared
types; `src/protocol.ts` holds the messages.

## Why

Scene mode paints a full 16:9 picture per cue: 20–50 s per picture, so Cue
rations pictures (at most `maxImagesPerTurn`). Sprite mode pays for pictures
once and reuses them:

- a **sprite set** per character + outfit + image style: the 12 hot-set
  expressions (`SPRITE_HOT_SET`), generated on a plain white background and
  cut out in the browser;
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

Scene mode is unchanged. In sprite mode no scene-image jobs run; the planner
still plans scenes, environments, speakers and cues (they feed staging).

## Data flow

```
assistant reply
  -> planner (+ System One presentation, unchanged)          [existing]
  -> TurnPlan
  -> buildSpriteStaging(plan, ...)  => plan.spriteStaging      [backend: staging]
       classifier (Jev) when configured, else deterministic from the plan
  -> ensureSpriteAssets(staging)                                [backend: sprites]
       sets: requested expressions first ("visible"), then the rest of the
       hot set ("background"); rare expressions on demand ("next")
       plates: missing plates ("visible" for the first, then "next")
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
  (`POSE_EXPRESSION_CATALOGUE`) + `solo, standing, cowboy shot, looking at
  viewer, simple background, white background, no shadow` + style suffix.
  Negative: style negative + `scenery, background, shadow, drop shadow,
  gradient background, multiple people, text`. Portrait size where the
  provider takes a size (NovelAI 832×1216). One fixed seed per set where the
  provider takes a seed, and the set's ready `idle` sprite as reference image
  where reference anchoring is on and supported, for consistency.
- Plate: style prefix + location, time of day, weather, description +
  `scenery, no humans, detailed background, wide shot` + style suffix.
  Negative: style negative + `1girl, 1boy, people, person, character,
  text`. Landscape size (NovelAI 1216×832).

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
  ("Preparing Mira 3/12"); an unready expression shows
  `bestAvailableExpression`.
- Previous/History navigation re-applies the paragraph's stage.

## Settings (frontend)

Presentation mode control; cut-out quality; model status (absent /
downloading / ready / unsupported) with Download and Remove; a sprite library
gallery (sets with their expressions on a checkerboard, plates) with Prepare
for this chat, Regenerate, Re-cut, and Delete; the model URL under Advanced.

## Cut-out (frontend)

Validated by the bake-off (anime line art and lineless painterly styles):
ISNet-anime mask → border flood fill over background-coloured pixels (mask >
0.7 guards against leaks) → enclosed near-background components whose mean
mask < 0.5 become background → separate components whose mean mask < 0.3
are dropped (brush specks) → defringe (un-mix the background colour from the
edge band). The background colour is the median of the image border.
"basic" quality skips the model. The model is downloaded once from
`spriteModelUrl` and cached in the browser; onnxruntime-web is loaded lazily
(WebGPU, else WASM) so the frontend bundle stays small.

## Not in v1

Mouth/blink variants (lip flap), full key-moment illustrations mixed into
sprite mode, face-only repaint for expression variants, parallax, front
ambient layer, persona sprite.
