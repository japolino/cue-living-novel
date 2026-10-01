# Warp date image requests

Cue accepts `vn-scene-image-request-v1` window events from Warp and replies on `vn-scene-image-result-v1`. Cancellation uses `vn-scene-image-cancel-v1`; fit updates use `vn-scene-image-fit-v1`.

The version-1 request contains only `version`, `provider: "warp"`, `chatId`, `requestId`, `characterName`, `venue`, `timeOfDay` and `mood`. Additional fields, including traits, prompts, clothing, poses and connection overrides, are rejected. The frontend only routes requests for its active chat. The backend loads the initiating user's Cue settings and chat identity memory.

External scenes use the existing planner, deterministic pose catalogue, prompt compiler, image connection/workflow, reference anchoring and native-card-image path. The selected name is resolved through Cue's own registry and aliases. If the resolved visual cue depicts a different character, generation is rejected rather than substituting that character. Warp never defines appearance.

The result goes back to Warp's existing date screen; it does not open the Cue view, create a chat turn, persist an external reading turn or replace the reader's active scene. Cue identity/reference memory is shared. A separate temporary scene cache avoids interfering with the reader's cache admission and scene lifetime. Disabled Cue, disabled images or a zero image budget produce actionable errors. Duplicate request IDs join/reuse one operation; superseded or canceled operations cannot publish late results. Accepted requests have a five-minute deadline.

All Cue image-fit modes are returned. Live fit changes are broadcast without generating a new picture. Image-generation settings are selected when the request starts; fit is read again at completion.

Native-card mode is limited to a confirmed match with the chat card's character. A secondary character never receives the protagonist's avatar as a fallback; Cue reports that it needs image generation instead.

## Verification

Verified on October 1: 1,088 tests passed, type checking passed and the production build passed. The matching Warp change passed 386 tests, type checking and its production build.

```powershell
bun run verify
bun test src/backend/runtime/external-images.test.ts src/shared/cue-images.test.ts
```

The pipeline tests use scripted host/model/image responses and exercise the real Cue planner, stored appearance, pose compiler, image workflow selection, secondary-character selection, disabled settings, duplicate requests, cancellation and live fit forwarding. They do not contact production providers.

For a browser integration check, update both extensions, keep Cue's reading view closed and start a Warp date. Confirm one request to Cue's chosen provider, the correct subject, and cover/contain/fill/none/scale-down behavior. End the date or switch chats during generation: late results must be discarded. Existing native-card mode should use a card asset instead of calling the image provider.
