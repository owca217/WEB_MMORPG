import { describe, expect, it } from "vitest";
import { PartyService } from "../src/party/PartyService";

describe("PartyService", () => {
  it("creates a party only after the invited player accepts", () => {
    const parties = new PartyService();
    const invite = parties.createInvite(
      { playerId: "p1", nickname: "Owczy" },
      { playerId: "p2", nickname: "Karolina" },
      1000
    );

    expect(parties.getSnapshot("p1")).toBeNull();
    const result = parties.respondToInvite(invite.inviteId, "p2", true, 1100);

    expect(result.accepted).toBe(true);
    expect(parties.getSnapshot("p1")).toMatchObject({
      leaderPlayerId: "p1",
      maxMembers: 5,
      partyBattleEnabled: true
    });
    expect(
      parties.getSnapshot("p2")?.members.map((member) => member.nickname)
    ).toEqual(["Owczy", "Karolina"]);
  });

  it("allows only the leader to invite another player", () => {
    const parties = new PartyService();
    const invite = parties.createInvite(
      { playerId: "p1", nickname: "Owczy" },
      { playerId: "p2", nickname: "Karolina" }
    );
    parties.respondToInvite(invite.inviteId, "p2", true);

    expect(() =>
      parties.createInvite(
        { playerId: "p2", nickname: "Karolina" },
        { playerId: "p3", nickname: "Boran" }
      )
    ).toThrowError("PARTY_ONLY_LEADER_CAN_INVITE");
  });

  it("allows only the leader to toggle party battles", () => {
    const parties = new PartyService();
    const invite = parties.createInvite(
      { playerId: "p1", nickname: "Owczy" },
      { playerId: "p2", nickname: "Karolina" }
    );
    parties.respondToInvite(invite.inviteId, "p2", true);

    expect(() =>
      parties.setPartyBattleEnabled("p2", false)
    ).toThrowError("PARTY_ONLY_LEADER_CAN_TOGGLE_BATTLE");

    expect(parties.setPartyBattleEnabled("p1", false)).toEqual([
      "p1",
      "p2"
    ]);
    expect(parties.getSnapshot("p1")?.partyBattleEnabled).toBe(false);
    expect(parties.getSnapshot("p2")?.partyBattleEnabled).toBe(false);
  });

  it("promotes the next member when the leader leaves", () => {
    const parties = new PartyService();
    const invite = parties.createInvite(
      { playerId: "p1", nickname: "Owczy" },
      { playerId: "p2", nickname: "Karolina" }
    );
    parties.respondToInvite(invite.inviteId, "p2", true);

    parties.leave("p1");

    expect(parties.getSnapshot("p1")).toBeNull();
    expect(parties.getSnapshot("p2")).toMatchObject({
      leaderPlayerId: "p2",
      members: [{ playerId: "p2", nickname: "Karolina", leader: true }]
    });
  });

  it("rejects an expired invitation", () => {
    const parties = new PartyService(5, 1000);
    const invite = parties.createInvite(
      { playerId: "p1", nickname: "Owczy" },
      { playerId: "p2", nickname: "Karolina" },
      1000
    );

    expect(() =>
      parties.respondToInvite(invite.inviteId, "p2", true, 2001)
    ).toThrowError("PARTY_INVITE_EXPIRED");
  });
});
