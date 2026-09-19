import type { PlayerId } from "./ids";

export interface PartyMemberSnapshot {
  playerId: PlayerId;
  nickname: string;
  leader: boolean;
}

export interface PartySnapshot {
  id: string;
  leaderPlayerId: PlayerId;
  maxMembers: number;
  members: PartyMemberSnapshot[];
}

export interface PartyInvitePayload {
  inviteId: string;
  inviterPlayerId: PlayerId;
  inviterNickname: string;
  expiresAt: number;
}
