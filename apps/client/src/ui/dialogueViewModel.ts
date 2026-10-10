import type { NpcInteractionPayload } from "@web-mmorpg/shared";

export interface DialogueActions {
  showHeal: boolean;
  showBagClaim: boolean;
}

export function getDialogueActions(payload: NpcInteractionPayload): DialogueActions {
  return {
    showHeal: payload.kind === "healer" && (payload.canHeal ?? false),
    showBagClaim: payload.kind === "quartermaster"
      && (payload.canClaimSimpleBag ?? false)
      && !payload.simpleBagRewardClaimed
  };
}
