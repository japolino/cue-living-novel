# Cue read aloud — scope, contracts, and truthful limitations

Cue can read each assistant paragraph aloud through the **Choir** companion
extension. Read aloud is **off by default**, lives entirely in the frontend
overlay, and needs Choir: Choir casts the voices and holds the provider keys,
so Cue stores no voice, provider or key.

## How it works

- Settings live in the **Cue** settings tab, **Voice** (`src/frontend/speech/settings-ui.ts`),
  persisted in the extension config as `config.speech` (`src/speech-config.ts`):
  `enabled` (Read each paragraph aloud, off by default), `muteNarrator`
  (dialogue only) and `choirSound` (Sound from Choir, on by default). The Voice
  section is shown only while Choir is present in the page.
- Voices are cast in Choir: **Open Choir voice setup** opens Choir's drawer.
  Cue has no voice pickers.
- Reading: with read aloud on, each new paragraph is sent to Choir as it
  appears (`window.__CHOIR_API__.playParagraph`, `src/frontend/host/choir-bridge.ts`),
  with the speaker name the nameplate shows (`""` is the Narrator, `null`
  falls back to the turn speaker) and the next paragraph's text. Browsers allow
  sound only after a user gesture, so reading starts once the page has had a
  click or key press, or after one Play. Text effect tags are removed first.
- The dock (`src/frontend/speech/ui.ts`) shows while read aloud is on and Choir
  is present: Play/Pause and Stop for the current paragraph and a status line.
  Choir cannot resume mid-paragraph, so Play after Pause starts the paragraph
  over. The dock is a top-center pill, clear of the bottom dialogue box and the
  reading controls, offset by `env(safe-area-inset-top)`. While a paragraph is
  read (or paused), Auto waits for it.
- Lifecycle: a cursor change aborts the paragraph in flight and lets the next
  `playParagraph` hand over (Choir keeps its ambience and music running).
  Stop, Pause, chat switch, closing the view, a hidden page, and turning read
  aloud or Mute narrator on or off stop the paragraph in flight with Choir's
  `stop()`. Late statuses of an
  aborted paragraph are dropped. Same-turn rebroadcasts (image/asset updates)
  never replay a paragraph.
- Sound from Choir: see "Sound from Choir" in the README and ARCHITECTURE.md.

## Truthful limitations

- **Choir is required**: without Choir nothing is read; Play reports that read
  aloud needs Choir. Older configs that held Lumiverse TTS-profile voices
  (narrator, character default, per-character overrides, delivery tags),
  auto-play or a speech volume drop those fields on load.
- **One voice per paragraph**: attribution metadata is per-paragraph name only,
  so Cue hands Choir one speaker per paragraph; Choir splits dialogue and
  narration inside it.
- **Cost**: each paragraph is one request on the voice service set up in Choir,
  which may cost credits. Aborting may not stop provider-side billing.
- **No measured audio quality claims**: all tests are offline with a fake Choir.
