import { CUE_IMAGE_REQUEST, CUE_IMAGE_RESULT, CUE_IMAGE_CANCEL, CUE_IMAGE_FIT, parseImageRequest, parseImageResult, imageIdentity,
  type ImageFit, type CueImageResult } from "../../shared/cue-images.js";
import type { FrontendRequest } from "../../protocol.js";

export function connectImageBridge(target: EventTarget, chatId: () => string | null, send: (r: FrontendRequest) => void) {
  const pending = new Map<string, string>();
  const onRequest = (event: Event) => {
    const r = parseImageRequest((event as CustomEvent).detail);
    if (!r || r.chatId !== chatId()) return;
    pending.set(r.requestId, r.chatId);
    target.dispatchEvent(new CustomEvent(CUE_IMAGE_RESULT, { detail: {
      version: 1, provider: "warp", chatId: r.chatId, requestId: r.requestId, status: "accepted",
    } }));
    send({ type: "vn_external_image", request: r });
  };
  const onCancel = (event: Event) => {
    const r = (event as CustomEvent).detail;
    if (!imageIdentity(r) || pending.get(r.requestId) !== r.chatId) return;
    pending.delete(r.requestId);
    send({ type: "vn_external_image_cancel", request: r });
  };
  target.addEventListener(CUE_IMAGE_REQUEST, onRequest);
  target.addEventListener(CUE_IMAGE_CANCEL, onCancel);
  function result(value: CueImageResult) {
    const r = parseImageResult(value);
    if (!r || pending.get(r.requestId) !== r.chatId) return;
    if (r.status !== "accepted") pending.delete(r.requestId);
    if (r.chatId === chatId()) target.dispatchEvent(new CustomEvent(CUE_IMAGE_RESULT, { detail: r }));
  }
  function destroy() {
    target.removeEventListener(CUE_IMAGE_REQUEST, onRequest);
    target.removeEventListener(CUE_IMAGE_CANCEL, onCancel);
    for (const [requestId, chatId] of pending) send({ type: "vn_external_image_cancel", request: { version: 1, provider: "warp", chatId, requestId } });
    pending.clear();
  }
  function fit(fit: ImageFit) {
    const id = chatId();
    if (id) target.dispatchEvent(new CustomEvent(CUE_IMAGE_FIT, { detail: { version: 1, chatId: id, fit } }));
  }
  return { result, destroy, fit };
}
