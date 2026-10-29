import type { InventorySnapshot } from "./inventory";

export interface SocialPlayer {
  id: string;
  nickname: string;
  online: boolean;
  inBattle: boolean;
  level?: number;
  unavailable?: boolean;
}
export interface PartySnapshot {
  id: string;
  leaderId: string;
  members: SocialPlayer[];
  experienceBonusPercent: number;
}
export interface PartyInvite {
  id: string;
  leader: SocialPlayer;
  membersCount: number;
  expiresAt: number;
}
export interface TradeOfferEntry { instanceId: string; quantity: number; }
export interface TradeOfferItem extends TradeOfferEntry { name: string; }
export interface TradeParticipant { player: SocialPlayer; offer: TradeOfferItem[]; confirmed: boolean; }
export interface TradeSnapshot {
  id: string;
  initiatorId: string;
  status: "invited" | "active" | "completed" | "cancelled";
  revision: number;
  participants: [TradeParticipant, TradeParticipant];
  expiresAt: number;
  cancelReason?: string;
}
export interface SocialSnapshot {
  revision?: number;
  selfId: string;
  onlinePlayers: SocialPlayer[];
  friends: SocialPlayer[];
  incomingFriendRequests: SocialPlayer[];
  outgoingFriendRequests: SocialPlayer[];
  party: PartySnapshot | null;
  partyInvites: PartyInvite[];
  trade: TradeSnapshot | null;
}
export type SocialAction =
  | { type: "requestFriend"; nickname: string }
  | { type: "respondFriend"; playerId: string; accept: boolean }
  | { type: "removeFriend"; playerId: string }
  | { type: "inviteParty"; playerId: string }
  | { type: "respondParty"; inviteId: string; accept: boolean }
  | { type: "leaveParty" }
  | { type: "kickParty"; playerId: string }
  | { type: "requestTrade"; playerId: string }
  | { type: "respondTrade"; tradeId: string; accept: boolean }
  | { type: "setTradeOffer"; tradeId: string; revision: number; items: TradeOfferEntry[] }
  | { type: "confirmTrade"; tradeId: string; revision: number }
  | { type: "cancelTrade"; tradeId: string };
export type SocialActionResult =
  | { ok: true; social: SocialSnapshot; inventory?: InventorySnapshot }
  | { ok: false; code: string; message: string };
