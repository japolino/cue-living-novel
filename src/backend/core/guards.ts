import type { AssetJob, TurnKey } from "../../shared/contracts.js";

export type AcceptanceDecision =
  | { accepted: true }
  | { accepted: false; reason: "no_active_turn" | "chat_changed" | "message_changed" | "swipe_changed" | "source_changed" | "turn_revision_changed" | "scene_changed" | "scene_revision_changed" };

function swipeEquals(left: TurnKey["swipeId"], right: TurnKey["swipeId"]): boolean {
  return left === right;
}

export function compareTurnKeys(active: TurnKey | null, candidate: TurnKey): AcceptanceDecision {
  if (!active) return { accepted: false, reason: "no_active_turn" };
  if (active.chatId !== candidate.chatId) return { accepted: false, reason: "chat_changed" };
  if (active.assistantMessageId !== candidate.assistantMessageId) return { accepted: false, reason: "message_changed" };
  if (!swipeEquals(active.swipeId, candidate.swipeId)) return { accepted: false, reason: "swipe_changed" };
  if (active.sourceFingerprint !== candidate.sourceFingerprint) return { accepted: false, reason: "source_changed" };
  if (active.revision !== candidate.revision) return { accepted: false, reason: "turn_revision_changed" };
  return { accepted: true };
}

export function canAcceptAssetResult(
  activeTurn: TurnKey | null,
  activeScene: { sceneId: string; revision: number } | null,
  job: AssetJob
): AcceptanceDecision {
  const turnDecision = compareTurnKeys(activeTurn, job.ownerTurnKey);
  if (!turnDecision.accepted) return turnDecision;
  if (!activeScene || activeScene.sceneId !== job.sceneId) return { accepted: false, reason: "scene_changed" };
  if (activeScene.revision !== job.sceneRevision) return { accepted: false, reason: "scene_revision_changed" };
  return { accepted: true };
}

export function turnKeyEquals(left: TurnKey, right: TurnKey): boolean {
  return compareTurnKeys(left, right).accepted;
}

