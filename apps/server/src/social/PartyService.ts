import { randomUUID } from "node:crypto";
import type { PartyInvite, PartySnapshot, SocialPlayer } from "@web-mmorpg/shared";

export interface PartyExperienceContext {
  readonly partyId: string;
  readonly memberIds: readonly string[];
}

interface Party {
  id: string;
  leaderId: string;
  members: Map<string, SocialPlayer>;
}
interface Invitation {
  id: string;
  partyId: string;
  leaderId: string;
  recipientId: string;
  expiresAt: number;
}
interface Position { locationId: string; x: number; y: number; }

const MAX_PARTY_MEMBERS = 5;
const MAX_INVITES_PER_PLAYER = 20;
const MAX_INVITES = 1_000;
const INVITATION_DURATION_MS = 60_000;
const BONUS_DISTANCE = 800;

export class PartyService {
  private readonly parties = new Map<string, Party>();
  private readonly membership = new Map<string, string>();
  private readonly invitations = new Map<string, Invitation>();

  constructor(
    private readonly getPlayer: (id: string) => SocialPlayer | undefined,
    private readonly getPosition: (id: string) => Position | undefined,
    private readonly now: () => number = Date.now
  ) {}

  invite(actorId: string, otherId: string): void {
    this.pruneInvitations();
    if (actorId === otherId) throw new Error("PARTY_SELF_INVITE");
    const actor = this.requireOnline(actorId);
    this.requireOnline(otherId);
    let party = this.findParty(actorId);
    if (party && party.leaderId !== actorId) throw new Error("PARTY_LEADER_REQUIRED");
    if (this.membership.has(otherId)) throw new Error("PLAYER_ALREADY_IN_PARTY");
    if (party && party.members.size >= MAX_PARTY_MEMBERS) throw new Error("PARTY_FULL");
    const invitations = [...this.invitations.values()];
    if (invitations.some(invite => invite.leaderId === actorId && invite.recipientId === otherId)) {
      throw new Error("PARTY_INVITE_EXISTS");
    }
    if (invitations.length >= MAX_INVITES ||
        invitations.filter(invite => invite.leaderId === actorId).length >= MAX_INVITES_PER_PLAYER ||
        invitations.filter(invite => invite.recipientId === otherId).length >= MAX_INVITES_PER_PLAYER) {
      throw new Error("PARTY_INVITE_LIMIT_REACHED");
    }
    if (!party) {
      party = { id: randomUUID(), leaderId: actorId, members: new Map([[actorId, { ...actor }]]) };
      this.parties.set(party.id, party);
      this.membership.set(actorId, party.id);
    }
    const id = randomUUID();
    this.invitations.set(id, {
      id, partyId: party.id, leaderId: actorId, recipientId: otherId,
      expiresAt: this.now() + INVITATION_DURATION_MS
    });
  }

  respond(actorId: string, inviteId: string, accept: boolean): void {
    this.pruneInvitations();
    const invitation = this.invitations.get(inviteId);
    if (!invitation || invitation.recipientId !== actorId) throw new Error("PARTY_INVITE_NOT_FOUND");
    if (!accept) {
      this.invitations.delete(inviteId);
      return;
    }
    const actor = this.requireOnline(actorId);
    const party = this.parties.get(invitation.partyId);
    if (!party || party.leaderId !== invitation.leaderId) throw new Error("PARTY_INVITE_NOT_FOUND");
    this.requireOnline(party.leaderId);
    if (this.membership.has(actorId)) throw new Error("PLAYER_ALREADY_IN_PARTY");
    if (party.members.size >= MAX_PARTY_MEMBERS) throw new Error("PARTY_FULL");
    party.members.set(actorId, { ...actor });
    this.membership.set(actorId, party.id);
    for (const [id, invite] of this.invitations) {
      if (invite.recipientId === actorId) this.invitations.delete(id);
    }
  }

  leave(actorId: string): void {
    const party = this.findParty(actorId);
    if (!party) throw new Error("PARTY_NOT_FOUND");
    this.removeMember(party, actorId);
  }

