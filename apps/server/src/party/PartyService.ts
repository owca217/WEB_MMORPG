import { randomUUID } from "node:crypto";
import type {
  PartyInvitePayload,
  PartySnapshot,
  PlayerId
} from "@web-mmorpg/shared";

interface PlayerIdentity {
  playerId: PlayerId;
  nickname: string;
}

interface PartyState {
  id: string;
  leaderPlayerId: PlayerId;
  members: Map<PlayerId, string>;
  partyBattleEnabled: boolean;
}

interface PendingInvite extends PartyInvitePayload {
  targetPlayerId: PlayerId;
  targetNickname: string;
}

export interface PartyInviteResponse {
  accepted: boolean;
  inviterPlayerId: PlayerId;
  targetNickname: string;
  affectedPlayerIds: PlayerId[];
}

export class PartyService {
  private readonly parties = new Map<string, PartyState>();
  private readonly partyByPlayer = new Map<PlayerId, string>();
  private readonly invites = new Map<string, PendingInvite>();

  constructor(
    private readonly maxMembers = 5,
    private readonly inviteTtlMs = 60_000
  ) {}

  createInvite(
    inviter: PlayerIdentity,
    target: PlayerIdentity,
    now = Date.now()
  ): PartyInvitePayload {
    this.deleteExpiredInvites(now);

    if (inviter.playerId === target.playerId) {
      throw new Error("PARTY_SELF_INVITE");
    }

    const inviterParty = this.partyFor(inviter.playerId);
    if (inviterParty && inviterParty.leaderPlayerId !== inviter.playerId) {
      throw new Error("PARTY_ONLY_LEADER_CAN_INVITE");
    }
    if (this.partyByPlayer.has(target.playerId)) {
      throw new Error("PARTY_TARGET_ALREADY_IN_PARTY");
    }
    if (inviterParty && inviterParty.members.size >= this.maxMembers) {
      throw new Error("PARTY_FULL");
    }

    for (const [inviteId, invite] of this.invites) {
      if (
        invite.inviterPlayerId === inviter.playerId &&
        invite.targetPlayerId === target.playerId
      ) {
        this.invites.delete(inviteId);
      }
    }

    const invite: PendingInvite = {
      inviteId: randomUUID(),
      inviterPlayerId: inviter.playerId,
      inviterNickname: inviter.nickname,
      targetPlayerId: target.playerId,
      targetNickname: target.nickname,
      expiresAt: now + this.inviteTtlMs
    };
    this.invites.set(invite.inviteId, invite);
    return this.toInvitePayload(invite);
  }

  respondToInvite(
    inviteId: string,
    targetPlayerId: PlayerId,
    accept: boolean,
    now = Date.now()
  ): PartyInviteResponse {
    const invite = this.invites.get(inviteId);
    if (!invite || invite.targetPlayerId !== targetPlayerId) {
      throw new Error("PARTY_INVITE_NOT_FOUND");
    }
    if (invite.expiresAt <= now) {
      this.invites.delete(inviteId);
      throw new Error("PARTY_INVITE_EXPIRED");
    }

    this.invites.delete(inviteId);

    if (!accept) {
      return {
        accepted: false,
        inviterPlayerId: invite.inviterPlayerId,
        targetNickname: invite.targetNickname,
        affectedPlayerIds: []
      };
    }

    if (this.partyByPlayer.has(targetPlayerId)) {
      throw new Error("PARTY_TARGET_ALREADY_IN_PARTY");
    }

    let party = this.partyFor(invite.inviterPlayerId);
    if (party) {
      if (party.leaderPlayerId !== invite.inviterPlayerId) {
        throw new Error("PARTY_ONLY_LEADER_CAN_INVITE");
      }
      if (party.members.size >= this.maxMembers) {
        throw new Error("PARTY_FULL");
      }
    } else {
      party = {
        id: randomUUID(),
        leaderPlayerId: invite.inviterPlayerId,
        members: new Map([[invite.inviterPlayerId, invite.inviterNickname]]),
        partyBattleEnabled: true
      };
      this.parties.set(party.id, party);
      this.partyByPlayer.set(invite.inviterPlayerId, party.id);
    }

    party.members.set(targetPlayerId, invite.targetNickname);
    this.partyByPlayer.set(targetPlayerId, party.id);
    this.deleteInvitesFor(targetPlayerId);

    return {
      accepted: true,
      inviterPlayerId: invite.inviterPlayerId,
      targetNickname: invite.targetNickname,
      affectedPlayerIds: [...party.members.keys()]
    };
  }

  setPartyBattleEnabled(
    requesterPlayerId: PlayerId,
    enabled: boolean
  ): PlayerId[] {
    const party = this.partyFor(requesterPlayerId);
    if (!party) throw new Error("PARTY_NOT_FOUND");
    if (party.leaderPlayerId !== requesterPlayerId) {
      throw new Error("PARTY_ONLY_LEADER_CAN_TOGGLE_BATTLE");
    }

    party.partyBattleEnabled = enabled;
    return [...party.members.keys()];
  }

  leave(playerId: PlayerId): PlayerId[] {
    const party = this.partyFor(playerId);
    this.deleteInvitesFor(playerId);
    if (!party) return [playerId];

    const affected = [
      playerId,
      ...[...party.members.keys()].filter((id) => id !== playerId)
    ];
    party.members.delete(playerId);
    this.partyByPlayer.delete(playerId);

    if (party.members.size === 0) {
      this.parties.delete(party.id);
      return affected;
    }

    if (party.leaderPlayerId === playerId) {
      party.leaderPlayerId = party.members.keys().next().value as PlayerId;
    }

    return affected;
  }

  removePlayer(playerId: PlayerId): PlayerId[] {
    return this.leave(playerId);
  }

  getSnapshot(playerId: PlayerId): PartySnapshot | null {
    const party = this.partyFor(playerId);
    if (!party) return null;

    return {
      id: party.id,
      leaderPlayerId: party.leaderPlayerId,
      maxMembers: this.maxMembers,
      partyBattleEnabled: party.partyBattleEnabled,
      members: [...party.members].map(([memberId, nickname]) => ({
        playerId: memberId,
        nickname,
        leader: memberId === party.leaderPlayerId
      }))
    };
  }

  private partyFor(playerId: PlayerId): PartyState | undefined {
    const partyId = this.partyByPlayer.get(playerId);
    return partyId ? this.parties.get(partyId) : undefined;
  }

  private deleteExpiredInvites(now: number): void {
    for (const [inviteId, invite] of this.invites) {
      if (invite.expiresAt <= now) this.invites.delete(inviteId);
    }
  }

  private deleteInvitesFor(playerId: PlayerId): void {
    for (const [inviteId, invite] of this.invites) {
      if (
        invite.inviterPlayerId === playerId ||
        invite.targetPlayerId === playerId
      ) {
        this.invites.delete(inviteId);
      }
    }
  }

  private toInvitePayload(invite: PendingInvite): PartyInvitePayload {
    return {
      inviteId: invite.inviteId,
      inviterPlayerId: invite.inviterPlayerId,
      inviterNickname: invite.inviterNickname,
      expiresAt: invite.expiresAt
    };
  }
}
