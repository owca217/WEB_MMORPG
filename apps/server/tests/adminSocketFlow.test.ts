import { createServer } from "node:http";
import {
  DEFAULT_APPEARANCE,
  ITEM_DEFINITIONS,
  type EquipmentSnapshot,
  type InventorySnapshot,
  type PlayerStateSnapshot
} from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { createGameServer } from "../src/server/createGameServer";
import type { PersistentGameServerDeps } from "../src/server/createGameServer";

type EventHandler = (...args: any[]) => unknown;

class SyntheticSocket {
  readonly id = "admin-synthetic-socket";
  readonly data = { accountId: "account-1", authToken: "admin-token" };
  readonly handshake = { auth: {} };
  connected = true;
  readonly handlers = new Map<string, EventHandler>();
  readonly emitted: Array<{ event: string; payload: any }> = [];
  private readonly waiters: Array<{
    event: string;
    predicate: (payload: any) => boolean;
    resolve: (payload: any) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  on(event: string, handler: EventHandler): this {
    this.handlers.set(event, handler);
    return this;
  }

  emit(event: string, payload?: any): boolean {
    this.emitted.push({ event, payload });
    for (const waiter of [...this.waiters]) {
      if (waiter.event === event && waiter.predicate(payload)) {
        clearTimeout(waiter.timer);
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(payload);
      }
    }
    return true;
  }

  join(): void {}
  disconnect(): void { this.connected = false; }

  async dispatch(event: string, payload?: any): Promise<void> {
    await this.handlers.get(event)?.(payload);
  }

  async waitFor(event: string, predicate: (payload: any) => boolean = () => true): Promise<any> {
    const existing = this.emitted.find((item) => item.event === event && predicate(item.payload));
    if (existing) return existing.payload;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 1000);
      this.waiters.push({ event, predicate, resolve, timer });
    });
  }
}

function initialState(): PlayerStateSnapshot {
  return {
    character: {
      playerId: "player-1",
      nickname: "Hero",
      appearance: DEFAULT_APPEARANCE,
      level: 1,
      experience: 0,
      hp: 100,
      maxHp: 100,
      maxAp: 5,
      initiative: 10,
      severelyInjured: false,
      injuries: []
    },
    inventory: { items: [] },
    equipment: { items: [] }
  };
}

async function makeAdminGame() {
  let role: "PLAYER" | "ADMIN" = "PLAYER";
  let durable = initialState();
  const operations = new Map<string, {
    accountId: string;
    characterId: string;
    itemId: string;
    quantity: number;
  }>();
  const authService = {
    validateToken: async (token: string) => token === "admin-token"
      ? { account: { id: "account-1", role } }
      : null
  };
  const playerPersistence = {
    loadPlayer: async () => structuredClone(durable),
    applyAdminGrant: async (input: {
      operationId: string;
      accountId: string;
      characterId: string;
      itemId: string;
      quantity: number;
      inventory: InventorySnapshot;
      equipment: EquipmentSnapshot;
    }) => {
      const previous = operations.get(input.operationId);
      if (previous) {
        if (
          previous.accountId !== input.accountId ||
          previous.characterId !== input.characterId ||
          previous.itemId !== input.itemId ||
          previous.quantity !== input.quantity
        ) throw Object.assign(new Error("operation conflict"), {
          code: "ADMIN_OPERATION_CONFLICT"
        });
        return {
          status: "alreadyApplied" as const,
          inventory: structuredClone(durable.inventory),
          equipment: structuredClone(durable.equipment)
        };
      }
      operations.set(input.operationId, {
        accountId: input.accountId,
        characterId: input.characterId,
        itemId: input.itemId,
        quantity: input.quantity
      });
      durable = {
        ...durable,
        inventory: structuredClone(input.inventory),
        equipment: structuredClone(input.equipment)
      };
      return {
        status: "applied" as const,
        inventory: structuredClone(input.inventory),
        equipment: structuredClone(input.equipment)
      };
    },
    saveInventoryAndEquipment: async (
      _playerId: string,
      inventory: InventorySnapshot,
      equipment: EquipmentSnapshot
    ) => {
      durable = { ...durable, inventory: structuredClone(inventory), equipment: structuredClone(equipment) };
    },
    saveEquipment: async (_playerId: string, equipment: EquipmentSnapshot) => {
      durable = { ...durable, equipment: structuredClone(equipment) };
    },
    saveBattleOutcome: async () => {},
    hasNpcRewardClaim: async () => false,
    claimNpcRewardOnce: async () => true
  };
  const httpServer = createServer();
  const deps = {
    authService,
    characters: { getLifecycle: async () => ({ state: "active", characterId: "player-1" }) },
    activeConnections: { closeAccount: async () => {}, attach: () => {}, detach: () => {} },
    characterRepository: {
      findByAccountId: async () => ({
        id: "player-1",
        accountId: "account-1",
        nickname: "Hero",
        appearance: DEFAULT_APPEARANCE,
        locationId: "forest-settlement-01",
        x: 360,
        y: 470
      })
    },
    playerPersistence,
    clientOrigin: "http://localhost"
  } as unknown as PersistentGameServerDeps;
  const game = createGameServer(httpServer, deps);
  const socket = new SyntheticSocket();
  const emitReserved = (game.io.sockets as unknown as { emitReserved: (event: string, ...args: unknown[]) => void }).emitReserved;
  emitReserved.call(game.io.sockets, "connection", socket);
  await socket.waitFor("playerState");

  return {
    game,
    socket,
    setRole(nextRole: "PLAYER" | "ADMIN") { role = nextRole; },
    durable: () => structuredClone(durable),
    async close() { await game.services.positions?.stop(); }
  };
}

