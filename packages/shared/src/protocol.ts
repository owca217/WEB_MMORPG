import type { BattleCommand, BattleSnapshot } from "./battle";
import type { CharacterSnapshot, PlayerStateSnapshot } from "./character";
import type { InventorySnapshot } from "./inventory";
import type { LocationId, PlayerId } from "./ids";
import type { PartyInvitePayload, PartySnapshot } from "./party";
import type { NpcInteractionPayload, WorldStateSnapshot } from "./world";

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
  interactNpc: (payload: { npcId: string }) => void;
  healAtNpc: (payload: { npcId: string }) => void;
  inviteToParty: (payload: { targetPlayerId: PlayerId }) => void;
  respondPartyInvite: (payload: { inviteId: string; accept: boolean }) => void;
  leaveParty: () => void;
  requestPartyState: () => void;
}

export interface ServerToClientEvents {
  sessionReplaced: () => void;
  worldState: (snapshot: WorldStateSnapshot) => void;
  playerState: (snapshot: PlayerStateSnapshot) => void;
  npcInteraction: (payload: NpcInteractionPayload) => void;
  partyInviteReceived: (payload: PartyInvitePayload) => void;
  partyInviteResolved: (payload: {
    targetPlayerId: PlayerId;
    targetNickname: string;
    accepted: boolean;
  }) => void;
  partyState: (snapshot: PartySnapshot | null) => void;
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
  | { ok: true; playerId: PlayerId; locationId: LocationId }
  | { ok: false; code: string; message: string };
