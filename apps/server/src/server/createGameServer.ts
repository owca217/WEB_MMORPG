import type { Server as HttpServer } from "node:http";
import { normalizeAppearanceSelection } from "@web-mmorpg/shared";
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
import type { CharacterLifecycleService } from "../character/CharacterLifecycleService";
import { CharacterService } from "../character/CharacterService";
import { InventoryService } from "../inventory/InventoryService";
import { PartyService } from "../party/PartyService";
import { LootService } from "../loot/LootService";
import { WorldService } from "../world/WorldService";
import { ActiveConnectionRegistry } from "./ActiveConnectionRegistry";

export interface GameServerOptions {
  pool: Pool;
  authService: AuthService;
  characterLifecycle: CharacterLifecycleService;
  connections?: ActiveConnectionRegistry;
}

export function createGameServer(
  httpServer: HttpServer,
  options: GameServerOptions
) {
  const world = new WorldService();
  const inventory = new InventoryService(options.pool);
  const loot = new LootService();
  const battles = new BattleService();
  const parties = new PartyService();
  const characters = new CharacterService();
  const connections = options.connections ?? new ActiveConnectionRegistry();

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: true, credentials: false }
  });

  io.on("connection", (socket) => {
    let characterId: PlayerId | null = null;
    let accountId: string | null = null;
    let locationId: LocationId | null = null;
    let unregisterConnection: (() => void) | null = null;

    const emitPlayerState = async (targetCharacterId: PlayerId): Promise<void> => {
      const character = characters.getSnapshot(targetCharacterId);
      if (!character) return;
      const [inventorySnapshot, equipment] = await Promise.all([
        inventory.getSnapshot(targetCharacterId),
        inventory.getEquipmentSnapshot(targetCharacterId)
      ]);
      socket.emit("playerState", {
        character,
        inventory: inventorySnapshot,
        equipment
      });
    };

    const emitPartyState = (targetCharacterId: PlayerId): void => {
      io.to(`player:${targetCharacterId}`).emit(
        "partyState",
        parties.getSnapshot(targetCharacterId)
      );
    };

    const emitPartyStates = (targetCharacterIds: PlayerId[]): void => {
      for (const targetCharacterId of new Set(targetCharacterIds)) {
        emitPartyState(targetCharacterId);
      }
    };

    const reject = (error: unknown, fallbackCode: string, message: string): void => {
      socket.emit("commandRejected", {
        code: error instanceof Error ? error.message : fallbackCode,
        message
      });
    };

    const persistGameplayState = async (targetCharacterId: PlayerId): Promise<void> => {
      const character = characters.getSnapshot(targetCharacterId);
      const player = world.getPlayer(targetCharacterId);
      const currentLocationId = world.getPlayerLocationId(targetCharacterId) ?? locationId;
      if (!character || !player || !currentLocationId) return;

      await options.characterLifecycle.saveGameplayState(targetCharacterId, {
        locationId: currentLocationId,
        x: player.x,
        y: player.y,
        level: character.level,
        experience: character.experience ?? 0,
        hp: character.hp,
        maxHp: character.maxHp,
        maxAp: character.maxAp,
        initiative: character.initiative,
        severelyInjured: character.severelyInjured,
        injuries: character.injuries
      });
    };

    const npcPayload = async (
      npcId: string,
      targetCharacterId: PlayerId,
      claimedOverride?: boolean
    ): Promise<NpcInteractionPayload> => {
      const simpleBagRewardClaimed = npcId === "quartermaster-runa"
        ? claimedOverride ?? await inventory.hasRewardClaim(
            targetCharacterId,
            "quartermaster-simple-bag"
          )
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

        const persisted = await options.characterLifecycle.getCharacter(validated.account.id);
        if (!persisted || persisted.deletionEffectiveAt) {
          ack({
            ok: false,
            code: "CHARACTER_REQUIRED",
            message: "An active character is required before entering the world."
          });
          return;
        }

        if (characterId) {
          await persistGameplayState(characterId);
          battles.removeBattleForPlayer(characterId);
          emitPartyStates(parties.removePlayer(characterId));
          socket.leave(`player:${characterId}`);
          world.removePlayer(characterId);
          characters.removePlayer(characterId);
        }
        unregisterConnection?.();

        accountId = validated.account.id;
        characterId = persisted.id;
        locationId = persisted.locationId;

        connections.closeAccount(accountId, "SESSION_REPLACED", socket.id);
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
          appearance: normalizeAppearanceSelection(persisted.appearance),
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
          appearance: normalizeAppearanceSelection(persisted.appearance),
          locationId: persisted.locationId,
          x: persisted.x,
          y: persisted.y
        });

        socket.join(`location:${persisted.locationId}`);
        socket.join(`player:${persisted.id}`);
        ack({
          ok: true,
          characterId: persisted.id,
          locationId: persisted.locationId
        });
        await emitPlayerState(persisted.id);
        emitPartyState(persisted.id);
        io.to(`location:${persisted.locationId}`).emit(
          "worldState",
          world.snapshot(persisted.locationId)
        );
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

    socket.on("setContainerSlot", async ({ slot, itemInstanceId }) => {
      if (!characterId) return;
      try {
        await inventory.setContainerSlot(characterId, slot, itemInstanceId);
        await emitPlayerState(characterId);
      } catch (error) {
        reject(error, "CONTAINER_SLOT_REJECTED", "Nie można założyć tego przedmiotu w slocie pojemnika.");
      }
    });

    socket.on("moveInventoryItem", async ({ itemInstanceId, containerInstanceId }) => {
      if (!characterId) return;
      try {
        await inventory.moveInventoryItem(characterId, itemInstanceId, containerInstanceId);
        await emitPlayerState(characterId);
      } catch (error) {
        reject(error, "INVENTORY_MOVE_REJECTED", "Nie można przenieść tego przedmiotu do wybranej torby.");
      }
    });

    socket.on("claimSimpleBag", async ({ npcId }) => {
      if (!characterId) return;
      const targetCharacterId = characterId;
      try {
        const npc = world.interactNpc(targetCharacterId, npcId);
        if (npc.kind !== "quartermaster") throw new Error("NPC_NOT_QUARTERMASTER");
        const result = await inventory.claimSimpleBag(targetCharacterId);
        await emitPlayerState(targetCharacterId);
        socket.emit("npcInteraction", await npcPayload(npc.id, targetCharacterId, true));
        if (!result.claimed) return;
      } catch (error) {
        reject(error, "NPC_REWARD_REJECTED", "Nie udało się odebrać worka.");
      }
    });

    socket.on("requestPartyState", () => {
      if (characterId) emitPartyState(characterId);
    });

    socket.on("inviteToParty", ({ targetPlayerId }) => {
      if (!characterId) return;
      try {
        if (battles.hasBattle(targetPlayerId)) throw new Error("PARTY_TARGET_BUSY");
        const currentLocationId = world.getPlayerLocationId(characterId);
        const inviter = world.getPlayer(characterId);
        const target = world.getPlayer(targetPlayerId);
        const targetVisible = Boolean(
          currentLocationId
          && world.snapshot(currentLocationId).players.some((candidate) => candidate.id === targetPlayerId)
        );
        if (!inviter || !target || !targetVisible) throw new Error("PARTY_PLAYER_NOT_FOUND");
        const invite = parties.createInvite(
          { playerId: inviter.id, nickname: inviter.nickname },
          { playerId: target.id, nickname: target.nickname }
        );
        io.to(`player:${targetPlayerId}`).emit("partyInviteReceived", invite);
      } catch (error) {
        reject(error, "PARTY_INVITE_REJECTED", "Nie udało się wysłać zaproszenia do drużyny.");
      }
    });

    socket.on("respondPartyInvite", ({ inviteId, accept }) => {
      if (!characterId) return;
      try {
        const result = parties.respondToInvite(inviteId, characterId, accept);
        io.to(`player:${result.inviterPlayerId}`).emit("partyInviteResolved", {
          targetPlayerId: characterId,
          targetNickname: result.targetNickname,
          accepted: result.accepted
        });
        if (result.accepted) emitPartyStates(result.affectedPlayerIds);
      } catch (error) {
        reject(error, "PARTY_INVITE_RESPONSE_REJECTED", "Nie udało się odpowiedzieć na zaproszenie.");
      }
    });

    socket.on("setPartyBattleMode", ({ enabled }) => {
      if (!characterId) return;
      try {
        if (typeof enabled !== "boolean") throw new Error("PARTY_INVALID_BATTLE_MODE");
        emitPartyStates(parties.setPartyBattleEnabled(characterId, enabled));
      } catch (error) {
        reject(error, "PARTY_BATTLE_MODE_REJECTED", "Nie udało się zmienić trybu walk drużynowych.");
      }
    });

    socket.on("leaveParty", () => {
      if (characterId) emitPartyStates(parties.leave(characterId));
    });

    socket.on("requestWorldState", () => {
      if (!characterId || !locationId) return;
      socket.emit("worldState", world.snapshot(locationId));
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

    socket.on("interactNpc", async ({ npcId }) => {
      if (!characterId) return;
      const targetCharacterId = characterId;
      try {
        const npc = world.interactNpc(targetCharacterId, npcId);
        socket.emit("npcInteraction", await npcPayload(npc.id, targetCharacterId));
      } catch (error) {
        reject(error, "NPC_INTERACTION_REJECTED", "Nie możesz teraz porozmawiać z tą postacią.");
      }
    });

    socket.on("healAtNpc", ({ npcId }) => {
      if (!characterId) return;
      const currentCharacterId = characterId;

      try {
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

    socket.on("startEncounter", async ({ encounterId }) => {
      if (!characterId) return;
      const leaderPlayerId = characterId;
      const battleLocationId = world.getPlayerLocationId(leaderPlayerId);
      if (!battleLocationId || !characters.getSnapshot(leaderPlayerId)) return;

      try {
        if (battles.hasBattle(leaderPlayerId)) throw new Error("PLAYER_ALREADY_IN_BATTLE");
        world.startEncounter(leaderPlayerId, encounterId);

        const party = parties.getSnapshot(leaderPlayerId);
        if (party && party.leaderPlayerId !== leaderPlayerId) {
          throw new Error("PARTY_ONLY_LEADER_CAN_START_BATTLE");
        }
        const candidateIds = party?.partyBattleEnabled
          ? party.members.map((member) => member.playerId)
          : [leaderPlayerId];
        const participantIds: PlayerId[] = [];
        const participantCharacters = [];

        for (const candidateId of candidateIds) {
          if (battles.hasBattle(candidateId)) continue;
          const position = world.getPersistenceState(candidateId);
          const candidateCharacter = characters.getSnapshot(candidateId);
          if (!position || position.locationId !== battleLocationId || !candidateCharacter) continue;
          if (
            candidateId !== leaderPlayerId &&
            !world.isWithinPartyBattleVision(leaderPlayerId, candidateId)
          ) continue;
          participantIds.push(candidateId);
          participantCharacters.push(candidateCharacter);
        }

        if (!participantIds.includes(leaderPlayerId)) throw new Error("ENCOUNTER_OUT_OF_RANGE");
        const snapshot = battles.startPartyBattle(participantCharacters, encounterId);
        await Promise.all(participantIds.map((participantId) => persistGameplayState(participantId)));

        for (const participantId of participantIds) {
          io.in(`player:${participantId}`).socketsLeave(`location:${battleLocationId}`);
          io.to(`player:${participantId}`).emit("battleStarted", snapshot);
        }
      } catch (error) {
        reject(error, "ENCOUNTER_REJECTED", "Encounter could not be started.");
      }
    });

    socket.on("battleCommand", async (command) => {
      if (!characterId) return;
      const applied = battles.applyCommand(characterId, command);
      if (!applied.result.ok) {
        socket.emit("commandRejected", {
          code: applied.result.code,
          message: applied.result.message
        });
        return;
      }
      if (!applied.snapshot) return;

      for (const participantId of applied.playerIds) {
        io.to(`player:${participantId}`).emit("battleState", applied.snapshot);
      }
      if (!applied.finished) return;

      try {
        const affectedLocations = new Set<LocationId>();
        for (const participantId of applied.playerIds) {
          let participantCharacter = characters.getSnapshot(participantId);
          if (!participantCharacter) continue;
          const outcome = applied.playerOutcomes?.find((entry) => entry.playerId === participantId);
          if (outcome) participantCharacter = characters.applyBattleResult(participantId, outcome);

          if (applied.victory && applied.encounterId && applied.seed !== undefined) {
            if (participantCharacter.hp <= 0) {
              participantCharacter = characters.recoverAfterDefeat(participantId);
            }
            participantCharacter = characters.addExperience(participantId, 25);
            const reward = loot.rollEncounterLoot(applied.encounterId, applied.seed);
            await inventory.addItems(participantId, reward);
          } else {
            participantCharacter = characters.recoverAfterDefeat(participantId);
            world.resetPlayerToSpawn(participantId);
          }

          await persistGameplayState(participantId);
          const currentLocationId = world.getPlayerLocationId(participantId);
          const [inventorySnapshot, finalCharacter] = await Promise.all([
            inventory.getSnapshot(participantId),
            Promise.resolve(characters.getSnapshot(participantId))
          ]);
          if (!finalCharacter) continue;
          io.to(`player:${participantId}`).emit("battleEnded", {
            outcome: applied.victory ? "victory" : "defeat",
            inventory: inventorySnapshot,
            character: finalCharacter
          });
          if (currentLocationId) {
            affectedLocations.add(currentLocationId);
            io.in(`player:${participantId}`).socketsJoin(`location:${currentLocationId}`);
          }
        }

        battles.finishBattle(characterId);
        for (const affectedLocationId of affectedLocations) {
          io.to(`location:${affectedLocationId}`).emit(
            "worldState",
            world.snapshot(affectedLocationId)
          );
        }
      } catch (error) {
        reject(error, "BATTLE_REWARD_FAILED", "Battle rewards could not be persisted.");
      }
    });

    socket.on("disconnect", () => {
      const currentCharacterId = characterId;
      const currentLocationId = locationId;
      unregisterConnection?.();
      unregisterConnection = null;
      accountId = null;
      characterId = null;
      locationId = null;

      if (!currentCharacterId) return;
      void persistGameplayState(currentCharacterId).finally(() => {
        const departure = battles.removeBattleForPlayer(currentCharacterId);
        if (departure?.snapshot) {
          for (const remainingPlayerId of departure.playerIds) {
            io.to(`player:${remainingPlayerId}`).emit("battleState", departure.snapshot);
          }
        }
        emitPartyStates(parties.removePlayer(currentCharacterId));
        world.removePlayer(currentCharacterId);
        characters.removePlayer(currentCharacterId);
        if (currentLocationId) {
          io.to(`location:${currentLocationId}`).emit(
            "worldState",
            world.snapshot(currentLocationId)
          );
        }
      });
    });
  });

  return {
    io,
    services: { world, inventory, loot, battles, characters, parties, connections }
  };
}
