import type { UserRole } from "./admin";
import type { BattleCommand, BattleSnapshot } from "./battle";
import type { CharacterSnapshot, PlayerStateSnapshot } from "./character";
import type { InventorySnapshot } from "./inventory";
import type { LocationId, PlayerId } from "./ids";
import type { NpcInteractionPayload, WorldStateSnapshot } from "./world";

export type SocketAuthResult =
  | { ok: true; characterId: string; locationId: LocationId }
  | { ok: false; code: string; message: string };

export interface ClientToServerEvents {
  authenticate: (
    payload: { sessionToken: string },
    ack: (result: SocketAuthResult) => void
  ) => void;
  /** @deprecated Transitional adapter. Removed when socket auth is migrated in Task 7. */
  login: (
    payload: { nickname: string; adminToken?: string },
    ack: (result: LoginResult) => void
  ) => void;
  moveIntent: (payload: { x: number; y: number }) => void;
  startEncounter: (payload: { encounterId: string }) => void;
  battleCommand: (payload: BattleCommand) => void;
  requestPlayerState: () => void;
  requestWorldState: () => void;
  interactNpc: (payload: { npcId: string }) => void;
  healAtNpc: (payload: { npcId: string }) => void;
}

export interface ServerToClientEvents {
  worldState: (snapshot: WorldStateSnapshot) => void;
  playerState: (snapshot: PlayerStateSnapshot) => void;
  npcInteraction: (payload: NpcInteractionPayload) => void;
  battleStarted: (snapshot: BattleSnapshot) => void;
  battleState: (snapshot: BattleSnapshot) => void;
  battleEnded: (payload: {
    outcome: "victory" | "defeat";
    inventory: InventorySnapshot;
    character: CharacterSnapshot;
  }) => void;
  commandRejected: (payload: { code: string; message: string }) => void;
}

export type LoginResult =
  | {
      ok: true;
      playerId: PlayerId;
      locationId: LocationId;
      sessionToken: string;
      role: UserRole;
    }
  | { ok: false; code: string; message: string };
