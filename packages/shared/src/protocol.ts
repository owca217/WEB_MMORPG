import type { BattleAutoResult, BattleCommand, BattleMode, BattleSnapshot } from "./battle";
import type { SocialAction, SocialActionResult, SocialSnapshot } from "./social";
import type { MerchantPurchase, MerchantResult } from "./merchant";
import type { CharacterSnapshot, PlayerStateSnapshot } from "./character";
import type { ChatChannel, ChatHistoryResult, ChatMessage, ChatSendResult, ChatViewport } from "./chat";
import type { InventorySnapshot, InventoryUpdateResult, SetContainerSlotResult } from "./inventory";
import type { LocationId } from "./ids";
import type { NpcInteractionPayload, WorldStateSnapshot } from "./world";
import type { WeaponLoadout, WeaponLoadoutResult } from "./weapons";
import type { HealingRequest, HealingResult, HealingTargetsResult } from "./healing";
import type { EquipmentUpdateRequest, EquipmentUpdateResult } from "./equipment";

export type SocketAuthResult =
  | { ok: true; characterId: string; locationId: LocationId }
  | { ok: false; code: string; message: string };

export interface ClientToServerEvents {
  setEquipmentSlot: (payload:EquipmentUpdateRequest,ack:(result:EquipmentUpdateResult)=>void)=>void;
  requestHealingTargets: (ack: (result: HealingTargetsResult) => void) => void;
  castHealing: (payload: HealingRequest, ack: (result: HealingResult) => void) => void;
  setWeaponLoadout: (payload:WeaponLoadout,ack:(result:WeaponLoadoutResult)=>void)=>void;
  requestMerchantShop: (payload: { npcId: string }, ack: (result: MerchantResult) => void) => void;
  purchaseMerchantItem: (payload: MerchantPurchase, ack: (result: MerchantResult) => void) => void;
  socialAction: (payload: SocialAction, ack: (result: SocialActionResult) => void) => void;
  requestSocialState: (ack: (result: SocialActionResult) => void) => void;
  authenticate: (
    payload: { sessionToken: string },
    ack: (result: SocketAuthResult) => void
  ) => void;
  moveIntent: (payload: { x: number; y: number; locationId?: LocationId }) => void;
  sendChatMessage: (
    payload: { channel: ChatChannel; text: string },
    ack: (result: ChatSendResult) => void
  ) => void;
  updateChatViewport: (payload: ChatViewport) => void;
  requestChatHistory: (ack: (result: ChatHistoryResult) => void) => void;
  startEncounter: (payload: { encounterId: string; mode?: BattleMode }) => void;
  setBattleAuto: (payload: { enabled: boolean }, ack: (result: BattleAutoResult) => void) => void;
  battleCommand: (payload: BattleCommand) => void;
  useBattleItem: (
    payload: { combatantId: string; itemInstanceId: string },
    ack: (result: InventoryUpdateResult) => void
  ) => void;
  requestPlayerState: () => void;
  requestWorldState: () => void;
  interactNpc: (payload: { npcId: string }) => void;
  healAtNpc: (payload: { npcId: string }) => void;
  setContainerSlot: (
    payload: { slotIndex: number; itemInstanceId: string | null },
    ack: (result: SetContainerSlotResult) => void
  ) => void;
  moveItemToContainer: (
    payload: { itemInstanceId: string; targetContainerInstanceId: string | null },
    ack: (result: InventoryUpdateResult) => void
  ) => void;
}

export interface ServerToClientEvents {
  socialState: (snapshot: SocialSnapshot) => void;
  chatMessage: (message: ChatMessage) => void;
  worldState: (snapshot: WorldStateSnapshot) => void;
  playerState: (snapshot: PlayerStateSnapshot) => void;
  npcInteraction: (payload: NpcInteractionPayload) => void;
  battleStarted: (snapshot: BattleSnapshot) => void;
  battleState: (snapshot: BattleSnapshot) => void;
  battleEnded: (payload: {
    outcome: "victory" | "defeat";
    inventory: InventorySnapshot;
    character: CharacterSnapshot;
    experienceGained?: number;
    levelsGained?: number;
    partyBonusExperience?: number;
    goldGained?: number;
  }) => void;
  commandRejected: (payload: { code: string; message: string }) => void;
}
