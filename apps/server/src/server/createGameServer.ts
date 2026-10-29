import type { Server as HttpServer } from "node:http";
import type {
  ClientToServerEvents,
  LocationId,
  NpcInteractionPayload,
  PlayerId,
  ServerToClientEvents
} from "@web-mmorpg/shared";
import type { Pool } from "pg";
import { Server } from "socket.io";
import type { AuthService } from "../auth/AuthService";
import { BattleService } from "../battle/BattleService";
import { ChatService } from "../chat/ChatService";
import type { CharacterLifecycleService } from "../character/CharacterLifecycleService";
import { CharacterService } from "../character/CharacterService";
import { InventoryService } from "../inventory/InventoryService";
import { LootService } from "../loot/LootService";
import { WorldService } from "../world/WorldService";
import { ActiveConnectionRegistry } from "./ActiveConnectionRegistry";

export interface GameServerOptions {
  pool: Pool;
  authService: AuthService;
  characterLifecycle: CharacterLifecycleService;
  connections?: ActiveConnectionRegistry;
}

const CONTAINER_SLOT_ERRORS: Readonly<Record<string, string>> = {
  INVALID_CONTAINER_SLOT: "Wybierz jeden z czterech slotów.",
  INVALID_CONTAINER_INSTANCE_ID: "Nieprawidłowy przedmiot.",
  CONTAINER_ITEM_NOT_OWNED: "Nie posiadasz tego pojemnika.",
  ITEM_NOT_CONTAINER: "W tym slocie można umieścić wyłącznie przedmiot z kategorii Pojemniki.",
  CONTAINER_ITEM_STORED: "Ten pojemnik znajduje się już wewnątrz innego pojemnika.",
  INVALID_ITEM_INSTANCE_ID: "Nieprawidłowy przedmiot.",
  INVENTORY_ITEM_NOT_OWNED: "Nie posiadasz tego przedmiotu.",
  CONTAINER_CAPACITY_INVALID: "Ten pojemnik nie ma określonej pojemności.",
  CONTAINER_FULL: "Ten pojemnik jest pełny.",
  CONTAINER_CANNOT_STORE_SELF: "Nie można schować pojemnika w nim samym.",
  CONTAINER_ITEM_EQUIPPED: "Najpierw zdejmij ten pojemnik ze slotu.",
  CONTAINER_NOT_EMPTY: "Najpierw opróżnij ten pojemnik.",
  CHARACTER_NOT_FOUND: "Nie znaleziono postaci."
};

const BATTLE_ITEM_ERRORS: Readonly<Record<string, string>> = {
  BATTLE_NOT_FOUND: "Nie trwa teraz żadna walka.",
  BATTLE_FINISHED: "Walka już się zakończyła.",
  BATTLE_ACTION_PENDING: "Poczekaj na zakończenie używania przedmiotu.",
  COMBATANT_NOT_FOUND: "Nie znaleziono postaci w walce.",
  NOT_OWNER: "Możesz używać przedmiotów wyłącznie na swojej postaci.",
  NOT_ACTIVE_TURN: "Poczekaj na swoją turę.",
  COMBATANT_DOWN: "Postać jest nieprzytomna.",
  INSUFFICIENT_AP: "Użycie przedmiotu wymaga 2 PA.",
  INVALID_ITEM_INSTANCE_ID: "Nieprawidłowy przedmiot.",
  INVENTORY_ITEM_NOT_OWNED: "Nie posiadasz tego przedmiotu.",
  ITEM_NOT_CONSUMABLE: "Tego przedmiotu nie można użyć w walce.",
  ITEM_NO_EFFECT: "Ten przedmiot nie poprawi teraz stanu postaci.",
  SESSION_REPLACED: "Połączenie zostało zastąpione. Połącz się ponownie."
};

const AUTHENTICATED_CHAT_ROOM = "chat:authenticated";

