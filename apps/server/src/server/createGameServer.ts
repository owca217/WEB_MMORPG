import type { Server as HttpServer } from "node:http";
import type {
  ClientToServerEvents,
  LocationId,
  NpcInteractionPayload,
  PlayerId,
  ServerToClientEvents
} from "@web-mmorpg/shared";
import { Server } from "socket.io";
import type { AuthService } from "../auth/AuthService";
import { BattleService } from "../battle/BattleService";
import { CharacterService } from "../character/CharacterService";
import type { CharacterLifecycleService } from "../character/CharacterLifecycleService";
import { InventoryService } from "../inventory/InventoryService";
import { placeBagReward } from "../inventory/bagReward";
import { moveItemToContainer } from "../inventory/bagStorage";
import { createBagItem, createStarterContainer } from "../inventory/containers";
import { setContainerSlot } from "../inventory/containerEquipment";
import { BAG_EQUIPMENT_SLOTS } from "@web-mmorpg/shared";
import { CharacterRepository } from "../persistence/CharacterRepository";
import { PositionPersistenceCoordinator } from "../persistence/PositionPersistenceCoordinator";
import { PlayerPersistenceService } from "../persistence/PlayerPersistenceService";
import { LootService } from "../loot/LootService";
import { PartyService } from "../party/PartyService";
import { SessionStore } from "../session/SessionStore";
import { FOREST_SETTLEMENT_01 } from "../world/worldFixtures";
import { WorldService } from "../world/WorldService";
import {
  type ActiveConnection,
  ActiveConnectionRegistry
} from "./ActiveConnectionRegistry";

export interface PersistentGameServerDeps {
  authService: AuthService;
  characters: CharacterLifecycleService;
  activeConnections: ActiveConnectionRegistry;
  characterRepository: CharacterRepository;
  playerPersistence: PlayerPersistenceService;
  clientOrigin: string;
  positionCheckpointMs?: number;
}