  kick(actorId: string, otherId: string): void {
    const party = this.findParty(actorId);
    if (!party) throw new Error("PARTY_NOT_FOUND");
    if (party.leaderId !== actorId) throw new Error("PARTY_LEADER_REQUIRED");
    if (actorId === otherId) throw new Error("PARTY_CANNOT_KICK_SELF");
    if (!party.members.has(otherId)) throw new Error("PARTY_MEMBER_NOT_FOUND");
    this.removeMember(party, otherId);
  }

  removeDisconnected(id: string): void {
    const party = this.findParty(id);
    if (party) this.removeMember(party, id);
    for (const [inviteId, invite] of this.invitations) {
      if (invite.recipientId === id || invite.leaderId === id) this.invitations.delete(inviteId);
    }
  }

  getParty(actorId: string): PartySnapshot | null {
    const party = this.findParty(actorId);
    return party ? {
      id: party.id, leaderId: party.leaderId,
      members: [...party.members].map(([id, player]) => ({ ...(this.getPlayer(id) ?? { ...player, online: false, inBattle: false }) })),
      experienceBonusPercent: Math.min(40, (party.members.size - 1) * 10)
    } : null;
  }

  getInvites(actorId: string): PartyInvite[] {
    this.pruneInvitations();
    const invitations: PartyInvite[] = [];
    for (const invite of this.invitations.values()) {
      if (invite.recipientId !== actorId) continue;
      const party = this.parties.get(invite.partyId);
      const leader = this.getPlayer(invite.leaderId);
      if (party && party.leaderId === invite.leaderId && leader?.online) {
        invitations.push({ id: invite.id, leader: { ...leader }, membersCount: party.members.size, expiresAt: invite.expiresAt });
      }
    }
    return invitations;
  }

  captureExperienceContext(actorId: string): PartyExperienceContext | null {
    const party = this.findParty(actorId);
    return party ? { partyId: party.id, memberIds: [...party.members.keys()] } : null;
  }

  getExperienceBonus(actorId: string, context: PartyExperienceContext | null | undefined): number {
    const party = this.findParty(actorId);
    const origin = this.getPosition(actorId);
    if (!context || !party || context.partyId !== party.id || !context.memberIds.includes(actorId) ||
        !this.getPlayer(actorId)?.online || !this.validPosition(origin)) return 0;
    let nearbyMembers = 0;
    for (const id of context.memberIds) {
      if (id === actorId || !party.members.has(id) || !this.getPlayer(id)?.online) continue;
      const position = this.getPosition(id);
      if (this.validPosition(position) && position.locationId === origin.locationId &&
          Math.hypot(position.x - origin.x, position.y - origin.y) <= BONUS_DISTANCE) nearbyMembers += 1;
    }
    return Math.min(40, nearbyMembers * 10);
  }

  private validPosition(position: Position | undefined): position is Position {
    return !!position && Number.isFinite(position.x) && Number.isFinite(position.y);
  }

  private findParty(id: string): Party | undefined {
    const partyId = this.membership.get(id);
    return partyId ? this.parties.get(partyId) : undefined;
  }

  private requireOnline(id: string): SocialPlayer {
    const player = this.getPlayer(id);
    if (!player?.online) throw new Error("PLAYER_OFFLINE");
    return player;
  }

  private removeMember(party: Party, id: string): void {
    party.members.delete(id);
    this.membership.delete(id);
    if (party.members.size === 0 || party.leaderId === id) {
      for (const [inviteId, invite] of this.invitations) {
        if (invite.partyId === party.id) this.invitations.delete(inviteId);
      }
      if (party.members.size === 0) this.parties.delete(party.id);
      else party.leaderId = party.members.keys().next().value!;
    }
  }

  private pruneInvitations(): void {
    const now = this.now();
    for (const [id, invite] of this.invitations) {
      if (invite.expiresAt <= now) this.invitations.delete(id);
    }
  }
}