describe("admin socket flow", () => {
  it("rejects player catalog and grants, then serves the catalog to an admin", async () => {
    const app = await makeAdminGame();
    try {
      await app.socket.dispatch("requestAdminCatalog");
      expect(app.socket.emitted.at(-1)).toMatchObject({
        event: "commandRejected",
        payload: { code: "ADMIN_REQUIRED" }
      });

      await app.socket.dispatch("grantAdminItem", {
        operationId: "player-grant",
        itemId: "wolf-pelt",
        quantity: 1
      });
      expect(app.socket.emitted.at(-1)).toMatchObject({
        event: "adminGrantResult",
        payload: { ok: false, code: "ADMIN_REQUIRED" }
      });

      app.setRole("ADMIN");
      await app.socket.dispatch("requestAdminCatalog");
      expect(app.socket.emitted.at(-1)).toMatchObject({
        event: "adminCatalog",
        payload: { items: ITEM_DEFINITIONS }
      });
    } finally {
      await app.close();
    }
  });

  it("serializes a successful grant, rejects battle state and makes identical retries idempotent", async () => {
    const app = await makeAdminGame();
    app.setRole("ADMIN");
    try {
      await app.socket.dispatch("grantAdminItem", {
        operationId: "same-operation",
        itemId: "field-bandage",
        quantity: 3
      });
      expect(app.socket.emitted.at(-1)).toMatchObject({
        event: "playerState",
        payload: { inventory: { items: [expect.objectContaining({ itemId: "field-bandage", quantity: 3 })] } }
      });
      expect(app.durable().inventory.items).toHaveLength(1);

      await app.socket.dispatch("grantAdminItem", {
        operationId: "same-operation",
        itemId: "field-bandage",
        quantity: 3
      });
      expect(app.durable().inventory.items).toHaveLength(1);

      await app.socket.dispatch("grantAdminItem", {
        operationId: "same-operation",
        itemId: "field-bandage",
        quantity: 4
      });
      expect(app.socket.emitted.at(-1)).toMatchObject({
        event: "adminGrantResult",
        payload: { ok: false, code: "ADMIN_OPERATION_CONFLICT" }
      });

      app.game.services.battles.hasBattle = (() => true) as typeof app.game.services.battles.hasBattle;
      await app.socket.dispatch("grantAdminItem", {
        operationId: "battle-operation",
        itemId: "wolf-pelt",
        quantity: 1
      });
      expect(app.socket.emitted.at(-1)).toMatchObject({
        event: "adminGrantResult",
        payload: { ok: false, code: "ADMIN_IN_BATTLE" }
      });

      app.game.services.battles.hasBattle = (() => false) as typeof app.game.services.battles.hasBattle;
      app.setRole("PLAYER");
      await app.socket.dispatch("grantAdminItem", {
        operationId: "revoked-operation",
        itemId: "wolf-pelt",
        quantity: 1
      });
      expect(app.socket.emitted.at(-1)).toMatchObject({
        event: "adminGrantResult",
        payload: { ok: false, code: "ADMIN_REQUIRED" }
      });
      expect(app.durable().inventory.items).toHaveLength(1);
    } finally {
      await app.close();
    }
  });
});
