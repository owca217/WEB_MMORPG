import type { NpcInteractionPayload } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { getDialogueActions } from "../src/ui/dialogueViewModel";

function interaction(
  overrides: Partial<NpcInteractionPayload> = {}
): NpcInteractionPayload {
  return {
    npcId: "guide-boran",
    npcName: "Boran",
    kind: "guide",
    title: "Rozmowa",
    lines: [],
    canHeal: false,
    canClaimSimpleBag: false,
    simpleBagRewardClaimed: false,
    ...overrides
  } as NpcInteractionPayload;
}

describe("dialogue view model", () => {
  it("offers the bag only to an eligible quartermaster visitor", () => {
    expect(getDialogueActions(interaction({
      npcId: "quartermaster-runa",
      kind: "quartermaster",
      canClaimSimpleBag: true
    }))).toEqual({ showHeal: false, showBagClaim: true });
  });

  it("hides a claimed reward while preserving healer actions", () => {
    expect(getDialogueActions(interaction({
      npcId: "healer-ada",
      kind: "healer",
      canHeal: true,
      simpleBagRewardClaimed: true
    }))).toEqual({ showHeal: true, showBagClaim: false });
  });

  it("does not show actions for a guide", () => {
    expect(getDialogueActions(interaction())).toEqual({
      showHeal: false,
      showBagClaim: false
    });
  });
});