export function createGameServer(
  httpServer: HttpServer,
  persistentDeps?: PersistentGameServerDeps
) {
  const sessions = new SessionStore();
  const world = new WorldService();
  const inventory = new InventoryService();
  const loot = new LootService();
  const battles = new BattleService();
  const characters = new CharacterService();
  const parties = new PartyService();
  const equipmentByPlayer = new Map<PlayerId, { items: Array<{ slot: string; itemInstanceId: string }> }>();
  const inventoryMutationQueues = new Map<PlayerId, Promise<void>>();
  const npcRewardClaims = new Map<PlayerId, Set<string>>();
  const inventoryRecoveryRequired = new Set<PlayerId>();
  const SIMPLE_BAG_REWARD_KEY = "quartermaster-simple-bag";
  const enqueueInventoryMutation = async (
    targetPlayerId: PlayerId,
    change: () => Promise<void>
  ): Promise<void> => {
    const previous = inventoryMutationQueues.get(targetPlayerId) ?? Promise.resolve();
    const queued = previous.then(change, change);
    inventoryMutationQueues.set(targetPlayerId, queued);
    try {
      await queued;
    } finally {
      if (inventoryMutationQueues.get(targetPlayerId) === queued) {
        inventoryMutationQueues.delete(targetPlayerId);
      }
    }
  };
  const positions = persistentDeps
    ? new PositionPersistenceCoordinator({
        intervalMs: persistentDeps.positionCheckpointMs ?? 2000,
        readPosition: (targetPlayerId) =>
          world.getPersistenceState(targetPlayerId),
        writePosition: async (targetPlayerId, state) => {
          await persistentDeps.characterRepository.updatePosition(
            targetPlayerId,
            state.locationId,
            state.x,
            state.y
          );
        }
      })
    : undefined;
  positions?.start();

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: persistentDeps
        ? (origin, callback) => {
            callback(
              null,
              origin === undefined || origin === persistentDeps.clientOrigin
            );
          }
        : true,
      credentials: false
    }
  });

  if (persistentDeps) {
    io.use(async (socket, next) => {
      try {
        const token =
          typeof socket.handshake.auth.token === "string"
            ? socket.handshake.auth.token
            : "";
        const auth = await persistentDeps.authService.validateToken(token);
        if (!auth) {
          next(new Error("UNAUTHORIZED"));
          return;
        }

        socket.data.accountId = auth.account.id;
        socket.data.authToken = token;
        next();
      } catch {
        next(new Error("UNAUTHORIZED"));
      }
    });
  }

  io.on("connection", async (socket) => {
    let playerId: PlayerId | null = null;
    let accountId: string | null = null;
    let locationId: LocationId | null = null;
    let activeConnection: ActiveConnection | null = null;
    let closedByRegistry = false;

    const emitPartyState = (targetPlayerId: PlayerId): void => {
      io.to(`player:${targetPlayerId}`).emit(
        "partyState",
        parties.getSnapshot(targetPlayerId)
      );
    };

    const emitPartyStates = (targetPlayerIds: PlayerId[]): void => {
      for (const targetPlayerId of new Set(targetPlayerIds)) {
        emitPartyState(targetPlayerId);
      }
    };

    const emitPlayerState = (targetPlayerId: PlayerId): void => {
      const character = characters.getSnapshot(targetPlayerId);
      if (!character) return;
      socket.emit("playerState", {
        character,
        inventory: inventory.getSnapshot(targetPlayerId),
        equipment: equipmentByPlayer.get(targetPlayerId) ?? { items: [] }
      });
    };

    const reject = (
      error: unknown,
      fallbackCode: string,
      message: string
    ): void => {
      socket.emit("commandRejected", {
        code: error instanceof Error ? error.message : fallbackCode,
        message
      });
    };

    const rejectIfInventoryUnavailable = (targetPlayerId: PlayerId): boolean => {
      if (!inventoryRecoveryRequired.has(targetPlayerId)) return false;
      reject(
        new Error("PERSISTENCE_RECOVERY_REQUIRED"),
        "PERSISTENCE_RECOVERY_REQUIRED",
        "Stan ekwipunku wymaga ponownego wczytania. Spróbuj ponownie za chwilę."
      );
      return true;
    };

    const hasClaimedSimpleBag = async (targetPlayerId: PlayerId): Promise<boolean> => {
      if (persistentDeps) {
        try {
          return await persistentDeps.playerPersistence.hasNpcRewardClaim(
            targetPlayerId,
            SIMPLE_BAG_REWARD_KEY
          );
        } catch {
          throw new Error("PERSISTENCE_FAILED");
        }
      }
      return npcRewardClaims.get(targetPlayerId)?.has(SIMPLE_BAG_REWARD_KEY) ?? false;
    };

    const npcPayload = async (
      npcId: string,
      targetPlayerId: PlayerId,
      claimedOverride?: boolean
    ): Promise<NpcInteractionPayload> => {
      const simpleBagRewardClaimed = npcId === "quartermaster-runa"
        ? claimedOverride ?? await hasClaimedSimpleBag(targetPlayerId)
        : false;
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
          canHeal: false,
          canClaimSimpleBag: false,
          simpleBagRewardClaimed: false
        };
      }

      if (npcId === "healer-ada") {
        return {
          npcId: "healer-ada",
          npcName: "Ada",
          kind: "healer",
          title: "Lecznica Ady",
          lines: [
            "Mogę opatrzyć cię i przywrócić siły.",
            "Ciężkie urazy pozostaną do czasu pełnego systemu leczenia."
          ],
          canHeal: true,
          canClaimSimpleBag: false,
          simpleBagRewardClaimed: false
        };
      }

      return {
        npcId: "quartermaster-runa",
        npcName: "Runa",
        kind: "quartermaster",
        title: "Zaopatrzenie przed drogą",
        lines: simpleBagRewardClaimed
          ? ["Odebrałeś już swój Zwykły worek. Niech dobrze ci służy."]
          : [
              "Każdy wyruszający z osady powinien mieć gdzie schować zapasy.",
              "Możesz odebrać ode mnie jeden Zwykły worek."
            ],
        canHeal: false,
        canClaimSimpleBag: !simpleBagRewardClaimed,
        simpleBagRewardClaimed
      };
    };

    const currentLocationId = (): LocationId | null => {
      if (locationId) return locationId;
      if (!playerId) return null;
      return sessions.get(playerId)?.locationId ?? null;
    };

    const removeRuntimePlayer = async (
      flushPosition: boolean
    ): Promise<void> => {
      if (!playerId) return;
      const targetPlayerId = playerId;
      const targetLocation = currentLocationId();

      if (flushPosition) {
        await positions?.flushPlayer(targetPlayerId);
      }

      await inventoryMutationQueues.get(targetPlayerId)?.catch(() => undefined);

      const battleDeparture = battles.removeBattleForPlayer(targetPlayerId);
      if (battleDeparture?.snapshot) {
        for (const remainingPlayerId of battleDeparture.playerIds) {
          io.to(`player:${remainingPlayerId}`).emit(
            "battleState",
            battleDeparture.snapshot
          );
        }
      }
      const partyAffected = parties.removePlayer(targetPlayerId);
      world.removePlayer(targetPlayerId);
      inventory.removePlayer(targetPlayerId);
      equipmentByPlayer.delete(targetPlayerId);
      characters.removePlayer(targetPlayerId);
      inventoryRecoveryRequired.delete(targetPlayerId);

      if (!persistentDeps) {
        sessions.remove(targetPlayerId);
      }

      emitPartyStates(partyAffected);

      if (targetLocation) {
        io.to(`location:${targetLocation}`).emit(
          "worldState",
          world.snapshot(targetLocation)
        );
      }
    };

    if (persistentDeps) {
      accountId =
        typeof socket.data.accountId === "string"
          ? socket.data.accountId
          : null;

      if (!accountId) {
        socket.disconnect(true);
        return;
      }

      const lifecycle = await persistentDeps.characters.getLifecycle(
        accountId,
        new Date()
      );
      if (lifecycle.state !== "active") {
        socket.disconnect(true);
        return;
      }

      const persisted =
        await persistentDeps.characterRepository.findByAccountId(accountId);
      if (!persisted || persisted.id !== lifecycle.characterId) {
        socket.disconnect(true);
        return;
      }

      await persistentDeps.activeConnections.closeAccount(
        accountId,
        "sessionReplaced"
      );

      await inventoryMutationQueues.get(persisted.id)?.catch(() => undefined);

      const durableState =
        await persistentDeps.playerPersistence.loadPlayer(persisted.id);

      playerId = persisted.id;
      locationId = persisted.locationId;
      characters.hydratePlayer(durableState.character);
      inventory.hydratePlayer(persisted.id, durableState.inventory);
      equipmentByPlayer.set(persisted.id, durableState.equipment);
      inventoryRecoveryRequired.delete(persisted.id);
      world.addPlayer({
        id: persisted.id,
        nickname: persisted.nickname,
        appearance: persisted.appearance,
        locationId: persisted.locationId,
        x: persisted.x,
        y: persisted.y
      });
      socket.join(`location:${locationId}`);
      socket.join(`player:${persisted.id}`);

      activeConnection = {
        async close(reason) {
          if (closedByRegistry) return;
          closedByRegistry = true;
          await removeRuntimePlayer(true);
          if (reason === "sessionReplaced") {
            socket.emit("sessionReplaced");
          }
          socket.disconnect(true);
        }
      };
      persistentDeps.activeConnections.attach(accountId, activeConnection);

      emitPlayerState(persisted.id);
      io.to(`location:${locationId}`).emit(
        "worldState",
        world.snapshot(locationId)
      );
    } else {
      socket.on("login", ({ nickname }, ack) => {
        const result = sessions.login(nickname);
        if (!result.ok) {
          ack(result);
          return;
        }

        playerId = result.playerId;
        locationId = result.locationId;
        const session = sessions.get(result.playerId);
        const resolvedNickname = session?.nickname ?? nickname.trim();
        characters.createPlayer(result.playerId, resolvedNickname);
        const starterContainer = createStarterContainer();
        inventory.hydratePlayer(result.playerId, { items: [starterContainer] });
        equipmentByPlayer.set(result.playerId, {
          items: [{
            slot: BAG_EQUIPMENT_SLOTS[0],
            itemInstanceId: starterContainer.instanceId
          }]
        });
        world.addPlayer({ id: result.playerId, nickname: resolvedNickname });
        socket.join(`location:${result.locationId}`);
        socket.join(`player:${result.playerId}`);
        ack(result);
        emitPlayerState(result.playerId);
        io.to(`location:${result.locationId}`).emit(
          "worldState",
          world.snapshot(result.locationId)
        );
      });
    }

    socket.on("requestPlayerState", () => {
      if (!playerId) return;
      emitPlayerState(playerId);
    });

    socket.on("setContainerSlot", async ({ slot, itemInstanceId }) => {
      if (!playerId) return;
      const targetPlayerId = playerId;
      const applyChange = async (): Promise<void> => {
        if (
          closedByRegistry
          || !socket.connected
          || playerId !== targetPlayerId
          || !characters.getSnapshot(targetPlayerId)
        ) return;
        if (rejectIfInventoryUnavailable(targetPlayerId)) return;

        const previous = equipmentByPlayer.get(targetPlayerId) ?? { items: [] };
        try {
          const next = setContainerSlot(
            previous,
            inventory.getSnapshot(targetPlayerId),
            slot,
            itemInstanceId
          );

          if (persistentDeps) {
            try {
              await persistentDeps.playerPersistence.saveEquipment(
                targetPlayerId,
                next
              );
            } catch {
              let restored: Awaited<ReturnType<PlayerPersistenceService["loadPlayer"]>>;
              try {
                restored = await persistentDeps.playerPersistence.loadPlayer(targetPlayerId);
              } catch {
                inventoryRecoveryRequired.add(targetPlayerId);
                throw new Error("PERSISTENCE_FAILED");
              }
              if (
                closedByRegistry
                || !socket.connected
                || playerId !== targetPlayerId
                || !characters.getSnapshot(targetPlayerId)
              ) return;
              characters.hydratePlayer(restored.character);
              inventory.hydratePlayer(targetPlayerId, restored.inventory);
              equipmentByPlayer.set(targetPlayerId, restored.equipment);
              reject(
                new Error("PERSISTENCE_FAILED"),
                "PERSISTENCE_FAILED",
                "Nie udało się zapisać założonego pojemnika."
              );
              emitPlayerState(targetPlayerId);
              return;
            }
          }

          if (
            closedByRegistry
            || !socket.connected
            || playerId !== targetPlayerId
            || !characters.getSnapshot(targetPlayerId)
          ) return;

          equipmentByPlayer.set(targetPlayerId, next);
          emitPlayerState(targetPlayerId);
        } catch (error) {
          reject(
            error,
            "CONTAINER_SLOT_REJECTED",
            "Nie można założyć tego przedmiotu w slocie pojemnika."
          );
        }
      };

      await enqueueInventoryMutation(targetPlayerId, applyChange);
    });

    socket.on("moveInventoryItem", async ({ itemInstanceId, containerInstanceId }) => {
      if (!playerId) return;
      const targetPlayerId = playerId;
      await enqueueInventoryMutation(targetPlayerId, async () => {
        if (
          closedByRegistry
          || !socket.connected
          || playerId !== targetPlayerId
          || !characters.getSnapshot(targetPlayerId)
        ) return;
        if (rejectIfInventoryUnavailable(targetPlayerId)) return;

        const currentInventory = inventory.getSnapshot(targetPlayerId);
        let nextInventory;
        try {
          nextInventory = moveItemToContainer(
            currentInventory,
            itemInstanceId,
            containerInstanceId
          );
        } catch (error) {
          reject(
            error,
            "INVENTORY_MOVE_REJECTED",
            "Nie można przenieść tego przedmiotu do wybranej torby."
          );
          return;
        }

        if (nextInventory === currentInventory) return;

        if (persistentDeps) {
          try {
            await persistentDeps.playerPersistence.saveInventoryAndEquipment(
              targetPlayerId,
              nextInventory,
              equipmentByPlayer.get(targetPlayerId) ?? { items: [] }
            );
          } catch {
            let restored: Awaited<ReturnType<PlayerPersistenceService["loadPlayer"]>> | undefined;
            try {
              restored = await persistentDeps.playerPersistence.loadPlayer(targetPlayerId);
            } catch {
              restored = undefined;
              inventoryRecoveryRequired.add(targetPlayerId);
            }
            if (
              restored
              && !closedByRegistry
              && socket.connected
              && playerId === targetPlayerId
              && characters.getSnapshot(targetPlayerId)
            ) {
              characters.hydratePlayer(restored.character);
              inventory.hydratePlayer(targetPlayerId, restored.inventory);
              equipmentByPlayer.set(targetPlayerId, restored.equipment);
            }
            if (
              !closedByRegistry
              && socket.connected
              && playerId === targetPlayerId
              && characters.getSnapshot(targetPlayerId)
            ) {
              reject(
                new Error("PERSISTENCE_FAILED"),
                "PERSISTENCE_FAILED",
                "Nie udało się zapisać zawartości torby."
              );
              if (restored) emitPlayerState(targetPlayerId);
            }
            return;
          }
        }

        if (
          closedByRegistry
          || !socket.connected
          || playerId !== targetPlayerId
          || !characters.getSnapshot(targetPlayerId)
        ) return;

        inventory.hydratePlayer(targetPlayerId, nextInventory);
        emitPlayerState(targetPlayerId);
      });
    });

    socket.on("requestWorldState", () => {
      if (!playerId) return;
      const targetLocation = currentLocationId();
      if (!targetLocation) return;
      socket.emit("worldState", world.snapshot(targetLocation));
    });

    socket.on("requestPartyState", () => {
      if (!playerId) return;
      socket.emit("partyState", parties.getSnapshot(playerId));
    });

    socket.on("inviteToParty", ({ targetPlayerId }) => {
      if (!playerId) return;

      try {
        if (battles.hasBattle(targetPlayerId)) {
          throw new Error("PARTY_TARGET_BUSY");
        }

        const targetLocation = currentLocationId();
        const inviter = world.getPlayer(playerId);
        const target = world.getPlayer(targetPlayerId);
        const targetVisible = Boolean(
          targetLocation &&
            world
              .snapshot(targetLocation)
              .players.some((candidate) => candidate.id === targetPlayerId)
        );
        if (!inviter || !target || !targetVisible) {
          throw new Error("PARTY_PLAYER_NOT_FOUND");
        }

        const invite = parties.createInvite(
          { playerId: inviter.id, nickname: inviter.nickname },
          { playerId: target.id, nickname: target.nickname }
        );
        io.to(`player:${targetPlayerId}`).emit("partyInviteReceived", invite);
      } catch (error) {
        reject(
          error,
          "PARTY_INVITE_REJECTED",
          "Nie udało się wysłać zaproszenia do drużyny."
        );
      }
    });

    socket.on("respondPartyInvite", ({ inviteId, accept }) => {
      if (!playerId) return;

      try {
        const result = parties.respondToInvite(inviteId, playerId, accept);
        io.to(`player:${result.inviterPlayerId}`).emit(
          "partyInviteResolved",
          {
            targetPlayerId: playerId,
            targetNickname: result.targetNickname,
            accepted: result.accepted
          }
        );
        if (result.accepted) emitPartyStates(result.affectedPlayerIds);
      } catch (error) {
        reject(
          error,
          "PARTY_INVITE_RESPONSE_REJECTED",
          "Nie udało się odpowiedzieć na zaproszenie."
        );
      }
    });

    socket.on("setPartyBattleMode", ({ enabled }) => {
      if (!playerId) return;

      try {
        if (typeof enabled !== "boolean") {
          throw new Error("PARTY_INVALID_BATTLE_MODE");
        }
        emitPartyStates(
          parties.setPartyBattleEnabled(playerId, enabled)
        );
      } catch (error) {
        reject(
          error,
          "PARTY_BATTLE_MODE_REJECTED",
          "Nie udało się zmienić trybu walk drużynowych."
        );
      }
    });

    socket.on("leaveParty", () => {
      if (!playerId) return;
      emitPartyStates(parties.leave(playerId));
    });

    socket.on("moveIntent", (intent) => {
      if (!playerId || battles.hasBattle(playerId)) return;
      const targetLocation = currentLocationId();
      if (!targetLocation) return;

      try {
        world.movePlayer(playerId, intent);
        positions?.markDirty(playerId);
        io.to(`location:${targetLocation}`).emit(
          "worldState",
          world.snapshot(targetLocation)
        );
      } catch (error) {
        reject(error, "MOVE_REJECTED", "Movement was rejected by the server.");
      }
    });

    socket.on("interactNpc", async ({ npcId }) => {
      if (!playerId) return;
      const targetPlayerId = playerId;

      try {
        const npc = world.interactNpc(targetPlayerId, npcId);
        const payload = await npcPayload(npc.id, targetPlayerId);
        if (
          !closedByRegistry
          && socket.connected
          && playerId === targetPlayerId
          && characters.getSnapshot(targetPlayerId)
        ) {
          socket.emit("npcInteraction", payload);
        }
      } catch (error) {
        reject(
          error,
          "NPC_INTERACTION_REJECTED",
          "Nie możesz teraz porozmawiać z tą postacią."
        );
      }
    });

    socket.on("claimSimpleBag", async ({ npcId }) => {
      if (!playerId) return;
      const targetPlayerId = playerId;

      await enqueueInventoryMutation(targetPlayerId, async () => {
        if (
          closedByRegistry
          || !socket.connected
          || playerId !== targetPlayerId
          || !characters.getSnapshot(targetPlayerId)
        ) return;
        if (rejectIfInventoryUnavailable(targetPlayerId)) return;

        try {
          const npc = world.interactNpc(targetPlayerId, npcId);
          if (npc.kind !== "quartermaster") {
            throw new Error("NPC_NOT_QUARTERMASTER");
          }

          if (await hasClaimedSimpleBag(targetPlayerId)) {
            socket.emit(
              "npcInteraction",
              await npcPayload(npc.id, targetPlayerId, true)
            );
            return;
          }

          const bag = createBagItem("simple-bag");
          const currentEquipment = equipmentByPlayer.get(targetPlayerId) ?? { items: [] };
          const { inventory: nextInventory, equipment: nextEquipment } = placeBagReward(
            inventory.getSnapshot(targetPlayerId),
            currentEquipment,
            bag
          );

          if (persistentDeps) {
            let claimed: boolean;
            try {
              claimed = await persistentDeps.playerPersistence.claimNpcRewardOnce(
                targetPlayerId,
                SIMPLE_BAG_REWARD_KEY,
                nextInventory,
                nextEquipment
              );
            } catch {
              let restored: Awaited<ReturnType<PlayerPersistenceService["loadPlayer"]>>;
              try {
                restored = await persistentDeps.playerPersistence.loadPlayer(targetPlayerId);
              } catch {
                inventoryRecoveryRequired.add(targetPlayerId);
                reject(
                  new Error("PERSISTENCE_FAILED"),
                  "PERSISTENCE_FAILED",
                  "Nie udało się potwierdzić zapisu worka. Ponowne wczytanie ekwipunku jest wymagane."
                );
                return;
              }

              if (
                closedByRegistry
                || !socket.connected
                || playerId !== targetPlayerId
                || !characters.getSnapshot(targetPlayerId)
              ) return;

              characters.hydratePlayer(restored.character);
              inventory.hydratePlayer(targetPlayerId, restored.inventory);
              equipmentByPlayer.set(targetPlayerId, restored.equipment);
              inventoryRecoveryRequired.delete(targetPlayerId);
              emitPlayerState(targetPlayerId);

              let rewardWasCommitted: boolean;
              try {
                rewardWasCommitted = await hasClaimedSimpleBag(targetPlayerId);
              } catch {
                reject(
                  new Error("PERSISTENCE_FAILED"),
                  "PERSISTENCE_FAILED",
                  "Worek został ponownie wczytany, ale nie udało się potwierdzić odbioru."
                );
                return;
              }

              if (
                closedByRegistry
                || !socket.connected
                || playerId !== targetPlayerId
                || !characters.getSnapshot(targetPlayerId)
              ) return;

              const npc = world.interactNpc(targetPlayerId, npcId);
              const response = await npcPayload(
                npc.id,
                targetPlayerId,
                rewardWasCommitted
              );
              if (
                closedByRegistry
                || !socket.connected
                || playerId !== targetPlayerId
              ) return;
              socket.emit("npcInteraction", response);
              if (!rewardWasCommitted) {
                reject(
                  new Error("PERSISTENCE_FAILED"),
                  "PERSISTENCE_FAILED",
                  "Nie udało się zapisać odebranego worka."
                );
              }
              return;
            }
            if (!claimed) {
              socket.emit(
                "npcInteraction",
                await npcPayload(npc.id, targetPlayerId, true)
              );
              return;
            }
          } else {
            const claims = npcRewardClaims.get(targetPlayerId) ?? new Set<string>();
            claims.add(SIMPLE_BAG_REWARD_KEY);
            npcRewardClaims.set(targetPlayerId, claims);
          }

          if (
            closedByRegistry
            || !socket.connected
            || playerId !== targetPlayerId
            || !characters.getSnapshot(targetPlayerId)
          ) return;

          inventory.hydratePlayer(targetPlayerId, nextInventory);
          equipmentByPlayer.set(targetPlayerId, nextEquipment);
          emitPlayerState(targetPlayerId);
          socket.emit(
            "npcInteraction",
            await npcPayload(npc.id, targetPlayerId, true)
          );
        } catch (error) {
          reject(
            error,
            "NPC_REWARD_REJECTED",
            "Nie udało się odebrać worka."
          );
        }
      });
    });

    socket.on("healAtNpc", async ({ npcId }) => {
      if (!playerId) return;
      const targetPlayerId = playerId;

      await enqueueInventoryMutation(targetPlayerId, async () => {
        if (
          closedByRegistry
          || !socket.connected
          || playerId !== targetPlayerId
          || !characters.getSnapshot(targetPlayerId)
        ) return;
        if (rejectIfInventoryUnavailable(targetPlayerId)) return;

        try {
          const npc = world.interactNpc(targetPlayerId, npcId);
          if (npc.kind !== "healer") throw new Error("NPC_NOT_HEALER");

          const healed = characters.healHp(targetPlayerId);
          if (persistentDeps) {
            try {
              await persistentDeps.playerPersistence.saveCharacterState(healed);
            } catch {
              let restored: Awaited<ReturnType<PlayerPersistenceService["loadPlayer"]>>;
              try {
                restored = await persistentDeps.playerPersistence.loadPlayer(targetPlayerId);
              } catch {
                inventoryRecoveryRequired.add(targetPlayerId);
                reject(
                  new Error("PERSISTENCE_FAILED"),
                  "PERSISTENCE_FAILED",
                  "Nie udało się ponownie wczytać stanu po błędzie leczenia."
                );
                return;
              }

              if (
                closedByRegistry
                || !socket.connected
                || playerId !== targetPlayerId
                || !characters.getSnapshot(targetPlayerId)
              ) return;

              characters.hydratePlayer(restored.character);
              inventory.hydratePlayer(targetPlayerId, restored.inventory);
              equipmentByPlayer.set(targetPlayerId, restored.equipment);
              inventoryRecoveryRequired.delete(targetPlayerId);
              reject(
                new Error("PERSISTENCE_FAILED"),
                "PERSISTENCE_FAILED",
                "Nie udało się trwale zapisać leczenia."
              );
              emitPlayerState(targetPlayerId);
              return;
            }
          }

          if (
            closedByRegistry
            || !socket.connected
            || playerId !== targetPlayerId
            || !characters.getSnapshot(targetPlayerId)
          ) return;
          emitPlayerState(targetPlayerId);
        } catch (error) {
          reject(error, "HEAL_REJECTED", "Leczenie nie jest teraz dostępne.");
        }
      });
    });

    socket.on("startEncounter", async ({ encounterId }) => {
      if (!playerId) return;
      const targetLocation = currentLocationId();
      const character = characters.getSnapshot(playerId);
      if (!targetLocation || !character) return;

      try {
        if (battles.hasBattle(playerId)) {
          throw new Error("PLAYER_ALREADY_IN_BATTLE");
        }

        world.startEncounter(playerId, encounterId);

        const party = parties.getSnapshot(playerId);
        if (party && party.leaderPlayerId !== playerId) {
          throw new Error("PARTY_ONLY_LEADER_CAN_START_BATTLE");
        }

        const candidateIds =
          party?.partyBattleEnabled
            ? party.members.map((member) => member.playerId)
            : [playerId];

        const participantIds: PlayerId[] = [];
        const participantCharacters = [];

        for (const candidateId of candidateIds) {
          if (battles.hasBattle(candidateId)) continue;

          const position = world.getPersistenceState(candidateId);
          const candidateCharacter = characters.getSnapshot(candidateId);
          if (
            !position ||
            position.locationId !== targetLocation ||
            !candidateCharacter
          ) {
            continue;
          }

          if (
            candidateId !== playerId &&
            !world.isWithinPartyBattleVision(playerId, candidateId)
          ) {
            continue;
          }

          participantIds.push(candidateId);
          participantCharacters.push(candidateCharacter);
        }

        if (!participantIds.includes(playerId)) {
          throw new Error("ENCOUNTER_OUT_OF_RANGE");
        }

        const snapshot = battles.startPartyBattle(
          participantCharacters,
          encounterId
        );

        await Promise.all(
          participantIds.map((participantId) =>
            positions?.flushPlayer(participantId)
          )
        );

        for (const participantId of participantIds) {
          io.in(`player:${participantId}`).socketsLeave(
            `location:${targetLocation}`
          );
          io.to(`player:${participantId}`).emit(
            "battleStarted",
            snapshot
          );
        }
      } catch (error) {
        reject(
          error,
          "ENCOUNTER_REJECTED",
          "Encounter could not be started."
        );
      }
    });

    socket.on("battleCommand", async (command) => {
      if (!playerId) return;

      const applied = battles.applyCommand(playerId, command);
      if (!applied.result.ok) {
        socket.emit("commandRejected", {
          code: applied.result.code,
          message: applied.result.message
        });
        return;
      }

      if (!applied.snapshot) return;

      for (const participantId of applied.playerIds) {
        io.to(`player:${participantId}`).emit(
          "battleState",
          applied.snapshot
        );
      }

      if (!applied.finished) return;

      const affectedLocations = new Set<LocationId>();

      for (const participantId of applied.playerIds) {
        let settlementAvailable = true;
        await enqueueInventoryMutation(participantId, async () => {
          if (inventoryRecoveryRequired.has(participantId)) {
            settlementAvailable = false;
            io.to(`player:${participantId}`).emit("commandRejected", {
              code: "PERSISTENCE_RECOVERY_REQUIRED",
              message: "Nie można zapisać wyniku walki przed ponownym wczytaniem ekwipunku."
            });
            return;
          }

          let participantCharacter = characters.getSnapshot(participantId);
          if (!participantCharacter) {
            settlementAvailable = false;
            return;
          }

          const outcome = applied.playerOutcomes?.find(
            (entry) => entry.playerId === participantId
          );
          if (outcome) {
            participantCharacter = characters.applyBattleResult(participantId, outcome);
          }

          if (
            applied.victory &&
            applied.encounterId &&
            applied.seed !== undefined
          ) {
            if (participantCharacter.hp <= 0) {
              participantCharacter =
                characters.recoverAfterDefeat(participantId);
            }

            const reward = loot.rollEncounterLoot(
              applied.encounterId,
              applied.seed
            );
            inventory.addItems(participantId, reward);
          } else {
            participantCharacter =
              characters.recoverAfterDefeat(participantId);
            world.resetPlayerToSpawn(participantId);
            positions?.markDirty(participantId);
          }

          if (persistentDeps) {
            try {
              await persistentDeps.playerPersistence.saveBattleOutcome(
                participantCharacter,
                inventory.getSnapshot(participantId)
              );
            } catch {
              try {
                const restored =
                  await persistentDeps.playerPersistence.loadPlayer(
                    participantId
                  );
                characters.hydratePlayer(restored.character);
                inventory.hydratePlayer(participantId, restored.inventory);
                equipmentByPlayer.set(participantId, restored.equipment);
              } catch {
                inventoryRecoveryRequired.add(participantId);
                settlementAvailable = false;
              }
              io.to(`player:${participantId}`).emit(
                "commandRejected",
                {
                  code: "PERSISTENCE_FAILED",
                  message:
                    "Nie udało się trwale zapisać wyniku walki."
                }
              );
            }
          }
        });

        if (!settlementAvailable) continue;

        await positions?.flushPlayer(participantId);

        const participantLocation =
          world.getPersistenceState(participantId)?.locationId;
        if (participantLocation) {
          affectedLocations.add(participantLocation);
          io.in(`player:${participantId}`).socketsJoin(
            `location:${participantLocation}`
          );
        }

        const finalCharacter =
          characters.getSnapshot(participantId);
        const finalInventory =
          inventory.getSnapshot(participantId);
        if (!finalCharacter) continue;

        io.to(`player:${participantId}`).emit("playerState", {
          character: finalCharacter,
          inventory: finalInventory,
          equipment:
            equipmentByPlayer.get(participantId) ?? { items: [] }
        });
        io.to(`player:${participantId}`).emit("battleEnded", {
          outcome: applied.victory ? "victory" : "defeat",
          inventory: finalInventory,
          character: finalCharacter
        });
      }

      battles.finishBattle(playerId);

      for (const affectedLocation of affectedLocations) {
        io.to(`location:${affectedLocation}`).emit(
          "worldState",
          world.snapshot(affectedLocation)
        );
      }
    });

    socket.on("disconnect", () => {
      void (async () => {
        if (persistentDeps && accountId && activeConnection) {
          persistentDeps.activeConnections.detach(accountId, activeConnection);
        }

        if (!closedByRegistry) {
          await removeRuntimePlayer(Boolean(persistentDeps));
        }
      })();
    });
  });

  return {
    io,
    services: {
      sessions,
      world,
      inventory,
      loot,
      battles,
      characters,
      parties,
      positions,
      playerPersistence: persistentDeps?.playerPersistence
    }
  };
}