export function createGameServer(
  httpServer: HttpServer,
  options: GameServerOptions
) {
  const world = new WorldService();
  const inventory = new InventoryService(options.pool);
  const loot = new LootService();
  const battles = new BattleService();
  const chat = new ChatService(world, (playerId) => battles.hasBattle(playerId));
  const characters = new CharacterService();
  const connections = options.connections ?? new ActiveConnectionRegistry();
  const characterOwners = new Map<PlayerId, string>();
  const pendingCharacterSaves = new Map<PlayerId, Promise<void>>();
  const pendingBattleItemUses = new Map<PlayerId, Promise<void>>();
  const pendingAccountCleanup = new Map<string, Promise<void>>();
  const pendingAccountAuthentication = new Map<string, Promise<void>>();

  const serializeAuthentication = <T>(account: string, authenticate: () => Promise<T>): Promise<T> => {
    const previous = pendingAccountAuthentication.get(account) ?? Promise.resolve();
    const result = previous.then(authenticate);
    const settled = result.then(() => undefined, () => undefined);
    pendingAccountAuthentication.set(account, settled);
    void settled.then(() => {
      if (pendingAccountAuthentication.get(account) === settled) {
        pendingAccountAuthentication.delete(account);
      }
    });
    return result;
  };

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: true, credentials: false }
  });

  io.on("connection", (socket) => {
    let characterId: PlayerId | null = null;
    let accountId: string | null = null;
    let locationId: LocationId | null = null;
    let unregisterConnection: (() => void) | null = null;
    let socketAuthentication = Promise.resolve();
    let characterVersion = 0;

    const ownsCharacter = (target: PlayerId, version: number): boolean =>
      socket.connected && characterId === target && characterVersion === version &&
      characterOwners.get(target) === socket.id;

    const emitPlayerState = async (targetCharacterId: PlayerId): Promise<void> => {
      const character = characters.getSnapshot(targetCharacterId);
      if (!character) return;
      socket.emit("playerState", {
        character,
        inventory: await inventory.getSnapshot(targetCharacterId)
      });
    };

    const reject = (error: unknown, fallbackCode: string, message: string): void => {
      socket.emit("commandRejected", {
        code: error instanceof Error ? error.message : fallbackCode,
        message
      });
    };

    const persistGameplayState = async (targetCharacterId: PlayerId): Promise<void> => {
      if (characterOwners.get(targetCharacterId) !== socket.id) return;
      const character = characters.getSnapshot(targetCharacterId);
      const player = world.getPlayer(targetCharacterId);
      const currentLocationId = world.getPlayerLocationId(targetCharacterId) ?? locationId;
      if (!character || !player || !currentLocationId) return;

      const state = {
        locationId: currentLocationId,
        x: player.x,
        y: player.y,
        level: character.level,
        ...(character.experience !== undefined ? { experience: character.experience } : {}),
        hp: character.hp,
        maxHp: character.maxHp,
        maxAp: character.maxAp,
        initiative: character.initiative,
        severelyInjured: character.severelyInjured,
        injuries: character.injuries
      };
      // Save snapshots in command order, including the final disconnect snapshot.
      const previous = pendingCharacterSaves.get(targetCharacterId) ?? Promise.resolve();
      const save = previous.catch(() => undefined).then(() =>
        options.characterLifecycle.saveGameplayState(targetCharacterId, state)
      );
      pendingCharacterSaves.set(targetCharacterId, save);
      const forgetSave = (): void => {
        if (pendingCharacterSaves.get(targetCharacterId) === save) {
          pendingCharacterSaves.delete(targetCharacterId);
        }
      };
      void save.then(forgetSave, forgetSave);
      await save;
    };

    const releaseCharacter = (): Promise<void> => {
      const releasedCharacterId = characterId;
      const releasedAccountId = accountId;
      const releasedLocationId = locationId;
      const pendingItemUse = releasedCharacterId ? pendingBattleItemUses.get(releasedCharacterId) : undefined;
      const save = releasedCharacterId
        ? pendingItemUse
          ? pendingItemUse.catch(() => undefined).then(() => persistGameplayState(releasedCharacterId))
          : persistGameplayState(releasedCharacterId)
        : Promise.resolve();
      unregisterConnection?.();
      unregisterConnection = null;
      accountId = null;
      characterId = null;
      locationId = null;
      socket.leave(AUTHENTICATED_CHAT_ROOM);
      if (releasedCharacterId && characterOwners.get(releasedCharacterId) === socket.id) {
        chat.removePlayer(releasedCharacterId);
      }
      if (releasedLocationId) socket.leave(`location:${releasedLocationId}`);
      if (!releasedCharacterId || !releasedAccountId) return save;

      const cleanup = save.finally(() => {
        // A delayed old socket must never remove a newly hydrated projection.
        if (characterOwners.get(releasedCharacterId) !== socket.id) return;
        characterOwners.delete(releasedCharacterId);
        battles.removeBattleForPlayer(releasedCharacterId);
        world.removePlayer(releasedCharacterId);
        characters.removePlayer(releasedCharacterId);
        if (releasedLocationId) {
          io.to(`location:${releasedLocationId}`).emit("worldState", world.snapshot(releasedLocationId));
        }
      });
      pendingAccountCleanup.set(releasedAccountId, cleanup);
      const forgetCleanup = (): void => {
        if (pendingAccountCleanup.get(releasedAccountId) === cleanup) {
          pendingAccountCleanup.delete(releasedAccountId);
        }
      };
      void cleanup.then(forgetCleanup, forgetCleanup);
      return cleanup;
    };

    const npcPayload = (npcId: string): NpcInteractionPayload => {
      if (npcId === "guide-boran") {
        return {
          npcId: "guide-boran",
          npcName: "Boran",
          kind: "guide",
          title: "Droga przez las",
          lines: [
            "Wilki kręcą się przy wschodniej ścieżce.",
            "Trzymaj się drogi i nie lekceważ ran."
          ],
          canHeal: false
        };
      }

      return {
        npcId: "healer-ada",
        npcName: "Ada",
        kind: "healer",
        title: "Lecznica Ady",
        lines: [
          "Mogę opatrzyć cię i przywrócić siły.",
          "Ciężkie urazy pozostaną do czasu pełnego systemu leczenia."
        ],
        canHeal: true
      };
    };

    socket.on("authenticate", async ({ sessionToken }, ack) => {
      try {
        const validated = await options.authService.validateToken(sessionToken);
        if (!validated) {
          ack({
            ok: false,
            code: "INVALID_SESSION",
            message: "The gameplay session is invalid or expired."
          });
          return;
        }

        const authentication = socketAuthentication.then(() => serializeAuthentication(validated.account.id, async () => {
          if (!socket.connected) return;
          if (characterId) await releaseCharacter();
          connections.closeAccount(validated.account.id, "SESSION_REPLACED", socket.id);
          await pendingAccountCleanup.get(validated.account.id);
          if (!socket.connected) return;

          // Revocation may occur while a previous connection's save is pending.
          const currentSession = await options.authService.validateToken(sessionToken);
          if (!currentSession || currentSession.account.id !== validated.account.id) {
            ack({ ok: false, code: "INVALID_SESSION", message: "The gameplay session is invalid or expired." });
            return;
          }
          const persisted = await options.characterLifecycle.getCharacter(validated.account.id);
          if (!persisted || persisted.deletionEffectiveAt) {
            ack({
              ok: false,
              code: "CHARACTER_REQUIRED",
              message: "An active character is required before entering the world."
            });
            return;
          }

          if (!socket.connected) return;

          accountId = validated.account.id;
          characterId = persisted.id;
          locationId = persisted.locationId;
          characterVersion += 1;

          characterOwners.set(persisted.id, socket.id);
          unregisterConnection = connections.register(accountId, socket.id, (reason) => {
            socket.emit("commandRejected", {
              code: reason,
              message: "This gameplay connection is no longer active."
            });
            socket.disconnect(true);
          });

          characters.hydrate({
            playerId: persisted.id,
            nickname: persisted.nickname,
            appearance: persisted.appearance,
            level: persisted.level,
            experience: persisted.experience,
            hp: persisted.hp,
            maxHp: persisted.maxHp,
            maxAp: persisted.maxAp,
            initiative: persisted.initiative,
            severelyInjured: persisted.severelyInjured,
            injuries: persisted.injuries
          });
          world.addPlayer({
            id: persisted.id,
            nickname: persisted.nickname,
            appearance: persisted.appearance,
            locationId: persisted.locationId,
            x: persisted.x,
            y: persisted.y
          });

          socket.join(`location:${persisted.locationId}`);
          socket.join(AUTHENTICATED_CHAT_ROOM);
          ack({
            ok: true,
            characterId: persisted.id,
            locationId: persisted.locationId
          });
          await emitPlayerState(persisted.id);
          io.to(`location:${persisted.locationId}`).emit(
            "worldState",
            world.snapshot(persisted.locationId)
          );
        }));
        socketAuthentication = authentication.then(() => undefined, () => undefined);
        await authentication;
      } catch (error) {
        ack({
          ok: false,
          code: "AUTHENTICATION_FAILED",
          message: "The gameplay session could not be authenticated."
        });
      }
    });

    socket.on("requestPlayerState", () => {
      if (!characterId) return;
      void emitPlayerState(characterId).catch((error) =>
        reject(error, "PLAYER_STATE_FAILED", "Player state could not be loaded.")
      );
    });

    socket.on("requestWorldState", () => {
      if (!characterId || !locationId) return;
      socket.emit("worldState", world.snapshot(locationId));
    });

    socket.on("updateChatViewport", (viewport) => {
      if (!characterId || !ownsCharacter(characterId, characterVersion)) return;
      chat.setViewport(characterId, viewport);
    });

    socket.on("requestChatHistory", (ack) => {
      if (typeof ack !== "function") return;
      if (!characterId || !ownsCharacter(characterId, characterVersion)) {
        ack({ ok: false, code: "AUTHENTICATION_REQUIRED", message: "Zaloguj się, aby korzystać z czatu." });
        return;
      }
      ack({ ok: true, messages: chat.getHistory() });
    });

    socket.on("sendChatMessage", (payload, ack) => {
      if (typeof ack !== "function") return;
      if (!characterId || !ownsCharacter(characterId, characterVersion)) {
        ack({ ok: false, code: "AUTHENTICATION_REQUIRED", message: "Zaloguj się, aby korzystać z czatu." });
        return;
      }
      const result = chat.sendMessage(characterId, payload);
      if (result.ok) {
        if (result.message.channel === "global") {
          io.to(AUTHENTICATED_CHAT_ROOM).emit("chatMessage", result.message);
        } else {
          for (const recipientId of chat.nearbyRecipients(result.message)) {
            const recipientSocketId = characterOwners.get(recipientId);
            if (recipientSocketId && io.sockets.sockets.get(recipientSocketId)?.rooms.has(AUTHENTICATED_CHAT_ROOM)) {
              io.to(recipientSocketId).emit("chatMessage", result.message);
            }
          }
        }
      }
      ack(result);
    });

    socket.on("moveIntent", (intent) => {
      if (!characterId || battles.hasBattle(characterId)) return;
      const currentCharacterId = characterId;
      const currentLocationId = locationId;
      if (!currentLocationId) return;

      try {
        world.movePlayer(currentCharacterId, intent);
        io.to(`location:${currentLocationId}`).emit(
          "worldState",
          world.snapshot(currentLocationId)
        );
        void persistGameplayState(currentCharacterId).catch((error) =>
          reject(error, "CHARACTER_SAVE_FAILED", "Character position could not be persisted.")
        );
      } catch (error) {
        reject(error, "MOVE_REJECTED", "Movement was rejected by the server.");
      }
    });

    socket.on("interactNpc", ({ npcId }) => {
      if (!characterId) return;

      try {
        const npc = world.interactNpc(characterId, npcId);
        socket.emit("npcInteraction", npcPayload(npc.id));
      } catch (error) {
        reject(error, "NPC_INTERACTION_REJECTED", "Nie możesz teraz porozmawiać z tą postacią.");
      }
    });

    socket.on("healAtNpc", ({ npcId }) => {
      if (!characterId) return;
      const currentCharacterId = characterId;

      try {
        if (battles.hasBattle(currentCharacterId)) throw new Error("BATTLE_IN_PROGRESS");
        const npc = world.interactNpc(currentCharacterId, npcId);
        if (npc.kind !== "healer") throw new Error("NPC_NOT_HEALER");
        characters.healHp(currentCharacterId);
        void persistGameplayState(currentCharacterId).catch((error) =>
          reject(error, "CHARACTER_SAVE_FAILED", "Character state could not be persisted.")
        );
        void emitPlayerState(currentCharacterId).catch((error) =>
          reject(error, "PLAYER_STATE_FAILED", "Player state could not be loaded.")
        );
      } catch (error) {
        reject(error, "HEAL_REJECTED", "Leczenie nie jest teraz dostępne.");
      }
    });

    socket.on("setContainerSlot", async (payload, ack) => {
      if (typeof ack !== "function") return;
      const currentCharacterId = characterId;
      const currentCharacterVersion = characterVersion;
      if (!currentCharacterId || !ownsCharacter(currentCharacterId, currentCharacterVersion)) {
        ack({ ok: false, code: "AUTHENTICATION_REQUIRED", message: "Zaloguj się, aby wybrać pojemnik." });
        return;
      }
      if (!payload || typeof payload.slotIndex !== "number") {
        ack({ ok: false, code: "INVALID_CONTAINER_SLOT", message: CONTAINER_SLOT_ERRORS.INVALID_CONTAINER_SLOT! });
        return;
      }
      if (payload.itemInstanceId !== null && typeof payload.itemInstanceId !== "string") {
        ack({ ok: false, code: "INVALID_CONTAINER_INSTANCE_ID", message: CONTAINER_SLOT_ERRORS.INVALID_CONTAINER_INSTANCE_ID! });
        return;
      }
      try {
        const updatedInventory = await inventory.setContainerSlot(currentCharacterId, payload.slotIndex, payload.itemInstanceId);
        const character = characters.getSnapshot(currentCharacterId);
        if (!character || !ownsCharacter(currentCharacterId, currentCharacterVersion)) {
          ack({ ok: false, code: "SESSION_REPLACED", message: "Połączenie zostało zastąpione. Połącz się ponownie." });
          return;
        }
        socket.emit("playerState", { character, inventory: updatedInventory });
        ack({ ok: true, inventory: updatedInventory });
      } catch (error) {
        const code = error instanceof Error && CONTAINER_SLOT_ERRORS[error.message]
          ? error.message : "CONTAINER_SLOT_UPDATE_FAILED";
        ack({ ok: false, code, message: CONTAINER_SLOT_ERRORS[code] ?? "Nie udało się zapisać pojemnika. Spróbuj ponownie." });
      }
    });

    socket.on("moveItemToContainer", async (payload, ack) => {
      if (typeof ack !== "function") return;
      const currentCharacterId = characterId;
      const currentCharacterVersion = characterVersion;
      if (!currentCharacterId || !ownsCharacter(currentCharacterId, currentCharacterVersion)) {
        ack({ ok: false, code: "AUTHENTICATION_REQUIRED", message: "Zaloguj się, aby przenosić przedmioty." });
        return;
      }
      if (!payload || typeof payload.itemInstanceId !== "string") {
        ack({ ok: false, code: "INVALID_ITEM_INSTANCE_ID", message: CONTAINER_SLOT_ERRORS.INVALID_ITEM_INSTANCE_ID! });
        return;
      }
      if (payload.targetContainerInstanceId !== null && typeof payload.targetContainerInstanceId !== "string") {
        ack({ ok: false, code: "INVALID_CONTAINER_INSTANCE_ID", message: CONTAINER_SLOT_ERRORS.INVALID_CONTAINER_INSTANCE_ID! });
        return;
      }
      try {
        const updatedInventory = await inventory.moveItemToContainer(currentCharacterId, payload.itemInstanceId, payload.targetContainerInstanceId);
        const character = characters.getSnapshot(currentCharacterId);
        if (!character || !ownsCharacter(currentCharacterId, currentCharacterVersion)) {
          ack({ ok: false, code: "SESSION_REPLACED", message: "Połączenie zostało zastąpione. Połącz się ponownie." });
          return;
        }
        socket.emit("playerState", { character, inventory: updatedInventory });
        ack({ ok: true, inventory: updatedInventory });
      } catch (error) {
        const code = error instanceof Error && CONTAINER_SLOT_ERRORS[error.message]
          ? error.message : "CONTAINER_ITEM_MOVE_FAILED";
        ack({ ok: false, code, message: CONTAINER_SLOT_ERRORS[code] ?? "Nie udało się przenieść przedmiotu. Spróbuj ponownie." });
      }
    });

    socket.on("useBattleItem", (payload, ack) => {
      if (typeof ack !== "function") return;
      const currentCharacterId = characterId;
      const currentCharacterVersion = characterVersion;
      if (!currentCharacterId || !ownsCharacter(currentCharacterId, currentCharacterVersion)) {
        ack({ ok: false, code: "AUTHENTICATION_REQUIRED", message: "Zaloguj się, aby używać przedmiotów." });
        return;
      }
      if (!payload || typeof payload.combatantId !== "string" || typeof payload.itemInstanceId !== "string") {
        ack({ ok: false, code: "INVALID_ITEM_INSTANCE_ID", message: BATTLE_ITEM_ERRORS.INVALID_ITEM_INSTANCE_ID! });
        return;
      }
      if (pendingBattleItemUses.has(currentCharacterId)) {
        ack({ ok: false, code: "BATTLE_ACTION_PENDING", message: BATTLE_ITEM_ERRORS.BATTLE_ACTION_PENDING! });
        return;
      }
      const assertCurrent = (): void => {
        if (!ownsCharacter(currentCharacterId, currentCharacterVersion)) throw new Error("SESSION_REPLACED");
      };
      const operation = (async () => {
        // Earlier position snapshots must finish before the item transaction saves battle HP.
        await pendingCharacterSaves.get(currentCharacterId);
        assertCurrent();
        const applied = await battles.useConsumable(currentCharacterId, payload.combatantId, (prepare) =>
          inventory.consumeBattleItem(currentCharacterId, payload.itemInstanceId, prepare, assertCurrent)
        );
        // A disconnect during COMMIT still needs the new HP before its final save.
        if (characterOwners.get(currentCharacterId) === socket.id) {
          characters.applyBattleResult(currentCharacterId, applied.playerOutcome);
        }
        if (!ownsCharacter(currentCharacterId, currentCharacterVersion)) {
          ack({ ok: false, code: "SESSION_REPLACED", message: BATTLE_ITEM_ERRORS.SESSION_REPLACED! });
          return;
        }
        const character = characters.getSnapshot(currentCharacterId)!;
        socket.emit("battleState", applied.snapshot);
        socket.emit("playerState", { character, inventory: applied.inventory });
        ack({ ok: true, inventory: applied.inventory });
      })().catch((error: unknown) => {
        const code = error instanceof Error && BATTLE_ITEM_ERRORS[error.message]
          ? error.message : "BATTLE_ITEM_USE_FAILED";
        ack({ ok: false, code, message: BATTLE_ITEM_ERRORS[code] ?? "Nie udało się użyć przedmiotu. Spróbuj ponownie." });
      });
      pendingBattleItemUses.set(currentCharacterId, operation);
      void operation.then(() => {
        if (pendingBattleItemUses.get(currentCharacterId) === operation) pendingBattleItemUses.delete(currentCharacterId);
      });
    });

    socket.on("startEncounter", ({ encounterId }) => {
      if (!characterId) return;
      const currentCharacterId = characterId;
      const currentLocationId = locationId;
      const character = characters.getSnapshot(currentCharacterId);
      if (!currentLocationId || !character) return;

      try {
        if (battles.hasBattle(currentCharacterId)) throw new Error("BATTLE_ALREADY_STARTED");
        world.startEncounter(currentCharacterId, encounterId);
        const snapshot = battles.startBattle(character, encounterId);
        socket.leave(`location:${currentLocationId}`);
        socket.emit("battleStarted", snapshot);
      } catch (error) {
        reject(error, "ENCOUNTER_REJECTED", "Encounter could not be started.");
      }
    });

    socket.on("battleCommand", async (command) => {
      if (!characterId) return;

      const currentCharacterId = characterId;
      const currentCharacterVersion = characterVersion;
      if (pendingBattleItemUses.has(currentCharacterId)) {
        socket.emit("commandRejected", { code: "BATTLE_ACTION_PENDING", message: BATTLE_ITEM_ERRORS.BATTLE_ACTION_PENDING! });
        return;
      }
      const applied = battles.applyCommand(currentCharacterId, command);
      if (!applied.result.ok) {
        socket.emit("commandRejected", {
          code: applied.result.code,
          message: applied.result.message
        });
        return;
      }

      if (!applied.snapshot) return;
      socket.emit("battleState", applied.snapshot);

      if (!applied.finished) return;

      try {
        const beforeReward = characters.getSnapshot(currentCharacterId);
        let experienceGained = 0;
        let levelsGained = 0;
        if (applied.playerOutcome) {
          characters.applyBattleResult(currentCharacterId, applied.playerOutcome);
        }

        if (applied.victory && applied.encounterId && applied.seed !== undefined) {
          // Disconnect saves must include earned XP even while loot persistence is pending.
          const progressed = characters.awardExperience(currentCharacterId, applied.experienceReward ?? 0);
          experienceGained = (progressed.experience ?? 0) - (beforeReward?.experience ?? 0);
          levelsGained = progressed.level - (beforeReward?.level ?? progressed.level);
          const reward = loot.rollEncounterLoot(applied.encounterId, applied.seed);
          await inventory.addItems(currentCharacterId, reward);
        } else {
          characters.recoverAfterDefeat(currentCharacterId);
          world.resetPlayerToSpawn(currentCharacterId);
          locationId = world.getPlayerLocationId(currentCharacterId) ?? locationId;
        }

        await persistGameplayState(currentCharacterId);
        if (!ownsCharacter(currentCharacterId, currentCharacterVersion)) return;
        const character = characters.getSnapshot(currentCharacterId);
        const currentLocationId = locationId;
        if (!character || !currentLocationId) return;

        const inventorySnapshot = await inventory.getSnapshot(currentCharacterId);
        if (!ownsCharacter(currentCharacterId, currentCharacterVersion)) return;
        await emitPlayerState(currentCharacterId);
        if (!ownsCharacter(currentCharacterId, currentCharacterVersion)) return;
        socket.emit("battleEnded", {
          outcome: applied.victory ? "victory" : "defeat",
          inventory: inventorySnapshot,
          character,
          experienceGained,
          levelsGained
        });

        battles.removeBattleForPlayer(currentCharacterId);
        socket.join(`location:${currentLocationId}`);
        io.to(`location:${currentLocationId}`).emit(
          "worldState",
          world.snapshot(currentLocationId)
        );
      } catch (error) {
        reject(error, "BATTLE_REWARD_FAILED", "Battle rewards could not be persisted.");
      }
    });

    socket.on("disconnect", () => {
      void releaseCharacter().catch((error) =>
        reject(error, "CHARACTER_SAVE_FAILED", "Character state could not be persisted.")
      );
    });
  });

  return {
    io,
    services: { world, inventory, loot, battles, characters, connections, chat }
  };
}
