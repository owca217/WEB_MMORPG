import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type {
  BattleCommand,
  BattleSnapshot,
  NpcInteractionPayload,
  PartyInvitePayload,
  PartySnapshot,
  PlayerId,
  PlayerStateSnapshot,
  WorldStateSnapshot
} from "@web-mmorpg/shared";
import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { findPath, hexDistance, hexKey, hexNeighbors } from "../src/battle/hex";
import { hasLineOfSight } from "../src/battle/lineOfSight";
import { createGameServer } from "../src/server/createGameServer";

const clients: Socket[] = [];
let closeServer: (() => Promise<void>) | undefined;

afterEach(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  await closeServer?.();
  closeServer = undefined;
});

async function startTestServer() {
  const httpServer = createServer();
  const game = createGameServer(httpServer);

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;

  closeServer = async () => {
    await new Promise<void>((resolve) => game.io.close(() => resolve()));
    if (httpServer.listening) {
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve()))
      );
    }
  };

  const connectClient = async (): Promise<Socket> => {
    const socket = createClient(`http://127.0.0.1:${address.port}`, {
      transports: ["websocket"],
      forceNew: true
    });
    clients.push(socket);

    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });

    return socket;
  };

  return { game, connectClient };
}

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise<T>((resolve) => socket.once(event, resolve));
}

