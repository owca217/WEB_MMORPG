import { describe, expect, it } from "vitest";
import type { SocialPlayer } from "@web-mmorpg/shared";
import { PartyService } from "../src/social/PartyService";

function setup() {
  let now = 1_000;
  const players = new Map<string, SocialPlayer>();
  const positions = new Map<string, { locationId: string; x: number; y: number }>();
  for (let index = 1; index <= 8; index += 1) {
    const id = `p${index}`;
    players.set(id, { id, nickname: `Hero${index}`, online: true, inBattle: false });
    positions.set(id, { locationId: "forest", x: index * 10, y: 0 });
  }
  const service = new PartyService(id => players.get(id), id => positions.get(id), () => now);
  function join(leader: string, member: string) {
    service.invite(leader, member);
    const invite = service.getInvites(member).find(entry => entry.leader.id === leader)!;
    service.respond(member, invite.id, true);
  }
  return { service, players, positions, join, advance: (ms: number) => { now += ms; } };
}

describe("ephemeral parties", () => {
  it("requires an online leader and recipient consent, and prevents another player accepting their invite", () => {
    const { service, join, players } = setup();
    service.invite("p1", "p2");
    expect(service.getParty("p2")).toBeNull();
    const invite = service.getInvites("p2")[0]!;
    expect(() => service.respond("p3", invite.id, true)).toThrow("PARTY_INVITE_NOT_FOUND");
    service.respond("p2", invite.id, true);
    expect(service.getParty("p2")).toMatchObject({ leaderId: "p1", experienceBonusPercent: 10 });
    expect(() => service.invite("p2", "p3")).toThrow("PARTY_LEADER_REQUIRED");
    players.get("p3")!.online = false;
    expect(() => service.invite("p1", "p3")).toThrow("PLAYER_OFFLINE");
    expect(() => join("p1", "p1")).toThrow("PARTY_SELF_INVITE");
  });

  it("expires invitations after 60 seconds and rejects stale invitations after leader changes", () => {
    const { service, join, advance } = setup();
    service.invite("p1", "p2");
    const expired = service.getInvites("p2")[0]!;
    advance(60_000);
    expect(service.getInvites("p2")).toEqual([]);
    expect(() => service.respond("p2", expired.id, true)).toThrow("PARTY_INVITE_NOT_FOUND");
    join("p1", "p2");
    service.invite("p1", "p3");
    const stale = service.getInvites("p3")[0]!;
    service.leave("p1");
    expect(service.getParty("p2")?.leaderId).toBe("p2");
    expect(() => service.respond("p3", stale.id, true)).toThrow("PARTY_INVITE_NOT_FOUND");
  });

  it("rechecks capacity when multiple invitations are accepted and caps the party at five", () => {
    const { service, join } = setup();
    for (const member of ["p2", "p3", "p4"]) join("p1", member);
    service.invite("p1", "p5");
    service.invite("p1", "p6");
    const last = service.getInvites("p6")[0]!;
    service.respond("p5", service.getInvites("p5")[0]!.id, true);
    expect(() => service.respond("p6", last.id, true)).toThrow("PARTY_FULL");
    expect(service.getParty("p1")?.members).toHaveLength(5);
    expect(service.getParty("p6")).toBeNull();
  });

  it("requires leader authority to kick, transfers leadership, and removes disconnected members", () => {
    const { service, join } = setup();
    join("p1", "p2");
    join("p1", "p3");
    expect(() => service.kick("p2", "p3")).toThrow("PARTY_LEADER_REQUIRED");
    expect(() => service.kick("p1", "p1")).toThrow("PARTY_CANNOT_KICK_SELF");
    service.kick("p1", "p3");
    expect(service.getParty("p3")).toBeNull();
    service.removeDisconnected("p1");
    expect(service.getParty("p2")?.leaderId).toBe("p2");
    service.removeDisconnected("p2");
    expect(service.getParty("p2")).toBeNull();
  });

  it("counts only members present at encounter start and victory, online and nearby on the same map", () => {
    const { service, join, positions, players } = setup();
    join("p1", "p2");
    join("p1", "p3");
    join("p1", "p4");
    const context = service.captureExperienceContext("p1");
    join("p1", "p5");
    players.get("p2")!.inBattle = true;
    positions.get("p2")!.x = positions.get("p1")!.x + 800;
    positions.get("p3")!.locationId = "cave";
    positions.get("p4")!.x = 900;
    expect(service.getExperienceBonus("p1", context)).toBe(10);
    players.get("p2")!.online = false;
    expect(service.getExperienceBonus("p1", context)).toBe(0);
    players.get("p2")!.online = true;
    service.leave("p2");
    expect(service.getExperienceBonus("p1", context)).toBe(0);
    service.leave("p1");
    expect(service.getExperienceBonus("p1", context)).toBe(0);
  });

  it("awards up to forty percent and gives no bonus for a solo encounter", () => {
    const { service, join } = setup();
    const solo = service.captureExperienceContext("p1");
    for (const member of ["p2", "p3", "p4", "p5"]) join("p1", member);
    expect(service.getExperienceBonus("p1", solo)).toBe(0);
    expect(service.getExperienceBonus("p1", service.captureExperienceContext("p1"))).toBe(40);
  });
});
