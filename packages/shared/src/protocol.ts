import type { BattleCommand, BattleSnapshot } from "./battle";
import type { PlayerStateSnapshot } from "./character";
import type { InventorySnapshot } from "./inventory";
import type { LocationId, PlayerId } from "./ids";
import type { WorldStateSnapshot } from "./world";

export interface ClientToServerEvents {
  login: (
    payload: { nickname: string },
    ack: (result: LoginResult) => void
  ) => void;
  moveIntent: (payload: { x: number; y: number }) => void;
  startEncounter: (payload: { encounterId: string }) => void;
  battleCommand: (payload: BattleCommand) => void;
  requestPlayerState: () => void;
  requestWorldState: () => void;
}

export interface ServerToClientEvents {
  worldState: (snapshot: WorldStateSnapshot) => void;
  playerState: (snapshot: PlayerStateSnapshot) => void;
  battleStarted: (snapshot: BattleSnapshot) => void;
  battleState: (snapshot: BattleSnapshot) => void;
  battleEnded: (payload: { inventory: InventorySnapshot }) => void;
  commandRejected: (payload: { code: string; message: string }) => void;
}

export type LoginResult =
  | { ok: true; playerId: PlayerId; locationId: LocationId }
  | { ok: false; code: string; message: string };