function onceWithTimeout<T>(socket: Socket, event: string, timeoutMs = 1000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function choosePlayerCommand(snapshot: BattleSnapshot, playerId: PlayerId): BattleCommand {
  const hero = snapshot.combatants.find(
    (combatant) => combatant.ownerPlayerId === playerId && combatant.hp > 0
  );
  const enemy = snapshot.combatants.find(
    (combatant) => combatant.ownerPlayerId === undefined && combatant.hp > 0
  );
  if (!hero || !enemy) throw new Error("Expected living hero and enemy.");

  const distance = hexDistance(hero.position, enemy.position);
  if (distance === 1) {
    if (hero.ap >= 2) {
      return { type: "meleeAttack", combatantId: hero.id, targetId: enemy.id };
    }
    return { type: "endTurn", combatantId: hero.id };
  }

  const rangedCost = hero.injuries.includes("brokenArm") ? 4 : 3;
  const blockers = new Set(snapshot.blockedCells.map(hexKey));
  if (
    hero.ap >= rangedCost &&
    distance <= 6 &&
    hasLineOfSight(hero.position, enemy.position, blockers)
  ) {
    return { type: "rangedAttack", combatantId: hero.id, targetId: enemy.id };
  }

  if (hero.ap > 0) {
    const allowed = new Set(snapshot.cells.map(hexKey));
    const occupied = new Set(snapshot.blockedCells.map(hexKey));
    for (const combatant of snapshot.combatants) {
      if (combatant.id !== hero.id && combatant.hp > 0) {
        occupied.add(hexKey(combatant.position));
      }
    }

    const goals = hexNeighbors(enemy.position)
      .filter((cell) => allowed.has(hexKey(cell)) && !occupied.has(hexKey(cell)))
      .sort((a, b) => hexDistance(hero.position, a) - hexDistance(hero.position, b));

    for (const goal of goals) {
      const path = findPath(hero.position, goal, occupied, allowed);
      if (path?.length) {
        return { type: "move", combatantId: hero.id, target: path[0]! };
      }
    }
  }

  return { type: "endTurn", combatantId: hero.id };
}

async function winBattle(socket: Socket, initial: BattleSnapshot, playerId: PlayerId) {
  let battle = initial;
  const endedPromise = onceWithTimeout<{
    outcome: "victory" | "defeat";
    inventory: { items: Array<{ itemId: string; quantity: number }> };
    character: { hp: number };
  }>(socket, "battleEnded", 4000);

  for (let step = 0; step < 40 && !battle.finished; step += 1) {
    const statePromise = onceWithTimeout<BattleSnapshot>(socket, "battleState");
    socket.emit("battleCommand", choosePlayerCommand(battle, playerId));
    battle = await statePromise;
  }

  expect(battle.finished).toBe(true);
  return endedPromise;
}

describe("Socket.IO game flow", () => {
  it("emits player state after login and routes NPC interaction", async () => {
    const { game, connectClient } = await startTestServer();
    const client = await connectClient();
    const playerStatePromise = onceWithTimeout<PlayerStateSnapshot>(client, "playerState");

    const loginResult = await client.emitWithAck("login", { nickname: "Owczy" });
    expect(loginResult).toMatchObject({ ok: true, locationId: "forest-settlement-01" });
    if (!loginResult.ok) throw new Error("Login unexpectedly failed");

    const playerState = await playerStatePromise;
    expect(playerState.character).toMatchObject({ nickname: "Owczy", hp: 100, maxHp: 100 });

    game.services.world.movePlayer(
      loginResult.playerId,
      { x: 610, y: 420 },
      Date.now() + 10_000
    );

    const interactionPromise = onceWithTimeout<NpcInteractionPayload>(client, "npcInteraction");
    client.emit("interactNpc", { npcId: "guide-boran" });

    const interaction = await interactionPromise;
    expect(interaction).toMatchObject({
      npcId: "guide-boran",
      kind: "guide",
      npcName: "Boran",
      canHeal: false
    });
  });

  it("rejects attempts to control the server-owned wolf", async () => {
    const { game, connectClient } = await startTestServer();
    const client = await connectClient();
    const worldPromise = once<WorldStateSnapshot>(client, "worldState");

    const loginResult = await client.emitWithAck("login", { nickname: "Owczy" });
    if (!loginResult.ok) throw new Error("Login unexpectedly failed");
    await worldPromise;

    game.services.world.movePlayer(
      loginResult.playerId,
      { x: 1320, y: 455 },
      Date.now() + 10_000
    );

    const battlePromise = once<BattleSnapshot>(client, "battleStarted");
    client.emit("startEncounter", { encounterId: "wolf-pack-01" });
    const battle = await battlePromise;
    const wolf = battle.combatants.find((combatant) => combatant.name === "Wolf")!;

    const rejectionPromise = once<{ code: string; message: string }>(client, "commandRejected");
    client.emit("battleCommand", { type: "endTurn", combatantId: wolf.id });

    expect((await rejectionPromise).code).toBe("NOT_OWNER");
  });

  it("completes forest -> battle -> loot -> shared world after victory", async () => {
    const { game, connectClient } = await startTestServer();
    const client = await connectClient();
    const loginResult = await client.emitWithAck("login", { nickname: "Owczy" });
    if (!loginResult.ok) throw new Error("Login unexpectedly failed");

    game.services.world.movePlayer(
      loginResult.playerId,
      { x: 1320, y: 455 },
      Date.now() + 10_000
    );

    const startedPromise = onceWithTimeout<BattleSnapshot>(client, "battleStarted");
    client.emit("startEncounter", { encounterId: "wolf-pack-01" });
    const started = await startedPromise;
    const worldReturnPromise = onceWithTimeout<WorldStateSnapshot>(client, "worldState", 4000);
    const ended = await winBattle(client, started, loginResult.playerId);

    expect(ended.outcome).toBe("victory");
    expect(ended.inventory.items.find((item) => item.itemId === "wolf-pelt")?.quantity).toBe(1);
    expect(ended.inventory.items.find((item) => item.itemId === "field-bandage")?.quantity).toBe(2);

    const returnedWorld = await worldReturnPromise;
    expect(returnedWorld.players.some((player) => player.id === loginResult.playerId)).toBe(true);
  });

  it("recovers from defeat while preserving severe injury state", async () => {
    const { game, connectClient } = await startTestServer();
    const client = await connectClient();
    const loginResult = await client.emitWithAck("login", { nickname: "Owczy" });
    if (!loginResult.ok) throw new Error("Login unexpectedly failed");

    game.services.characters.applyBattleResult(loginResult.playerId, {
      hp: 1,
      severelyInjured: true,
      injuries: ["legTrauma"]
    });
    game.services.world.movePlayer(
      loginResult.playerId,
      { x: 1320, y: 455 },
      Date.now() + 10_000
    );

    const startedPromise = onceWithTimeout<BattleSnapshot>(client, "battleStarted");
    client.emit("startEncounter", { encounterId: "wolf-pack-01" });
    let battle = await startedPromise;
    const endedPromise = onceWithTimeout<{
      outcome: "victory" | "defeat";
      character: { hp: number; severelyInjured: boolean; injuries: string[] };
    }>(client, "battleEnded", 4000);

    for (let turn = 0; turn < 12 && !battle.finished; turn += 1) {
      const hero = battle.combatants.find((combatant) => combatant.ownerPlayerId === loginResult.playerId);
      if (!hero) throw new Error("Expected hero.");
      const statePromise = onceWithTimeout<BattleSnapshot>(client, "battleState");
      client.emit("battleCommand", { type: "endTurn", combatantId: hero.id });
      battle = await statePromise;
    }

    const ended = await endedPromise;
    expect(ended.outcome).toBe("defeat");
    expect(ended.character.hp).toBe(25);
    expect(ended.character.severelyInjured).toBe(true);
    expect(ended.character.injuries.length).toBeGreaterThan(0);
  });

  it("creates a party after another player accepts an invite", async () => {
    const { connectClient } = await startTestServer();
    const first = await connectClient();
    const second = await connectClient();

    const firstLogin = await first.emitWithAck("login", { nickname: "Owczy" });
    if (!firstLogin.ok) throw new Error("First login failed");
    const secondLogin = await second.emitWithAck("login", { nickname: "Karolina" });
    if (!secondLogin.ok) throw new Error("Second login failed");

    const invitePromise = onceWithTimeout<PartyInvitePayload>(
      second,
      "partyInviteReceived"
    );
    first.emit("inviteToParty", { targetPlayerId: secondLogin.playerId });
    const invite = await invitePromise;
    expect(invite.inviterNickname).toBe("Owczy");

    const firstPartyPromise = onceWithTimeout<PartySnapshot>(first, "partyState");
    const secondPartyPromise = onceWithTimeout<PartySnapshot>(second, "partyState");
    second.emit("respondPartyInvite", { inviteId: invite.inviteId, accept: true });

    const [firstParty, secondParty] = await Promise.all([
      firstPartyPromise,
      secondPartyPromise
    ]);
    expect(firstParty.id).toBe(secondParty.id);
    expect(firstParty.leaderPlayerId).toBe(firstLogin.playerId);
    expect(firstParty.members.map((member) => member.nickname).sort()).toEqual([
      "Karolina",
      "Owczy"
    ]);
  });

  it("starts one synchronized battle for nearby party members", async () => {
    const { game, connectClient } = await startTestServer();
    const first = await connectClient();
    const second = await connectClient();

    const firstLogin = await first.emitWithAck("login", { nickname: "Owczy" });
    if (!firstLogin.ok) throw new Error("First login failed");
    const secondLogin = await second.emitWithAck("login", { nickname: "Karolina" });
    if (!secondLogin.ok) throw new Error("Second login failed");

    const invitePromise = onceWithTimeout<PartyInvitePayload>(
      second,
      "partyInviteReceived"
    );
    first.emit("inviteToParty", { targetPlayerId: secondLogin.playerId });
    const invite = await invitePromise;

    const firstParty = onceWithTimeout<PartySnapshot>(first, "partyState");
    const secondParty = onceWithTimeout<PartySnapshot>(second, "partyState");
    second.emit("respondPartyInvite", {
      inviteId: invite.inviteId,
      accept: true
    });
    await Promise.all([firstParty, secondParty]);

    game.services.world.movePlayer(
      firstLogin.playerId,
      { x: 1320, y: 455 },
      Date.now() + 10_000
    );
    game.services.world.movePlayer(
      secondLogin.playerId,
      { x: 800, y: 455 },
      Date.now() + 10_000
    );

    const firstStarted = onceWithTimeout<BattleSnapshot>(
      first,
      "battleStarted"
    );
    const secondStarted = onceWithTimeout<BattleSnapshot>(
      second,
      "battleStarted"
    );
    first.emit("startEncounter", { encounterId: "wolf-pack-01" });

    const [firstBattle, secondBattle] = await Promise.all([
      firstStarted,
      secondStarted
    ]);

    expect(firstBattle.id).toBe(secondBattle.id);
    expect(
      firstBattle.combatants
        .filter((combatant) => combatant.ownerPlayerId)
        .map((combatant) => combatant.ownerPlayerId)
        .sort()
    ).toEqual(
      [firstLogin.playerId, secondLogin.playerId].sort()
    );
    expect(
      firstBattle.combatants.filter(
        (combatant) => combatant.ownerPlayerId === undefined
      )
    ).toHaveLength(2);

    const active = firstBattle.combatants.find(
      (combatant) =>
        combatant.id === firstBattle.activeCombatantId
    );
    if (!active?.ownerPlayerId) {
      throw new Error("Expected a player-owned opening turn.");
    }

    const activeSocket =
      active.ownerPlayerId === firstLogin.playerId ? first : second;
    const firstState = onceWithTimeout<BattleSnapshot>(
      first,
      "battleState"
    );
    const secondState = onceWithTimeout<BattleSnapshot>(
      second,
      "battleState"
    );

    activeSocket.emit("battleCommand", {
      type: "endTurn",
      combatantId: active.id
    });

    const [firstUpdated, secondUpdated] = await Promise.all([
      firstState,
      secondState
    ]);
    expect(firstUpdated.id).toBe(firstBattle.id);
    expect(secondUpdated.id).toBe(firstBattle.id);
    expect(secondUpdated.activeCombatantId).toBe(
      firstUpdated.activeCombatantId
    );
  });

  it("lets the leader disable automatic party battle joining", async () => {
    const { game, connectClient } = await startTestServer();
    const first = await connectClient();
    const second = await connectClient();

    const firstLogin = await first.emitWithAck("login", { nickname: "Owczy" });
    if (!firstLogin.ok) throw new Error("First login failed");
    const secondLogin = await second.emitWithAck("login", { nickname: "Karolina" });
    if (!secondLogin.ok) throw new Error("Second login failed");

    const invitePromise = onceWithTimeout<PartyInvitePayload>(
      second,
      "partyInviteReceived"
    );
    first.emit("inviteToParty", { targetPlayerId: secondLogin.playerId });
    const invite = await invitePromise;

    const firstParty = onceWithTimeout<PartySnapshot>(first, "partyState");
    const secondParty = onceWithTimeout<PartySnapshot>(second, "partyState");
    second.emit("respondPartyInvite", {
      inviteId: invite.inviteId,
      accept: true
    });
    await Promise.all([firstParty, secondParty]);

    const disabledForFirst = onceWithTimeout<PartySnapshot>(
      first,
      "partyState"
    );
    const disabledForSecond = onceWithTimeout<PartySnapshot>(
      second,
      "partyState"
    );
    first.emit("setPartyBattleMode", { enabled: false });
    const [firstDisabled, secondDisabled] = await Promise.all([
      disabledForFirst,
      disabledForSecond
    ]);
    expect(firstDisabled.partyBattleEnabled).toBe(false);
    expect(secondDisabled.partyBattleEnabled).toBe(false);

    game.services.world.movePlayer(
      firstLogin.playerId,
      { x: 1320, y: 455 },
      Date.now() + 10_000
    );
    game.services.world.movePlayer(
      secondLogin.playerId,
      { x: 900, y: 455 },
      Date.now() + 10_000
    );

    let secondEnteredBattle = false;
    second.once("battleStarted", () => {
      secondEnteredBattle = true;
    });

    const firstStarted = onceWithTimeout<BattleSnapshot>(
      first,
      "battleStarted"
    );
    first.emit("startEncounter", { encounterId: "wolf-pack-01" });
    const battle = await firstStarted;

    expect(
      battle.combatants.filter((combatant) => combatant.ownerPlayerId)
    ).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(secondEnteredBattle).toBe(false);
  });

  it("keeps another player in the shared world while one player battles", async () => {
    const { game, connectClient } = await startTestServer();
    const first = await connectClient();
    const second = await connectClient();

    const firstLogin = await first.emitWithAck("login", { nickname: "Owczy" });
    if (!firstLogin.ok) throw new Error("First login failed");

    const firstWorld = onceWithTimeout<WorldStateSnapshot>(first, "worldState");
    const secondWorld = onceWithTimeout<WorldStateSnapshot>(second, "worldState");
    const secondLogin = await second.emitWithAck("login", { nickname: "Karolina" });
    if (!secondLogin.ok) throw new Error("Second login failed");

    expect((await firstWorld).players).toHaveLength(2);
    expect((await secondWorld).players).toHaveLength(2);

    let secondEnteredBattle = false;
    second.once("battleStarted", () => {
      secondEnteredBattle = true;
    });

    game.services.world.movePlayer(
      firstLogin.playerId,
      { x: 1320, y: 455 },
      Date.now() + 10_000
    );

    const startedPromise = onceWithTimeout<BattleSnapshot>(first, "battleStarted");
    first.emit("startEncounter", { encounterId: "wolf-pack-01" });
    const started = await startedPromise;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(secondEnteredBattle).toBe(false);

    const secondReturnWorld = onceWithTimeout<WorldStateSnapshot>(second, "worldState", 4000);
    const ended = await winBattle(first, started, firstLogin.playerId);
    expect(ended.outcome).toBe("victory");

    const world = await secondReturnWorld;
    expect(world.players.map((player) => player.nickname).sort()).toEqual(["Karolina", "Owczy"]);
  });
});
