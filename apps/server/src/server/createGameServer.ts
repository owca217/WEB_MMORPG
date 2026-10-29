import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
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
import { BattleService, type AppliedBattleCommand } from "../battle/BattleService";
import { ChatService } from "../chat/ChatService";
import type { CharacterLifecycleService } from "../character/CharacterLifecycleService";
import { CharacterService } from "../character/CharacterService";
import { InventoryService } from "../inventory/InventoryService";
import { LootService } from "../loot/LootService";
import { WorldService } from "../world/WorldService";
import { ActiveConnectionRegistry } from "./ActiveConnectionRegistry";
import { SocialService } from "../social/SocialService";
import type { PartyExperienceContext } from "../social/PartyService";
import { socialFailure } from "../social/socialErrors";
import { MerchantService } from "../merchant/MerchantService";

export interface GameServerOptions {
  pool: Pool;
  authService: AuthService;
  characterLifecycle: CharacterLifecycleService;
  connections?: ActiveConnectionRegistry;
  autoBattleStepMs?: number;
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
  AUTO_BATTLE_ACTIVE: "Najpierw przejmij sterowanie w panelu walki.",
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
const MERCHANT_ERRORS: Readonly<Record<string,string>> = {
  AUTHENTICATION_REQUIRED: "Zaloguj się, aby korzystać ze sklepu.",
  SESSION_REPLACED: "Połączenie zmieniło się. Otwórz sklep ponownie.",
  NPC_NOT_FOUND: "Nie znaleziono tego kupca w tej lokacji.",
  NPC_NOT_MERCHANT: "Ta postać nie prowadzi sklepu.",
  NPC_OUT_OF_RANGE: "Podejdź bliżej do kupca.",
  BATTLE_IN_PROGRESS: "Sklep jest niedostępny podczas walki.",
  MERCHANT_ACTION_PENDING: "Poczekaj na zakończenie zakupu.",
  MERCHANT_REQUEST_UNCERTAIN: "Zakup mógł zostać zapisany. Ponów sprawdzenie tego samego zakupu bez dodatkowej opłaty.",
  SOCIAL_ACTION_PENDING: "Poczekaj na zakończenie wymiany.",
  MERCHANT_RATE_LIMITED: "Zbyt wiele żądań sklepu. Poczekaj chwilę.",
  MERCHANT_INVALID_PURCHASE: "Nieprawidłowy zakup.",
  MERCHANT_INVALID_QUANTITY: "Wybierz dozwoloną liczbę sztuk.",
  MERCHANT_REQUEST_CONFLICT: "Ten identyfikator zakupu dotyczy innej oferty.",
  MERCHANT_ITEM_UNAVAILABLE: "Ten towar jest już niedostępny.",
  MERCHANT_LEVEL_REQUIRED: "Masz za niski poziom na ten przedmiot.",
  MERCHANT_INSUFFICIENT_GOLD: "Masz za mało złota.",
  MERCHANT_UNIQUE_ITEM_EXISTS: "Posiadasz już ten unikatowy przedmiot.",
  CHARACTER_NOT_FOUND: "Postać jest niedostępna."
};
function merchantFailure(error: unknown): {ok:false;code:string;message:string} {
  const code=error instanceof Error && MERCHANT_ERRORS[error.message] ? error.message : "MERCHANT_FAILED";
  return {ok:false,code,message:MERCHANT_ERRORS[code]??"Nie udało się wykonać zakupu. Spróbuj ponownie."};
}

export function createGameServer(
  httpServer: HttpServer,
  options: GameServerOptions
) {
  const world = new WorldService();
  const inventory = new InventoryService(options.pool);
  const merchant = new MerchantService(options.pool);
  const loot = new LootService();
  const battles = new BattleService();
  const chat = new ChatService(world, (playerId) => battles.hasBattle(playerId));
  const characters = new CharacterService();
  const connections = options.connections ?? new ActiveConnectionRegistry();
  const characterOwners = new Map<PlayerId, string>();
  const pendingCharacterSaves = new Map<PlayerId, Promise<void>>();
  const pendingBattleItemUses = new Map<PlayerId, Promise<void>>();
  const pendingMerchantOperations = new Map<PlayerId, Promise<void>>();
  const pendingBattleRewards = new Map<PlayerId, Promise<void>>();
  const battleRewardTokens = new Map<PlayerId,string>();
  const autoStepMs=Number.isFinite(options.autoBattleStepMs) ? Math.max(10,Math.min(2000,options.autoBattleStepMs!)) : 300;
  const autoStops=new Set<()=>void>();
  httpServer.once("close",()=>{for(const stop of autoStops)stop();autoStops.clear();});
  const pendingAccountCleanup = new Map<string, Promise<void>>();
  const pendingAccountAuthentication = new Map<string, Promise<void>>();
  const partyExperienceContexts = new Map<PlayerId,PartyExperienceContext|null>();

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
  const social = new SocialService(options.pool, id => {
    const owner=characterOwners.get(id);
    const character=characters.getSnapshot(id);
    if(!owner || !io.sockets.sockets.get(owner)?.connected || !character)return undefined;
    return {id,nickname:character.nickname,level:character.level,online:true,inBattle:battles.hasBattle(id)};
  }, id=>{
    const player=world.getPlayer(id);const locationId=world.getPlayerLocationId(id);
    return player && locationId ? {locationId,x:player.x,y:player.y} : undefined;
  },()=>[...characterOwners.keys()]);
  let socialDirty=false;
  let socialBroadcast:Promise<void>|null=null;
  const broadcastSocial = ():Promise<void> => {
    socialDirty=true;
    if(socialBroadcast)return socialBroadcast;
    socialBroadcast=(async()=>{
      while(socialDirty) {
        socialDirty=false;
        await Promise.allSettled([...characterOwners].map(async([id,owner])=>{
          const target=io.sockets.sockets.get(owner);
          if(!target?.connected)return;
          const snapshot=await social.getSnapshot(id);
          if(target.connected && characterOwners.get(id)===owner)target.emit("socialState",snapshot);
        }));
      }
    })().finally(()=>{socialBroadcast=null;});
    return socialBroadcast;
  };

  io.on("connection", (socket) => {
    let characterId: PlayerId | null = null;
    let accountId: string | null = null;
    let locationId: LocationId | null = null;
    let unregisterConnection: (() => void) | null = null;
    let socketAuthentication = Promise.resolve();
    let characterVersion = 0;
    let autoTimer:ReturnType<typeof setTimeout>|undefined;
    let autoGeneration=0;
    let autoStalls=0;
    const stopAuto=():void=>{
      autoGeneration+=1;
      if(autoTimer!==undefined)clearTimeout(autoTimer);
      autoTimer=undefined;
    };
    autoStops.add(stopAuto);

    const ownsCharacter = (target: PlayerId, version: number): boolean =>
      socket.connected && characterId === target && characterVersion === version &&
      characterOwners.get(target) === socket.id;

    const emitPlayerState = async (targetCharacterId: PlayerId): Promise<void> => {
      const character = characters.getSnapshot(targetCharacterId);
      if (!character) return;
      const version=characterVersion;
      const [items,gold]=await Promise.all([inventory.getSnapshot(targetCharacterId),merchant.getGold(targetCharacterId)]);
      if(!ownsCharacter(targetCharacterId,version))return;
      socket.emit("playerState", {
        character,
        inventory: items,
        gold
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
      stopAuto();
      const releasedCharacterId = characterId;
      const releasedAccountId = accountId;
      const releasedLocationId = locationId;
      const pendingItemUse = releasedCharacterId ? pendingBattleItemUses.get(releasedCharacterId) : undefined;
      const pendingPurchase = releasedCharacterId ? pendingMerchantOperations.get(releasedCharacterId) : undefined;
      const pendingReward = releasedCharacterId ? pendingBattleRewards.get(releasedCharacterId) : undefined;
      const socialCleanup = releasedCharacterId && characterOwners.get(releasedCharacterId)===socket.id
        ? social.removeDisconnected(releasedCharacterId) : Promise.resolve();
      const save = releasedCharacterId
        ? Promise.allSettled([pendingItemUse,pendingPurchase,pendingReward,socialCleanup]).then(()=>persistGameplayState(releasedCharacterId))
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
        partyExperienceContexts.delete(releasedCharacterId);
        battleRewardTokens.delete(releasedCharacterId);
        battles.removeBattleForPlayer(releasedCharacterId);
        world.removePlayer(releasedCharacterId);
        characters.removePlayer(releasedCharacterId);
        void broadcastSocial();
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
      if(npcId==="merchant-miro")return {npcId,npcName:"Miro",kind:"merchant",title:"Zaopatrzenie podróżnika",lines:["Bandaże, mikstury i worki na drogę."],canHeal:false};
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
          social.markChanged();
          void broadcastSocial();
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

    let socialRead:Promise<import("@web-mmorpg/shared").SocialSnapshot>|null=null;
    let socialReadAt=0;
    let socialReadOwner:string|null=null;
    let socialReadVersion=-1;
    const socialActionTimes:number[]=[];
    socket.on("requestSocialState",async ack=>{
      if(typeof ack!=="function")return;
      const id=characterId,version=characterVersion;
      if(!id || !ownsCharacter(id,version)){ack(socialFailure(new Error("AUTHENTICATION_REQUIRED")));return;}
      try {
        if(!socialRead || socialReadOwner!==id || socialReadVersion!==version || Date.now()-socialReadAt>500) {
          socialReadAt=Date.now();socialReadOwner=id;socialReadVersion=version;socialRead=social.getSnapshot(id);
        }
        const snapshot=await socialRead;
        if(!ownsCharacter(id,version))throw new Error("SESSION_REPLACED");
        ack({ok:true,social:snapshot});
      }catch(error){socialRead=null;ack(socialFailure(error));}
    });
    socket.on("socialAction",async(payload,ack)=>{
      if(typeof ack!=="function")return;
      const id=characterId,version=characterVersion;
      if(!id || !ownsCharacter(id,version)){ack(socialFailure(new Error("AUTHENTICATION_REQUIRED")));return;}
      const now=Date.now();while(socialActionTimes[0]!==undefined && now-socialActionTimes[0]>=10000)socialActionTimes.shift();
      if(pendingMerchantOperations.has(id)){ack({ok:false,code:"MERCHANT_ACTION_PENDING",message:MERCHANT_ERRORS.MERCHANT_ACTION_PENDING!});return;}
      if(socialActionTimes.length>=20){ack(socialFailure(new Error("SOCIAL_RATE_LIMITED")));return;}
      socialActionTimes.push(now);
      try {
        const completedTrade=await social.execute(id,payload);socialRead=null;
        const trade=completedTrade??social.trades.getSnapshot(id);
        let updatedInventory:import("@web-mmorpg/shared").InventorySnapshot|undefined;
        if(payload.type==="confirmTrade" && trade?.status==="completed") {
          for(const participant of trade.participants) {
            const owner=characterOwners.get(participant.player.id);
            const target=owner ? io.sockets.sockets.get(owner) : undefined;
            const character=characters.getSnapshot(participant.player.id);
            if(!target?.connected || !character)continue;
            const items=await inventory.getSnapshot(participant.player.id);
            if(participant.player.id===id)updatedInventory=items;
            const gold=await merchant.getGold(participant.player.id);
            if(characterOwners.get(participant.player.id)===owner)target.emit("playerState",{character,inventory:items,gold});
          }
        }
        const snapshot=await social.getSnapshot(id);
        if(!ownsCharacter(id,version))throw new Error("SESSION_REPLACED");
        ack({ok:true,social:snapshot,...(updatedInventory ? {inventory:updatedInventory} : {})});
        void broadcastSocial();
      }catch(error){social.markChanged();socialRead=null;ack(socialFailure(error));void broadcastSocial();}
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
      if (!characterId || battles.hasBattle(characterId) || social.isBusy(characterId) || pendingMerchantOperations.has(characterId)) return;
      const currentCharacterId = characterId;
      const currentLocationId = locationId;
      if (!currentLocationId) return;

      try {
        world.movePlayer(currentCharacterId, intent);
        void social.checkDistance(currentCharacterId).then(changed=>{if(changed)void broadcastSocial();});
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

    const merchantRequestTimes:number[]=[];
    const assertMerchant = (id:PlayerId,version:number,npcId:unknown):void => {
      if(!ownsCharacter(id,version))throw new Error("SESSION_REPLACED");
      if(battles.hasBattle(id))throw new Error("BATTLE_IN_PROGRESS");
      if(social.isBusy(id))throw new Error("SOCIAL_ACTION_PENDING");
      if(typeof npcId!=="string")throw new Error("NPC_NOT_FOUND");
      const npc=world.interactNpc(id,npcId);
      if(npc.kind!=="merchant")throw new Error("NPC_NOT_MERCHANT");
    };
    const checkMerchantRate = ():void => {
      const now=Date.now();
      while(merchantRequestTimes[0]!==undefined && now-merchantRequestTimes[0]>=10000)merchantRequestTimes.shift();
      if(merchantRequestTimes.length>=30)throw new Error("MERCHANT_RATE_LIMITED");
      merchantRequestTimes.push(now);
    };
    socket.on("requestMerchantShop",async(payload,ack)=>{
      if(typeof ack!=="function")return;
      const id=characterId,version=characterVersion;
      if(!id || !ownsCharacter(id,version)){ack(merchantFailure(new Error("AUTHENTICATION_REQUIRED")));return;}
      try {
        checkMerchantRate();assertMerchant(id,version,payload?.npcId);
        if(pendingMerchantOperations.has(id))throw new Error("MERCHANT_ACTION_PENDING");
        const shop=await merchant.getShop(id);
        assertMerchant(id,version,payload.npcId);
        ack({ok:true,shop});
      }catch(error){ack(merchantFailure(error));}
    });
    socket.on("purchaseMerchantItem",(payload,ack)=>{
      if(typeof ack!=="function")return;
      const id=characterId,version=characterVersion;
      if(!id || !ownsCharacter(id,version)){ack(merchantFailure(new Error("AUTHENTICATION_REQUIRED")));return;}
      try {
        checkMerchantRate();assertMerchant(id,version,payload?.npcId);
        if(pendingMerchantOperations.has(id))throw new Error("MERCHANT_ACTION_PENDING");
      }catch(error){ack(merchantFailure(error));return;}
      const operation=(async()=>{
        try {
          const result=await merchant.purchase(id,payload,()=>assertMerchant(id,version,payload.npcId));
          if(!ownsCharacter(id,version))throw new Error("SESSION_REPLACED");
          const character=characters.getSnapshot(id);
          if(!character)throw new Error("CHARACTER_NOT_FOUND");
          socket.emit("playerState",{character,inventory:result.inventory,gold:result.shop.gold});
          ack({ok:true,...result});
        }catch(error){ack(merchantFailure(error));}
      })();
      pendingMerchantOperations.set(id,operation);
      void operation.finally(()=>{if(pendingMerchantOperations.get(id)===operation)pendingMerchantOperations.delete(id);});
    });

    socket.on("interactNpc", ({ npcId }) => {
      if (!characterId) return;

      try {
        if(battles.hasBattle(characterId))throw new Error("BATTLE_IN_PROGRESS");
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
        await emitPlayerState(currentCharacterId);
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
        await emitPlayerState(currentCharacterId);
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
        await emitPlayerState(currentCharacterId);
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

    socket.on("startEncounter", async (payload) => {
      if (!characterId) return;
      const currentCharacterId = characterId;
      const currentLocationId = locationId;
      const currentCharacterVersion = characterVersion;
      const character = characters.getSnapshot(currentCharacterId);
      if (!currentLocationId || !character) return;

      try {
        const encounterId=payload?.encounterId;
        const mode=payload?.mode===undefined ? "manual" : payload.mode;
        if(mode!=="manual" && mode!=="auto")throw new Error("INVALID_BATTLE_MODE");
        if(typeof encounterId!=="string")throw new Error("ENCOUNTER_NOT_FOUND");
        if(pendingMerchantOperations.has(currentCharacterId))throw new Error("MERCHANT_ACTION_PENDING");
        await social.cancelForBattle(currentCharacterId);
        if(!ownsCharacter(currentCharacterId,currentCharacterVersion))return;
        if(pendingMerchantOperations.has(currentCharacterId))throw new Error("MERCHANT_ACTION_PENDING");
        if (battles.hasBattle(currentCharacterId)) throw new Error("BATTLE_ALREADY_STARTED");
        world.startEncounter(currentCharacterId, encounterId);
        let snapshot = battles.startBattle(character, encounterId);
        stopAuto();autoStalls=0;
        if(mode==="auto")snapshot=battles.setAuto(currentCharacterId,true);
        battleRewardTokens.set(currentCharacterId,randomUUID());
        partyExperienceContexts.set(currentCharacterId,social.parties.captureExperienceContext(currentCharacterId));
        social.markChanged();void broadcastSocial();
        socket.leave(`location:${currentLocationId}`);
        socket.emit("battleStarted", snapshot);
        if(mode==="auto")scheduleAuto(currentCharacterId,currentCharacterVersion);
      } catch (error) {
        reject(error, "ENCOUNTER_REJECTED", "Encounter could not be started.");
      }
    });

    const finishBattleCommand=async(currentCharacterId:PlayerId,currentCharacterVersion:number,applied:AppliedBattleCommand):Promise<void>=>{
      if (!applied.result.ok) {
        socket.emit("commandRejected", {
          code: applied.result.code,
          message: applied.result.code==="AUTO_BATTLE_ACTIVE" ? "Najpierw przejmij sterowanie w panelu walki." : applied.result.message
        });
        return;
      }

      if (!applied.snapshot) return;
      socket.emit("battleState", applied.snapshot);

      if (!applied.finished) return;
      stopAuto();

      let finishMutations!:()=>void;
      const mutationsDone=new Promise<void>(resolve=>{finishMutations=resolve;});
      pendingBattleRewards.set(currentCharacterId,mutationsDone);
      const releaseMutations=():void=>{
        finishMutations();
        if(pendingBattleRewards.get(currentCharacterId)===mutationsDone)pendingBattleRewards.delete(currentCharacterId);
      };
      const settlement=(async()=>{
      try {
        const beforeReward = characters.getSnapshot(currentCharacterId);
        let experienceGained = 0;
        let levelsGained = 0;
        let partyBonusExperience = 0;
        let goldGained = 0;
        if (applied.playerOutcome) {
          characters.applyBattleResult(currentCharacterId, applied.playerOutcome);
        }

        if (applied.victory && applied.encounterId && applied.seed !== undefined) {
          // Disconnect saves must include earned XP even while loot persistence is pending.
          const baseExperience=applied.experienceReward??0;
          const bonusPercent=social.parties.getExperienceBonus(currentCharacterId,partyExperienceContexts.get(currentCharacterId));
          partyBonusExperience=Math.floor(baseExperience*bonusPercent/100);
          const progressed = characters.awardExperience(currentCharacterId, baseExperience+partyBonusExperience);
          experienceGained = (progressed.experience ?? 0) - (beforeReward?.experience ?? 0);
          levelsGained = progressed.level - (beforeReward?.level ?? progressed.level);
          const reward = loot.rollEncounterLoot(applied.encounterId, applied.seed);
          await inventory.addItems(currentCharacterId, reward);
          const rewardToken=battleRewardTokens.get(currentCharacterId);
          if(applied.encounterId==="wolf-pack-01" && rewardToken) {
            await merchant.rewardVictory(currentCharacterId,rewardToken,15);
            goldGained=15;
          }
        } else {
          characters.recoverAfterDefeat(currentCharacterId);
          world.resetPlayerToSpawn(currentCharacterId);
          locationId = world.getPlayerLocationId(currentCharacterId) ?? locationId;
        }

        await persistGameplayState(currentCharacterId);
        // Re-authentication waits for durable mutations, never for old presentation reads.
        releaseMutations();
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
          levelsGained,
          goldGained,
          ...(partyBonusExperience ? {partyBonusExperience} : {})
        });

        battles.removeBattleForPlayer(currentCharacterId);
        partyExperienceContexts.delete(currentCharacterId);
        battleRewardTokens.delete(currentCharacterId);
        social.markChanged();void broadcastSocial();
        socket.join(`location:${currentLocationId}`);
        io.to(`location:${currentLocationId}`).emit(
          "worldState",
          world.snapshot(currentLocationId)
        );
      } catch (error) {
        reject(error, "BATTLE_REWARD_FAILED", "Battle rewards could not be persisted.");
      } finally {releaseMutations();}
      })();
      await settlement;
    };

    const scheduleAuto=(id:PlayerId,version:number):void=>{
      if(autoTimer!==undefined || !ownsCharacter(id,version) || !battles.isAuto(id) || battles.getSnapshot(id)?.finished)return;
      const generation=autoGeneration;
      autoTimer=setTimeout(()=>{
        autoTimer=undefined;
        if(generation!==autoGeneration || !ownsCharacter(id,version) || !battles.isAuto(id))return;
        if(pendingBattleItemUses.has(id) || pendingBattleRewards.has(id)){scheduleAuto(id,version);return;}
        void(async()=>{
          try {
            const before=battles.getSnapshot(id);
            const applied=battles.applyAutoCommand(id);
            if(!applied.result.ok)throw new Error(applied.result.code);
            const signature=(snapshot:typeof before)=>snapshot?.combatants.map(unit=>`${unit.id}:${unit.hp}:${unit.position.q},${unit.position.r}`).join(";");
            autoStalls=signature(before)===signature(applied.snapshot) ? autoStalls+1 : 0;
            await finishBattleCommand(id,version,applied);
            if(generation!==autoGeneration || !ownsCharacter(id,version) || !battles.isAuto(id))return;
            if(autoStalls>=40)throw new Error("AUTO_BATTLE_STALLED");
            scheduleAuto(id,version);
          }catch(error){
            stopAuto();
            if(!ownsCharacter(id,version))return;
            try{socket.emit("battleState",battles.setAuto(id,false));}catch{/* Battle already settled. */}
            const code=error instanceof Error && error.message==="AUTO_BATTLE_STALLED" ? error.message : "AUTO_BATTLE_FAILED";
            socket.emit("commandRejected",{code,message:"Automat zatrzymał się. Możesz kontynuować walkę ręcznie."});
          }
        })();
      },autoStepMs);
      autoTimer.unref();
    };

    const autoModeRequests:number[]=[];
    socket.on("setBattleAuto",(payload,ack)=>{
      if(typeof ack!=="function")return;
      const id=characterId,version=characterVersion;
      if(!id || !ownsCharacter(id,version)){ack({ok:false,code:"AUTHENTICATION_REQUIRED",message:"Zaloguj się, aby zmienić tryb walki."});return;}
      if(!payload || typeof payload.enabled!=="boolean"){ack({ok:false,code:"INVALID_BATTLE_MODE",message:"Wybierz poprawny tryb walki."});return;}
      const now=Date.now();while(autoModeRequests[0]!==undefined && now-autoModeRequests[0]>=10000)autoModeRequests.shift();
      if(autoModeRequests.length>=20){ack({ok:false,code:"AUTO_RATE_LIMITED",message:"Poczekaj chwilę przed kolejną zmianą trybu."});return;}
      autoModeRequests.push(now);
      try {
        if(pendingBattleItemUses.has(id) || pendingBattleRewards.has(id))throw new Error("BATTLE_ACTION_PENDING");
        const snapshot=battles.setAuto(id,payload.enabled);
        stopAuto();autoStalls=0;
        socket.emit("battleState",snapshot);ack({ok:true,snapshot});
        if(payload.enabled)scheduleAuto(id,version);
      }catch(error){
        const code=error instanceof Error && ["BATTLE_NOT_FOUND","BATTLE_FINISHED","BATTLE_ACTION_PENDING"].includes(error.message) ? error.message : "AUTO_MODE_FAILED";
        ack({ok:false,code,message:"Nie można teraz zmienić trybu walki."});
      }
    });

    socket.on("battleCommand",async(command)=>{
      if(!characterId || !ownsCharacter(characterId,characterVersion))return;
      const id=characterId,version=characterVersion;
      if(pendingBattleItemUses.has(id) || pendingBattleRewards.has(id)) {
        socket.emit("commandRejected",{code:"BATTLE_ACTION_PENDING",message:BATTLE_ITEM_ERRORS.BATTLE_ACTION_PENDING!});return;
      }
      await finishBattleCommand(id,version,battles.applyCommand(id,command));
    });

    socket.on("disconnect", () => {
      autoStops.delete(stopAuto);
      void releaseCharacter().catch((error) =>
        reject(error, "CHARACTER_SAVE_FAILED", "Character state could not be persisted.")
      );
    });
  });

  return {
    io,
    services: { world, inventory, loot, battles, characters, connections, chat, social, merchant }
  };
}
