import type { CharacterLifecycleSummary } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { sceneForCharacterLifecycle } from "../src/state/sessionRouting";

describe("persistent session routing", () => {
  it.each([
    [{ state: "none" }, "CharacterCreatorScene"],
    [
      {
        state: "active",
        characterId: "character-1",
        nickname: "Owczy"
      },
      "WorldScene"
    ],
    [
      {
        state: "pendingDeletion",
        characterId: "character-1",
        nickname: "Owczy",
        deletionEffectiveAt: "2026-09-19T10:00:00.000Z"
      },
      "CharacterDeletionScene"
    ]
  ] as Array<[CharacterLifecycleSummary, string]>)(
    "routes %s to %s",
    (lifecycle, expected) => {
      expect(sceneForCharacterLifecycle(lifecycle)).toBe(expected);
    }
  );
});
