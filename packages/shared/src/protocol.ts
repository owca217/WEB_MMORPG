import type { BattleCommand, BattleSnapshot } from "./battle";
import type { CharacterSnapshot, PlayerStateSnapshot } from "./character";
import type {
  BagEquipmentSlot,
  EquipmentSnapshot,
  InventorySnapshot
} from "./inventory";
import type { LocationId, PlayerId } from "./ids";
import type { PartyInvitePayload, PartySnapshot } from "./party";
import type { NpcInteractionPayload, WorldStateSnapshot } from "./world";
import type { AdminItemCatalog } from "./itemCatalog";

export interface ClientToServerEvents {
  login: (
    payload: { nickname: string },
    ack: (result: LoginResult) => void
  ) => void;
  moveIntent: (payload: { x: number; y: number }) => void;
  startEncounter: (payload: { encounterId: string }) => void;
  battleCommand: (payload: BattleCommand) => void;
  requestPlayerState: () => void;
  setContainerSlot: (payload: {
    slot: BagEquipmentSlot;
    itemInstanceId: string | null;
  }) => void;
  moveInventoryItem: (payload: {
    itemInstanceId: string;
    containerInstanceId: string | null;
  }) => void;
  requestWorldState: () => void;
  interactNpc: (payload: { npcId: string }) => void;
  healAtNpc: (payload: { npcId: string }) => void;
  claimSimpleBag: (payload: { npcId: string }) => void;
  inviteToParty: (payload: { targetPlayerId: PlayerId }) => void;
  respondPartyInvite: (payload: { inviteId: string; accept: boolean }) => void;
  setPartyBattleMode: (payload: { enabled: boolean }) => void;
  leaveParty: () => void;
  requestPartyState: () => void;
  requestAdminCatalog: () => void;
  grantAdminItem: (payload: AdminGrantRequest) => void;
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
  adminCatalog: (payload: AdminItemCatalog) => void;
  adminGrantResult: (payload: AdminGrantResult) => void;
}

export interface AdminGrantRequest {
  operationId: string;
  itemId: string;
  quantity: number;
}

export type AdminGrantResult =
  | {
      ok: true;
      operationId: string;
      inventory: InventorySnapshot;
      equipment: EquipmentSnapshot;
    }
  | {
      ok: false;
      operationId: string;
      code: string;
      message: string;
    };

export type LoginResult =
  | { ok: true; playerId: PlayerId; locationId: LocationId }
  | { ok: false; code: string; message: string };
