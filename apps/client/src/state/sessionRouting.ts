import type {
  CharacterLifecycleSummary
} from "@web-mmorpg/shared";

export type PersistentSessionScene =
  | "CharacterCreatorScene"
  | "WorldScene"
  | "CharacterDeletionScene";

export function sceneForCharacterLifecycle(
  lifecycle: CharacterLifecycleSummary
): PersistentSessionScene {
  if (lifecycle.state === "none") return "CharacterCreatorScene";
  if (lifecycle.state === "active") return "WorldScene";
  return "CharacterDeletionScene";
}
