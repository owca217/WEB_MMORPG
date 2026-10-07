import { createServer } from "node:http";
import { DEFAULT_APPEARANCE, type EquipmentSnapshot, type InventorySnapshot, type PlayerStateSnapshot } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { createGameServer } from "../src/server/createGameServer";
import type { PersistentGameServerDeps } from "../src/server/createGameServer";

type EventHandler = (...args: any[]) => unknown;

class SyntheticSocket {
  readonly id = "synthetic-socket";
  readonly data = { accountId: "account-1" };
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

  disconnect(): void {
    this.connected = false;
  }

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function cloneState(state: PlayerStateSnapshot): PlayerStateSnapshot {
  return structuredClone(state);
}

async function makePersistentGame(
  initialState: PlayerStateSnapshot,
  persistenceOverrides: (store: {
    getDurable: () => PlayerStateSnapshot;
    setDurable: (state: PlayerStateSnapshot) => void;
    setRewardClaimed: (claimed: boolean) => void;
  }) => Record<string, unknown> = () => ({})
) {
  let durable = cloneState(initialState);
  let rewardClaimed = false;
  const store = {
    getDurable: () => cloneState(durable),
    setDurable: (state: PlayerStateSnapshot) => { durable = cloneState(state); },
    setRewardClaimed: (claimed: boolean) => { rewardClaimed = claimed; }
  };
  const playerPersistence = {
    loadPlayer: async () => cloneState(durable),
    hasNpcRewardClaim: async () => rewardClaimed,
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
    saveBattleOutcome: async (character: PlayerStateSnapshot["character"], inventory: InventorySnapshot) => {
      durable = { ...durable, character: structuredClone(character), inventory: structuredClone(inventory) };
    },
    claimNpcRewardOnce: async (
      _playerId: string,
      _rewardKey: string,
      inventory: InventorySnapshot,
      equipment: EquipmentSnapshot
    ) => {
      durable = { ...durable, inventory: structuredClone(inventory), equipment: structuredClone(equipment) };
      rewardClaimed = true;
      return true;
    },
    ...persistenceOverrides(store)
  };

  const httpServer = createServer();
  const deps = {
    authService: {},
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
    get durable() { return cloneState(durable); },
    get rewardClaimed() { return rewardClaimed; },
    setDurable: store.setDurable,
    async close() { await game.services.positions?.stop(); }
  };
}

function initialState(inventory: InventorySnapshot = { items: [] }, equipment: EquipmentSnapshot = { items: [] }): PlayerStateSnapshot {
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
    inventory,
    equipment
  };
}

