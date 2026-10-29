import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { isWeaponLoadout } from "@web-mmorpg/shared";
import type {
  ClientToServerEvents,
  LocationId,
  NpcInteractionPayload,
  PlayerId,
  BattleSnapshot,
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
import { HealingService } from "../healing/HealingService";

export interface GameServerOptions {
  pool: Pool;
  authService: AuthService;
  characterLifecycle: CharacterLifecycleService;
  connections?: ActiveConnectionRegistry;
  autoBattleStepMs?: number;
}

type BattleEndedPayload=Parameters<ServerToClientEvents["battleEnded"]>[0];
interface OwnerStateOperations {
  owner:string;
  isCurrent:()=>boolean;
  persist:()=>Promise<void>;
  push:()=>Promise<void>;
  enterBattle:(snapshot:BattleSnapshot)=>void;
  battleState:(snapshot:BattleSnapshot)=>void;
  battleEnded:(payload:BattleEndedPayload)=>void;
  resumeWorld:()=>void;
  stopAuto:()=>void;
  scheduleAuto:()=>void;
  error:(code:string,message:string)=>void;
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
  const pendingWeaponSelections = new Map<PlayerId,Promise<void>>();
  const ownerStateOperations=new Map<PlayerId,OwnerStateOperations>();
  const pendingPartyStarts=new Map<PlayerId,symbol>();
  const battleSettlements=new Map<string,Promise<void>>();
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

  const healing=new HealingService({
    getCharacter:id=>characters.getSnapshot(id),
    isOnline:id=>{const owner=characterOwners.get(id);return Boolean(owner && io.sockets.sockets.get(owner)?.connected);},
    isBusy:id=>pendingPartyStarts.has(id)||pendingWeaponSelections.has(id)||pendingMerchantOperations.has(id)||pendingBattleRewards.has(id)||pendingBattleItemUses.has(id)||social.isBusy(id),
    isInBattle:id=>battles.hasBattle(id),
    getPartyMemberIds:id=>social.parties.getParty(id)?.members.map(member=>member.id)??[],
    getPosition:id=>{const player=world.getPlayer(id),locationId=world.getPlayerLocationId(id);return player && locationId ? {locationId,x:player.x,y:player.y} : undefined;},
    restoreHp:(id,amount)=>characters.restoreHp(id,amount),
    trainStaff:id=>{characters.trainWeapon(id,"staff",1);},
    persist:id=>ownerStateOperations.get(id)?.persist()??Promise.reject(new Error("HEAL_TARGET_UNAVAILABLE")),
    push:id=>ownerStateOperations.get(id)?.push()??Promise.resolve()
  });

  const broadcastBattle=(ids:readonly PlayerId[]):void=>{
    for(const id of ids){const snapshot=battles.getSnapshot(id);if(snapshot)ownerStateOperations.get(id)?.battleState(snapshot);}
  };
  const scheduleActive=(ids:readonly PlayerId[]):void=>{
    const first=ids.find(id=>battles.hasBattle(id));
    const active=first ? battles.getActivePlayerId(first) : undefined;
    if(active)ownerStateOperations.get(active)?.scheduleAuto();
  };
  const settleBattle=(ids:PlayerId[],applied:AppliedBattleCommand):Promise<void>=>{
    const battleId=applied.snapshot!.id;
    const rewardToken=ids.map(id=>battleRewardTokens.get(id)).find(Boolean)??battleId;
    const existing=battleSettlements.get(rewardToken);
    if(existing)return existing;
    let release!:()=>void;
    const durable=new Promise<void>(resolve=>{release=resolve;});
    for(const id of ids){pendingBattleRewards.set(id,durable);ownerStateOperations.get(id)?.stopAuto();}
    const owners=new Map(ids.map(id=>[id,ownerStateOperations.get(id)]));
    const rewards=new Map<PlayerId,{experienceGained:number;levelsGained:number;partyBonusExperience:number;goldGained:number}>();
    const operation=Promise.resolve().then(async()=>{
      try {
        for(const id of ids) {
          const before=characters.getSnapshot(id);
          if(!before)continue;
          const outcome=applied.playerOutcomes?.[id]??(ids.length===1 ? applied.playerOutcome : undefined);
          if(outcome)characters.applyBattleResult(id,outcome);
          let experienceGained=0,levelsGained=0,partyBonusExperience=0;
          if(applied.victory) {
            const base=Math.floor((applied.experienceReward??0)/Math.max(1,applied.initialParticipantCount??ids.length));
            const context=partyExperienceContexts.get(id);
            const party=social.parties.getParty(id);
            const sharedBattle=(applied.initialParticipantCount??ids.length)>1;
            const bonus=sharedBattle
              ? party && context?.partyId===party.id
                ? Math.min(40,ids.filter(other=>other!==id && context.memberIds.includes(other) && party.members.some(member=>member.id===other && member.online)).length*10)
                : 0
              : social.parties.getExperienceBonus(id,context);
            partyBonusExperience=Math.floor(base*bonus/100);
            const progressed=characters.awardExperience(id,base+partyBonusExperience);
            experienceGained=(progressed.experience??0)-(before.experience??0);
            levelsGained=progressed.level-before.level;
          }
          if(!applied.victory || (outcome?.hp??before.hp)<=0) {
            characters.recoverAfterDefeat(id);world.resetPlayerToSpawn(id);
          }
          rewards.set(id,{experienceGained,levelsGained,partyBonusExperience,goldGained:0});
        }
        await Promise.all(ids.map(async id=>{
          const owner=owners.get(id);
          if(!owner)return;
          try {
            if(applied.victory && applied.encounterId && applied.seed!==undefined) {
              await inventory.addItems(id,loot.rollEncounterLoot(applied.encounterId,applied.seed));
              if(applied.encounterId==="wolf-pack-01") {
                await merchant.rewardVictory(id,rewardToken,15);
                const reward=rewards.get(id);if(reward)reward.goldGained=15;
              }
            }
          }catch{owner.error("BATTLE_REWARD_FAILED","Nie udało się zapisać wszystkich nagród za walkę.");}
          try{await owner.persist();}catch{owner.error("CHARACTER_SAVE_FAILED","Nie udało się zapisać wyniku walki.");}
        }));
      }finally {
        for(const id of ids) {
          if(battles.getSnapshot(id)?.id===battleId)battles.removeBattleForPlayer(id);
          partyExperienceContexts.delete(id);battleRewardTokens.delete(id);
          if(pendingBattleRewards.get(id)===durable)pendingBattleRewards.delete(id);
        }
        release();social.markChanged();void broadcastSocial();
      }
      // Presentation reads must not hold mutation locks or delay reconnects.
      for(const id of ids) {
        const owner=owners.get(id),reward=rewards.get(id);
        if(!owner || !reward)continue;
        void(async()=>{
          const items=await inventory.getSnapshot(id);
          if(ownerStateOperations.get(id)!==owner || !owner.isCurrent() || battles.hasBattle(id))return;
          await owner.push();
          if(ownerStateOperations.get(id)!==owner || !owner.isCurrent() || battles.hasBattle(id))return;
          const character=characters.getSnapshot(id);if(!character)return;
          owner.battleEnded({outcome:applied.victory?"victory":"defeat",inventory:items,character,...reward});
          owner.resumeWorld();
        })().catch(()=>owner.error("BATTLE_STATE_FAILED","Nie udało się odświeżyć wyniku walki. Połącz się ponownie."));
      }
    });
    battleSettlements.set(rewardToken,operation);
    void operation.finally(()=>{if(battleSettlements.get(rewardToken)===operation)battleSettlements.delete(rewardToken);}).catch(()=>undefined);
    return operation;
  };
  const dispatchBattle=async(actorId:PlayerId,applied:AppliedBattleCommand):Promise<void>=>{
    if(!applied.result.ok) {
      ownerStateOperations.get(actorId)?.error(applied.result.code,applied.result.code==="AUTO_BATTLE_ACTIVE"?"Najpierw przejmij sterowanie w panelu walki.":applied.result.message);
      return;
    }
    if(!applied.snapshot)return;
    const ids=applied.participantIds??battles.getParticipantIds(actorId);
    const claim=ids.map(id=>battleRewardTokens.get(id)).find(Boolean)??applied.snapshot.id;
    if(applied.finished && battleSettlements.has(claim)){await battleSettlements.get(claim);return;}
    const awards=applied.trainingAwards??{[actorId]:{...(applied.weaponTraining?{weaponTraining:applied.weaponTraining}:{}),...(applied.shieldTraining?{shieldTraining:applied.shieldTraining}:{})}};
    const trained:PlayerId[]=[];
    for(const [id,award] of Object.entries(awards)) {
      if(!characters.getSnapshot(id))continue;
      if(award.weaponTraining)characters.trainWeapon(id,award.weaponTraining.family,award.weaponTraining.amount);
      if(award.shieldTraining)characters.trainWeapon(id,"shield",award.shieldTraining);
      if(award.weaponTraining || award.shieldTraining)trained.push(id);
    }
    broadcastBattle(ids);
    if(applied.finished){await settleBattle(ids,applied);return;}
    await Promise.all(trained.map(async id=>{
      const owner=ownerStateOperations.get(id);if(!owner)return;
      try{await owner.persist();void owner.push().catch(()=>undefined);}catch{owner.error("WEAPON_SAVE_FAILED","Nie udało się zapisać treningu broni.");}
    }));
    scheduleActive(ids);
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
      const version=characterVersion;
      const [items,gold]=await Promise.all([inventory.getSnapshot(targetCharacterId),merchant.getGold(targetCharacterId)]);
      if(!ownsCharacter(targetCharacterId,version))return;
      const character = characters.getSnapshot(targetCharacterId);
      if (!character) return;
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
        ...(character.weaponTraining ? {weaponTraining:character.weaponTraining} : {}),
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
      const pendingWeapon = releasedCharacterId ? pendingWeaponSelections.get(releasedCharacterId) : undefined;
      const pendingHeal = releasedCharacterId ? healing.pendingFor(releasedCharacterId) : undefined;
      const socialCleanup = releasedCharacterId && characterOwners.get(releasedCharacterId)===socket.id
        ? social.removeDisconnected(releasedCharacterId) : Promise.resolve();
      const save = releasedCharacterId
        ? Promise.allSettled([pendingItemUse,pendingPurchase,pendingReward,pendingWeapon,pendingHeal,socialCleanup]).then(async()=>{
          if(characterOwners.get(releasedCharacterId)!==socket.id)return;
          // Item COMMIT installs a staged shared state; wait before removing any actor.
          while(true) {
            const items=battles.getParticipantIds(releasedCharacterId).map(id=>pendingBattleItemUses.get(id)).filter((item):item is Promise<void>=>Boolean(item));
            if(!items.length)break;
            await Promise.allSettled(items);
          }
          await pendingBattleRewards.get(releasedCharacterId);
          const detached=battles.detachPlayer(releasedCharacterId);
          if(detached.outcome) {
            characters.applyBattleResult(releasedCharacterId,detached.outcome);
            if(detached.outcome.hp<=0){characters.recoverAfterDefeat(releasedCharacterId);world.resetPlayerToSpawn(releasedCharacterId);}
          }
          const continuation=detached.applied ? dispatchBattle(releasedCharacterId,detached.applied) : Promise.resolve();
          await persistGameplayState(releasedCharacterId);
          await continuation;
        })
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
        if(ownerStateOperations.get(releasedCharacterId)?.owner===socket.id)ownerStateOperations.delete(releasedCharacterId);
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
            ...(persisted.weaponTraining ? {weaponTraining:persisted.weaponTraining} : {}),
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
          const registeredVersion=characterVersion;
          const current=()=>ownsCharacter(persisted.id,registeredVersion);
          ownerStateOperations.set(persisted.id,{
            owner:socket.id,isCurrent:current,persist:()=>persistGameplayState(persisted.id),push:()=>emitPlayerState(persisted.id),
            enterBattle:snapshot=>{if(!current())return;stopAuto();autoStalls=0;if(locationId)socket.leave(`location:${locationId}`);socket.emit("battleStarted",snapshot);},
            battleState:snapshot=>{if(current())socket.emit("battleState",snapshot);},
            battleEnded:payload=>{if(current())socket.emit("battleEnded",payload);},
            resumeWorld:()=>{if(!current())return;locationId=world.getPlayerLocationId(persisted.id)??locationId;if(locationId){socket.join(`location:${locationId}`);io.to(`location:${locationId}`).emit("worldState",world.snapshot(locationId));}},
            stopAuto,scheduleAuto:()=>scheduleAuto(persisted.id,registeredVersion),
            error:(code,message)=>{if(current())socket.emit("commandRejected",{code,message});}
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

    socket.on("requestHealingTargets",ack=>{
      if(typeof ack!=="function")return;
      const id=characterId;
      if(!id || !ownsCharacter(id,characterVersion)){ack({ok:false,code:"AUTHENTICATION_REQUIRED",message:"Zaloguj się, aby używać kostura."});return;}
      ack(healing.getTargets(id));
    });
    socket.on("castHealing",async(payload,ack)=>{
      if(typeof ack!=="function")return;
      const id=characterId,version=characterVersion;
      if(!id || !ownsCharacter(id,version)){ack({ok:false,code:"AUTHENTICATION_REQUIRED",message:"Zaloguj się, aby używać kostura."});return;}
      const result=await healing.cast(id,payload);
      if(!ownsCharacter(id,version)){ack({ok:false,code:"SESSION_REPLACED",message:"Połączenie zmieniło się. Otwórz leczenie ponownie."});return;}
      ack(result);
    });

    socket.on("setWeaponLoadout",async(payload,ack)=>{
      if(typeof ack!=="function")return;
      const id=characterId,version=characterVersion;
      const failure=(code:string,message:string)=>ack({ok:false,code,message});
      if(!id || !ownsCharacter(id,version)){failure("AUTHENTICATION_REQUIRED","Zaloguj się, aby wybrać styl broni.");return;}
      if(!isWeaponLoadout(payload)){failure("INVALID_WEAPON_LOADOUT","Wybierz poprawny styl wręcz i dystansowy.");return;}
      if(battles.hasBattle(id)){failure("BATTLE_IN_PROGRESS","Styl broni można zmienić poza walką.");return;}
      if(pendingPartyStarts.has(id) || pendingWeaponSelections.has(id) || pendingBattleRewards.has(id) || pendingMerchantOperations.has(id) || social.isBusy(id) || healing.pendingFor(id)) {
        failure("WEAPON_ACTION_PENDING","Poczekaj na zakończenie poprzedniej czynności.");return;
      }
      const previous=characters.getSnapshot(id)?.weaponTraining?.loadout;
      let finish!:()=>void;
      const pending=new Promise<void>(resolve=>{finish=resolve;});
      pendingWeaponSelections.set(id,pending);
      try {
        characters.setWeaponLoadout(id,payload);
        await persistGameplayState(id);
        if(!ownsCharacter(id,version)){failure("SESSION_REPLACED","Połączenie zmieniło się. Otwórz panel ponownie.");return;}
        finish();
        if(pendingWeaponSelections.get(id)===pending)pendingWeaponSelections.delete(id);
        ack({ok:true,character:characters.getSnapshot(id)!});
        void emitPlayerState(id).catch(error=>reject(error,"PLAYER_STATE_FAILED","Nie udało się odświeżyć panelu postaci."));
      }catch(error) {
        if(previous && ownsCharacter(id,version)) {
          characters.setWeaponLoadout(id,{...previous,support:previous.support??"none",defense:previous.defense??"none"});
          // A movement snapshot may already be queued with the unconfirmed selection.
          await persistGameplayState(id).catch(()=>undefined);
        }
        failure("WEAPON_SAVE_FAILED","Nie udało się zapisać stylu broni. Spróbuj ponownie.");
      }finally {
        finish();
        if(pendingWeaponSelections.get(id)===pending)pendingWeaponSelections.delete(id);
      }
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
      if(pendingPartyStarts.has(id) || (payload && typeof payload==="object" && "playerId" in payload && typeof payload.playerId==="string" && pendingPartyStarts.has(payload.playerId))){ack(socialFailure(new Error("SOCIAL_ACTION_PENDING")));return;}
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
        if(pendingPartyStarts.has(id))throw new Error("BATTLE_ACTION_PENDING");
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
        if(pendingPartyStarts.has(id))throw new Error("BATTLE_ACTION_PENDING");
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
      let finishMutation!:()=>void;
      const mutation=new Promise<void>(resolve=>{finishMutation=resolve;});
      pendingBattleItemUses.set(currentCharacterId,mutation);
      const releaseMutation=()=>{finishMutation();if(pendingBattleItemUses.get(currentCharacterId)===mutation)pendingBattleItemUses.delete(currentCharacterId);};
      void(async()=>{
        try {
          await pendingCharacterSaves.get(currentCharacterId);
          assertCurrent();
          const applied=await battles.useConsumable(currentCharacterId,payload.combatantId,prepare=>inventory.consumeBattleItem(currentCharacterId,payload.itemInstanceId,prepare,assertCurrent));
          if(characterOwners.get(currentCharacterId)===socket.id)characters.applyBattleResult(currentCharacterId,applied.playerOutcome);
          const ids=battles.getParticipantIds(currentCharacterId);
          broadcastBattle(ids);
          releaseMutation();
          scheduleActive(ids);
          if(!ownsCharacter(currentCharacterId,currentCharacterVersion)){ack({ok:false,code:"SESSION_REPLACED",message:BATTLE_ITEM_ERRORS.SESSION_REPLACED!});return;}
          ack({ok:true,inventory:applied.inventory});
          void emitPlayerState(currentCharacterId).catch(()=>undefined);
        }catch(error) {
          const code=error instanceof Error && BATTLE_ITEM_ERRORS[error.message] ? error.message : "BATTLE_ITEM_USE_FAILED";
          ack({ok:false,code,message:BATTLE_ITEM_ERRORS[code]??"Nie udało się użyć przedmiotu. Spróbuj ponownie."});
        }finally{releaseMutation();}
      })();
    });

    socket.on("startEncounter",async payload=>{
      const id=characterId,version=characterVersion,zone=locationId;
      if(!id || !zone || !ownsCharacter(id,version))return;
      const reservation=Symbol("party-start"),reserved:PlayerId[]=[];
      const busy=(target:PlayerId)=>battles.hasBattle(target)||pendingPartyStarts.has(target)||pendingBattleItemUses.has(target)||pendingBattleRewards.has(target)||pendingWeaponSelections.has(target)||pendingMerchantOperations.has(target)||Boolean(healing.pendingFor(target))||social.isBusy(target);
      try {
        const encounterId=payload?.encounterId,mode=payload?.mode??"manual";
        if(mode!=="manual" && mode!=="auto")throw new Error("INVALID_BATTLE_MODE");
        if(typeof encounterId!=="string")throw new Error("ENCOUNTER_NOT_FOUND");
        if(pendingWeaponSelections.has(id))throw new Error("WEAPON_ACTION_PENDING");
        if(busy(id))throw new Error("BATTLE_ACTION_PENDING");
        world.startEncounter(id,encounterId);
        const party=social.parties.getParty(id);
        const candidates=[...new Set([id,...(party?.members.map(member=>member.id)??[])])].slice(0,5);
        for(const target of candidates) {
          const owner=ownerStateOperations.get(target),character=characters.getSnapshot(target);
          if(!owner?.isCurrent() || !character || character.hp<=0 || world.getPlayerLocationId(target)!==zone)continue;
          if(busy(target)){if(target!==id)owner.error("PARTY_BATTLE_NOT_JOINED","Nie dołączono do walki drużyny: trwa inna walka lub czynność.");continue;}
          pendingPartyStarts.set(target,reservation);reserved.push(target);
        }
        if(!reserved.includes(id))throw new Error("BATTLE_ACTION_PENDING");
        for(const target of reserved)await social.cancelForBattle(target);
        if(!ownsCharacter(id,version))return;
        const currentParty=social.parties.getParty(id);
        const members=reserved.filter(target=>{
          const character=characters.getSnapshot(target),owner=ownerStateOperations.get(target);
          return pendingPartyStarts.get(target)===reservation && owner?.isCurrent() && character && character.hp>0 && world.getPlayerLocationId(target)===zone
            && !battles.hasBattle(target) && !pendingBattleRewards.has(target) && !pendingBattleItemUses.has(target) && !pendingWeaponSelections.has(target) && !pendingMerchantOperations.has(target) && !healing.pendingFor(target) && !social.isBusy(target)
            && (target===id || (party?.id===currentParty?.id && currentParty?.members.some(member=>member.id===target)));
        });
        if(!members.includes(id))throw new Error("BATTLE_ACTION_PENDING");
        world.startEncounter(id,encounterId);
        const ordered=[id,...members.filter(member=>member!==id)];
        battles.startPartyBattle(ordered.map(member=>characters.getSnapshot(member)!),encounterId);
        if(mode==="auto")battles.setAuto(id,true);
        const token=randomUUID();
        for(const member of ordered) {
          battleRewardTokens.set(member,token);
          partyExperienceContexts.set(member,social.parties.captureExperienceContext(member));
          const snapshot=battles.getSnapshot(member);if(snapshot)ownerStateOperations.get(member)?.enterBattle(snapshot);
        }
        social.markChanged();void broadcastSocial();scheduleActive(ordered);
      }catch(error){reject(error,"ENCOUNTER_REJECTED","Nie można rozpocząć walki drużyny.");}
      finally{for(const target of reserved)if(pendingPartyStarts.get(target)===reservation)pendingPartyStarts.delete(target);}
    });

    const finishBattleCommand=(id:PlayerId,_version:number,applied:AppliedBattleCommand):Promise<void>=>dispatchBattle(id,applied);

    const scheduleAuto=(id:PlayerId,version:number):void=>{
      if(autoTimer!==undefined || !ownsCharacter(id,version) || !battles.isAuto(id) || battles.getSnapshot(id)?.finished || battles.getActivePlayerId(id)!==id)return;
      const generation=autoGeneration;
      autoTimer=setTimeout(()=>{
        autoTimer=undefined;
        if(generation!==autoGeneration || !ownsCharacter(id,version) || !battles.isAuto(id) || battles.getActivePlayerId(id)!==id)return;
        if(pendingBattleItemUses.has(id) || pendingBattleRewards.has(id)){scheduleAuto(id,version);return;}
        void(async()=>{
          try {
            const before=battles.getSnapshot(id);
            const applied=battles.applyAutoCommand(id);
            if(!applied.result.ok)throw new Error(applied.result.code);
            const signature=(snapshot:typeof before)=>snapshot?.combatants.map(unit=>`${unit.id}:${unit.hp}:${unit.position.q},${unit.position.r}`).join(";");
            autoStalls=signature(before)===signature(applied.snapshot) ? autoStalls+1 : 0;
            await finishBattleCommand(id,version,applied);
            if(generation!==autoGeneration || !ownsCharacter(id,version) || !battles.isAuto(id) || battles.getActivePlayerId(id)!==id)return;
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
        broadcastBattle(battles.getParticipantIds(id));ack({ok:true,snapshot});
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
    services: { world, inventory, loot, battles, characters, connections, chat, social, merchant, healing }
  };
}
