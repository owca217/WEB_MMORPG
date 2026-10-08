import type {
  AccountRole,
  CharacterLifecycleSummary,
  PlayerId
} from "@web-mmorpg/shared";

export type PersistentSessionScene =
  | "CharacterCreatorScene"
  | "WorldScene"
  | "CharacterDeletionScene";

export interface WorldSceneRouteData {
  playerId: PlayerId;
  accountRole: AccountRole;
}

export function worldSceneData(
  playerId: PlayerId,
  accountRole: AccountRole = "PLAYER"
): WorldSceneRouteData {
  return { playerId, accountRole };
}

export function sceneForCharacterLifecycle(
  lifecycle: CharacterLifecycleSummary
): PersistentSessionScene {
  if (lifecycle.state === "none") return "CharacterCreatorScene";
  if (lifecycle.state === "active") return "WorldScene";
  return "CharacterDeletionScene";
}