describe("serialized inventory mutations", () => {
  it("keeps battle loot when a bag transfer is saving at the same time", async () => {
    const bag = {
      instanceId: "bag-1",
      itemId: "simple-bag",
      name: "Zwykły worek",
      quantity: 1,
      category: "bag" as const,
      description: "Worek.",
      containerCapacity: 8
    };
    const material = {
      instanceId: "herb-1",
      itemId: "herb",
      name: "Ziele",
      quantity: 1,
      category: "material" as const,
      description: "Ziele lecznicze."
    };
    const saveStarted = deferred();
    const releaseTransferSave = deferred();
    let transferSavePending = true;
    let battleSaveCalls = 0;

    const app = await makePersistentGame(initialState({ items: [bag, material] }, {
      items: [{ slot: "bag-1", itemInstanceId: bag.instanceId }]
    }), (store) => ({
      saveInventoryAndEquipment: async (
        _playerId: string,
        inventory: InventorySnapshot,
        equipment: EquipmentSnapshot
      ) => {
        if (transferSavePending) {
          transferSavePending = false;
          saveStarted.resolve();
          await releaseTransferSave.promise;
        }
        // The real transfer write completes before the battle settlement can enter the shared queue.
        const current = store.getDurable();
        store.setDurable({ ...current, inventory, equipment });
      },
      saveBattleOutcome: async (character: PlayerStateSnapshot["character"], inventory: InventorySnapshot) => {
        battleSaveCalls += 1;
        const current = store.getDurable();
        store.setDurable({ ...current, character, inventory });
      }
    }));

    try {
      app.game.services.battles.applyCommand = (() => ({
        result: { ok: true },
        snapshot: {} as any,
        finished: true,
        victory: true,
        encounterId: "wolf-pack-01",
        seed: 123,
        playerIds: ["player-1"],
        playerOutcomes: [{ playerId: "player-1", hp: 80, severelyInjured: false, injuries: [] }]
      })) as unknown as typeof app.game.services.battles.applyCommand;

      const transfer = app.socket.dispatch("moveInventoryItem", {
        itemInstanceId: material.instanceId,
        containerInstanceId: bag.instanceId
      });
      await saveStarted.promise;
      const battle = app.socket.dispatch("battleCommand", { type: "synthetic" });
      await Promise.resolve();
      await Promise.resolve();

      expect(battleSaveCalls).toBe(0);
      releaseTransferSave.resolve();
      await Promise.all([transfer, battle]);

      expect(app.game.services.inventory.getSnapshot("player-1").items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ instanceId: "herb-1", containerInstanceId: "bag-1" }),
          expect.objectContaining({ itemId: "wolf-pelt" })
        ])
      );
    } finally {
      releaseTransferSave.resolve();
      await app.close();
    }
  });

  it("reloads durable reward state when the claim commits but reports an error", async () => {
    const app = await makePersistentGame(initialState(), (store) => ({
      claimNpcRewardOnce: async (
        _playerId: string,
        _rewardKey: string,
        inventory: InventorySnapshot,
        equipment: EquipmentSnapshot
      ) => {
        // Simulate a committed transaction whose acknowledgement was lost.
        store.setDurable({
          ...store.getDurable(),
          inventory: structuredClone(inventory),
          equipment: structuredClone(equipment)
        });
        store.setRewardClaimed(true);
        throw new Error("acknowledgement lost after commit");
      }
    }));

    try {
      await app.socket.dispatch("claimSimpleBag", { npcId: "quartermaster-runa" });
      await app.socket.dispatch("requestPlayerState");

      const latestState = app.socket.emitted.filter((item) => item.event === "playerState").at(-1)?.payload;
      expect(latestState.inventory.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ itemId: "simple-bag", category: "bag" })])
      );
      expect(latestState.equipment.items).toContainEqual(
        expect.objectContaining({ slot: "bag-1" })
      );
      expect(app.socket.emitted.some((item) => item.event === "npcInteraction" && item.payload.simpleBagRewardClaimed)).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("serializes failed healing recovery with a quartermaster reward", async () => {
    const startingState = initialState();
    startingState.character.hp = 40;
    const healingRecoveryStarted = deferred();
    const releaseHealingRecovery = deferred();
    let pauseHealingRecovery = false;
    let rewardSaveStarted = false;

    const app = await makePersistentGame(startingState, (store) => ({
      loadPlayer: async () => {
        const staleState = store.getDurable();
        if (pauseHealingRecovery) {
          pauseHealingRecovery = false;
          healingRecoveryStarted.resolve();
          await releaseHealingRecovery.promise;
        }
        return staleState;
      },
      saveCharacterState: async () => {
        throw new Error("healing write failed");
      },
      claimNpcRewardOnce: async (
        _playerId: string,
        _rewardKey: string,
        inventory: InventorySnapshot,
        equipment: EquipmentSnapshot
      ) => {
        rewardSaveStarted = true;
        store.setDurable({
          ...store.getDurable(),
          inventory: structuredClone(inventory),
          equipment: structuredClone(equipment)
        });
        store.setRewardClaimed(true);
        return true;
      }
    }));

    let healing: Promise<void> | undefined;
    let reward: Promise<void> | undefined;
    try {
      app.game.services.world.addPlayer({
        id: "player-1",
        nickname: "Hero",
        locationId: "forest-settlement-01",
        x: 720,
        y: 535
      });
      pauseHealingRecovery = true;
      healing = app.socket.dispatch("healAtNpc", { npcId: "healer-ada" });
      await healingRecoveryStarted.promise;

      app.game.services.world.addPlayer({
        id: "player-1",
        nickname: "Hero",
        locationId: "forest-settlement-01",
        x: 420,
        y: 470
      });
      reward = app.socket.dispatch("claimSimpleBag", { npcId: "quartermaster-runa" });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(rewardSaveStarted).toBe(false);
      releaseHealingRecovery.resolve();
      await Promise.all([healing, reward]);

      expect(rewardSaveStarted).toBe(true);
      expect(app.game.services.inventory.getSnapshot("player-1").items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ itemId: "simple-bag", category: "bag" })
        ])
      );
      expect(app.durable.inventory.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ itemId: "simple-bag", category: "bag" })
        ])
      );
      expect(app.durable.equipment.items).toContainEqual(
        expect.objectContaining({ slot: "bag-1" })
      );
      expect(app.rewardClaimed).toBe(true);
    } finally {
      releaseHealingRecovery.resolve();
      await Promise.allSettled([healing, reward].filter((task): task is Promise<void> => Boolean(task)));
      await app.close();
    }
  });

  it("orders transfer, unequip, and reward commands against one inventory snapshot", async () => {
    const bag = {
      instanceId: "bag-main",
      itemId: "simple-bag",
      name: "Zwykły worek",
      quantity: 1,
      category: "bag" as const,
      description: "Worek.",
      containerCapacity: 1
    };
    const firstItem = {
      instanceId: "herb-first",
      itemId: "herb",
      name: "Pierwsze ziele",
      quantity: 1,
      category: "material" as const,
      description: "Ziele."
    };
    const secondItem = {
      instanceId: "herb-second",
      itemId: "herb",
      name: "Drugie ziele",
      quantity: 1,
      category: "material" as const,
      description: "Ziele."
    };
    const saveStarted = deferred();
    const releaseFirstSave = deferred();
    let holdFirstSave = true;

    const app = await makePersistentGame(
      initialState(
        { items: [bag, firstItem, secondItem] },
        { items: [{ slot: "bag-1", itemInstanceId: bag.instanceId }] }
      ),
      (store) => ({
        saveInventoryAndEquipment: async (
          _playerId: string,
          inventory: InventorySnapshot,
          equipment: EquipmentSnapshot
        ) => {
          if (holdFirstSave) {
            holdFirstSave = false;
            saveStarted.resolve();
            await releaseFirstSave.promise;
          }
          const durable = store.getDurable();
          store.setDurable({ ...durable, inventory: structuredClone(inventory), equipment: structuredClone(equipment) });
        }
      })
    );

    let transfer: Promise<void> | undefined;
    let unequip: Promise<void> | undefined;
    let reward: Promise<void> | undefined;
    try {
      transfer = app.socket.dispatch("moveInventoryItem", {
        itemInstanceId: firstItem.instanceId,
        containerInstanceId: bag.instanceId
      });
      await saveStarted.promise;
      unequip = app.socket.dispatch("setContainerSlot", {
        slot: "bag-1",
        itemInstanceId: null
      });
      reward = app.socket.dispatch("claimSimpleBag", { npcId: "quartermaster-runa" });

      releaseFirstSave.resolve();
      await Promise.all([transfer, unequip, reward]);

      const finalInventory = app.game.services.inventory.getSnapshot("player-1");
      const storedItem = finalInventory.items.find((item) => item.instanceId === firstItem.instanceId);
      expect(storedItem?.containerInstanceId).toBe(bag.instanceId);
      expect(finalInventory.items.filter((item) => item.itemId === "simple-bag")).toHaveLength(2);
      const secondStoredItem = finalInventory.items.find((item) => item.instanceId === secondItem.instanceId);
      expect(secondStoredItem?.containerInstanceId).toBeUndefined();
      expect(finalInventory.items).toHaveLength(4);
      const equippedBagId = app.durable.equipment.items.find((item) => item.slot === "bag-1")?.itemInstanceId;
      expect(finalInventory.items.find((item) => item.instanceId === equippedBagId)?.itemId).toBe("simple-bag");
      expect(app.rewardClaimed).toBe(true);
    } finally {
      releaseFirstSave.resolve();
      await Promise.allSettled([transfer, unequip, reward].filter((task): task is Promise<void> => Boolean(task)));
      await app.close();
    }
  });

  it("restores the original inventory when a transfer write fails", async () => {
    const bag = {
      instanceId: "bag-main",
      itemId: "simple-bag",
      name: "Zwykły worek",
      quantity: 1,
      category: "bag" as const,
      description: "Worek.",
      containerCapacity: 8
    };
    const herb = {
      instanceId: "herb-1",
      itemId: "herb",
      name: "Ziele",
      quantity: 1,
      category: "material" as const,
      description: "Ziele."
    };
    const startingState = initialState(
      { items: [bag, herb] },
      { items: [{ slot: "bag-1", itemInstanceId: bag.instanceId }] }
    );
    const app = await makePersistentGame(startingState, () => ({
      saveInventoryAndEquipment: async () => {
        throw new Error("transfer write failed before commit");
      }
    }));

    try {
      await app.socket.dispatch("moveInventoryItem", {
        itemInstanceId: herb.instanceId,
        containerInstanceId: bag.instanceId
      });

      const restoredInventory = app.game.services.inventory.getSnapshot("player-1");
      expect(restoredInventory.items.find((item) => item.instanceId === herb.instanceId)?.containerInstanceId).toBeUndefined();
      expect(app.durable.inventory).toEqual(startingState.inventory);
      expect(app.socket.emitted).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "commandRejected",
            payload: expect.objectContaining({ code: "PERSISTENCE_FAILED" })
          })
        ])
      );
    } finally {
      await app.close();
    }
  });

  it("blocks further inventory changes when transfer recovery cannot reload durable state", async () => {
    const bag = {
      instanceId: "bag-main",
      itemId: "simple-bag",
      name: "Zwykły worek",
      quantity: 1,
      category: "bag" as const,
      description: "Worek.",
      containerCapacity: 8
    };
    const herb = {
      instanceId: "herb-1",
      itemId: "herb",
      name: "Ziele",
      quantity: 1,
      category: "material" as const,
      description: "Ziele."
    };
    let failReload = false;
    const app = await makePersistentGame(
      initialState(
        { items: [bag, herb] },
        { items: [{ slot: "bag-1", itemInstanceId: bag.instanceId }] }
      ),
      (store) => ({
        loadPlayer: async () => {
          if (failReload) throw new Error("durable reload failed");
          return store.getDurable();
        },
        saveInventoryAndEquipment: async () => {
          throw new Error("transfer write failed");
        }
      })
    );

    try {
      failReload = true;
      await app.socket.dispatch("moveInventoryItem", {
        itemInstanceId: herb.instanceId,
        containerInstanceId: bag.instanceId
      });
      await app.socket.dispatch("claimSimpleBag", { npcId: "quartermaster-runa" });

      expect(app.game.services.inventory.getSnapshot("player-1").items.find((item) => item.instanceId === herb.instanceId)?.containerInstanceId).toBeUndefined();
      expect(app.rewardClaimed).toBe(false);
      expect(app.socket.emitted).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "commandRejected",
            payload: expect.objectContaining({ code: "PERSISTENCE_RECOVERY_REQUIRED" })
          })
        ])
      );
    } finally {
      await app.close();
    }
  });

  it("keeps simultaneous transfers from exceeding the last bag slot", async () => {
    const bag = {
      instanceId: "bag-one-slot",
      itemId: "simple-bag",
      name: "Zwykły worek",
      quantity: 1,
      category: "bag" as const,
      description: "Worek.",
      containerCapacity: 1
    };
    const firstItem = {
      instanceId: "herb-first",
      itemId: "herb",
      name: "Pierwsze ziele",
      quantity: 1,
      category: "material" as const,
      description: "Ziele."
    };
    const secondItem = {
      instanceId: "herb-second",
      itemId: "herb",
      name: "Drugie ziele",
      quantity: 1,
      category: "material" as const,
      description: "Ziele."
    };
    const saveStarted = deferred();
    const releaseSave = deferred();
    let holdNextSave = true;
    const app = await makePersistentGame(
      initialState({ items: [bag, firstItem, secondItem] }),
      (store) => ({
        saveInventoryAndEquipment: async (
          _playerId: string,
          inventory: InventorySnapshot,
          equipment: EquipmentSnapshot
        ) => {
          if (holdNextSave) {
            holdNextSave = false;
            saveStarted.resolve();
            await releaseSave.promise;
          }
          const durable = store.getDurable();
          store.setDurable({ ...durable, inventory: structuredClone(inventory), equipment: structuredClone(equipment) });
        }
      })
    );

    let firstTransfer: Promise<void> | undefined;
    let secondTransfer: Promise<void> | undefined;
    try {
      firstTransfer = app.socket.dispatch("moveInventoryItem", {
        itemInstanceId: firstItem.instanceId,
        containerInstanceId: bag.instanceId
      });
      await saveStarted.promise;
      secondTransfer = app.socket.dispatch("moveInventoryItem", {
        itemInstanceId: secondItem.instanceId,
        containerInstanceId: bag.instanceId
      });

      releaseSave.resolve();
      await Promise.all([firstTransfer, secondTransfer]);

      const finalItems = app.game.services.inventory.getSnapshot("player-1").items;
      expect(finalItems.find((item) => item.instanceId === firstItem.instanceId)?.containerInstanceId).toBe(bag.instanceId);
      expect(finalItems.find((item) => item.instanceId === secondItem.instanceId)?.containerInstanceId).toBeUndefined();
      expect(finalItems.filter((item) => item.containerInstanceId === bag.instanceId)).toHaveLength(1);
      expect(app.durable.inventory.items).toEqual(finalItems);
      expect(app.socket.emitted).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: "commandRejected",
            payload: expect.objectContaining({ code: "BAG_IS_FULL" })
          })
        ])
      );
    } finally {
      releaseSave.resolve();
      await Promise.allSettled([firstTransfer, secondTransfer].filter((task): task is Promise<void> => Boolean(task)));
      await app.close();
    }
  });
});
