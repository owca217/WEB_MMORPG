import {
  getCharacterStatistics, getEquipmentCombatStatistics, getEquippedWeaponFamily,
  WORLD_HEAL_COOLDOWN_MS, WORLD_HEAL_RANGE,
  type CharacterSnapshot, type HealingFailure, type HealingRequest, type HealingResult, type HealingTargetsResult
} from "@web-mmorpg/shared";

export interface HealingServiceDependencies {
  getCharacter(id: string): CharacterSnapshot | undefined;
  isOnline(id: string): boolean;
  isBusy(id: string): boolean;
  isInBattle(id: string): boolean;
  getPartyMemberIds(id: string): readonly string[];
  getPosition(id: string): { locationId: string; x: number; y: number } | undefined;
  restoreHp(id: string, amount: number): number;
  persist(id: string): Promise<void>;
  push(id: string): Promise<void>;
}

const MESSAGES:Readonly<Record<string,string>>={
  INVALID_HEAL_REQUEST:"Nieprawidłowy cel lub identyfikator leczenia.",
  HEALING_STAFF_REQUIRED:"Załóż kostur leczący w zakładce Uzbrojenie.",
  PLAYER_OFFLINE:"Postać nie jest połączona z grą.",
  HEAL_CASTER_DOWN:"Nieprzytomna postać nie może leczyć.",
  HEAL_TARGET_DOWN:"Kostur nie wskrzesza pokonanej postaci.",
  HEAL_TARGET_NOT_IN_PARTY:"Możesz leczyć siebie lub członka swojej drużyny.",
  HEAL_ACTION_PENDING:"Poczekaj na zakończenie poprzedniej czynności.",
  HEAL_BATTLE_IN_PROGRESS:"Na mapie można leczyć postacie pozostające poza walką.",
  HEAL_OUT_OF_RANGE:"Podejdź bliżej do członka drużyny (zasięg 160).",
  HEAL_NO_EFFECT:"Ta postać ma pełne HP.",
  HEAL_COOLDOWN:"Kostur odzyskuje moc. Poczekaj przed kolejnym leczeniem.",
  HEAL_REQUEST_CONFLICT:"Ten identyfikator leczenia dotyczy innego celu.",
  HEAL_RATE_LIMITED:"Zbyt wiele prób leczenia. Poczekaj chwilę.",
  HEAL_SAVE_UNCERTAIN:"Leczenie wykonano, ale zapis nie został potwierdzony. Sprawdź wynik tej samej próby."
};
const failure=(code:string):HealingFailure=>({ok:false,code,message:MESSAGES[code]??MESSAGES.HEAL_ACTION_PENDING!});
const RECEIPT_TTL_MS=60_000;
const MAX_RECEIPTS=1024;
interface Receipt {
  casterId:string;
  request:HealingRequest;
  expiresAt:number;
  pending:boolean;
  retryNeeded:boolean;
  success?:Extract<HealingResult,{ok:true}>;
  promise:Promise<HealingResult>;
}

export class HealingService {
  private readonly pending=new Map<string,Promise<void>>();
  private readonly cooldowns=new Map<string,number>();
  private readonly receipts=new Map<string,Receipt>();
  constructor(private readonly deps: HealingServiceDependencies, private readonly now: () => number = Date.now) {}

  getTargets(casterId: string): HealingTargetsResult {
    this.prune();
    const unavailable=this.casterFailure(casterId);
    if(unavailable)return unavailable;
    const caster=this.deps.getCharacter(casterId)!;
    const cooldownMs=this.cooldown(casterId);
    const ids=[...new Set([casterId,...this.deps.getPartyMemberIds(casterId)])];
    return {ok:true,healingPower:this.power(caster),cooldownMs,targets:ids.flatMap(id=>{
      const character=this.deps.getCharacter(id);
      if(!character || !this.deps.isOnline(id))return [];
      const problem=this.targetFailure(casterId,id)??(cooldownMs>0 ? failure("HEAL_COOLDOWN") : undefined);
      return [{id,nickname:character.nickname,hp:character.hp,maxHp:character.maxHp,available:!problem,...(problem ? {reason:problem.message} : {})}];
    })};
  }

  cast(casterId: string, payload: unknown): Promise<HealingResult> {
    this.prune();
    if(!this.isRequest(payload))return Promise.resolve(failure("INVALID_HEAL_REQUEST"));
    if(!this.deps.isOnline(casterId))return Promise.resolve(failure("PLAYER_OFFLINE"));
    const key=JSON.stringify([casterId,payload.requestId]);
    const previous=this.receipts.get(key);
    if(previous) {
      if(previous.request.targetId!==payload.targetId)return Promise.resolve(failure("HEAL_REQUEST_CONFLICT"));
      if(previous.pending || !previous.retryNeeded)return previous.promise;
      // A failed persistence retry repeats saves, never HP restoration.
      if(!this.deps.isOnline(previous.request.targetId))return Promise.resolve(failure("HEAL_SAVE_UNCERTAIN"));
      if(this.unavailable(casterId) || this.unavailable(previous.request.targetId))return Promise.resolve(failure("HEAL_ACTION_PENDING"));
      return this.begin(previous,false);
    }
    const casterProblem=this.casterFailure(casterId);
    if(casterProblem)return Promise.resolve(casterProblem);
    const targetProblem=this.targetFailure(casterId,payload.targetId);
    if(targetProblem)return Promise.resolve(targetProblem);
    if(this.cooldown(casterId)>0)return Promise.resolve(failure("HEAL_COOLDOWN"));
    if(this.receipts.size>=MAX_RECEIPTS)return Promise.resolve(failure("HEAL_RATE_LIMITED"));
    const receipt:Receipt={casterId,request:{requestId:payload.requestId,targetId:payload.targetId},expiresAt:this.now()+RECEIPT_TTL_MS,pending:false,retryNeeded:false,promise:Promise.resolve(failure("HEAL_ACTION_PENDING"))};
    this.receipts.set(key,receipt);
    return this.begin(receipt,true);
  }

  pendingFor(id: string): Promise<void> | undefined { return this.pending.get(id); }

  private begin(receipt:Receipt,apply:boolean):Promise<HealingResult> {
    const ids=[...new Set([receipt.casterId,receipt.request.targetId])];
    let finish!:()=>void;
    const completed=new Promise<void>(resolve=>{finish=resolve;});
    for(const id of ids)this.pending.set(id,completed);
    receipt.pending=true;
    receipt.expiresAt=this.now()+RECEIPT_TTL_MS;
    receipt.promise=this.perform(receipt,ids,apply).finally(()=>{
      receipt.pending=false;
      for(const id of ids)if(this.pending.get(id)===completed)this.pending.delete(id);
      finish();
    }).then(result=>{
      if(result.ok)for(const id of ids)void Promise.resolve().then(()=>this.deps.push(id)).catch(()=>undefined);
      return result;
    });
    return receipt.promise;
  }

  private async perform(receipt:Receipt,ids:string[],apply:boolean):Promise<HealingResult> {
    try {
      if(apply) {
        const caster=this.deps.getCharacter(receipt.casterId)!;
        const restoredHp=this.deps.restoreHp(receipt.request.targetId,this.power(caster));
        if(!Number.isFinite(restoredHp) || restoredHp<=0)return failure("HEAL_NO_EFFECT");
        receipt.success={ok:true,...receipt.request,restoredHp,cooldownMs:WORLD_HEAL_COOLDOWN_MS};
        this.cooldowns.set(receipt.casterId,this.now()+WORLD_HEAL_COOLDOWN_MS);
      }
      const saved=await Promise.allSettled(ids.map(id=>Promise.resolve().then(()=>this.deps.persist(id))));
      if(saved.some(result=>result.status==="rejected"))throw new Error("HEAL_SAVE_FAILED");
      receipt.retryNeeded=false;
      return receipt.success ? {...receipt.success,cooldownMs:this.cooldown(receipt.casterId)} : failure("HEAL_NO_EFFECT");
    }catch {
      receipt.retryNeeded=Boolean(receipt.success);
      return failure("HEAL_SAVE_UNCERTAIN");
    }
  }

  private casterFailure(id:string):HealingFailure|undefined {
    const character=this.deps.getCharacter(id);
    if(!character || !this.deps.isOnline(id))return failure("PLAYER_OFFLINE");
    if(character.hp<=0)return failure("HEAL_CASTER_DOWN");
    if(getEquippedWeaponFamily(character.equipment)!=="staff")return failure("HEALING_STAFF_REQUIRED");
    if(this.unavailable(id))return failure("HEAL_ACTION_PENDING");
    if(this.deps.isInBattle(id))return failure("HEAL_BATTLE_IN_PROGRESS");
    return undefined;
  }

  private targetFailure(casterId:string,id:string):HealingFailure|undefined {
    if(id!==casterId && !this.deps.getPartyMemberIds(casterId).includes(id))return failure("HEAL_TARGET_NOT_IN_PARTY");
    const target=this.deps.getCharacter(id);
    if(!target || !this.deps.isOnline(id))return failure("PLAYER_OFFLINE");
    if(this.unavailable(id))return failure("HEAL_ACTION_PENDING");
    if(this.deps.isInBattle(id))return failure("HEAL_BATTLE_IN_PROGRESS");
    const origin=this.deps.getPosition(casterId),position=this.deps.getPosition(id);
    if(!origin || !position || origin.locationId!==position.locationId ||
      ![origin.x,origin.y,position.x,position.y].every(Number.isFinite) ||
      Math.hypot(origin.x-position.x,origin.y-position.y)>WORLD_HEAL_RANGE)return failure("HEAL_OUT_OF_RANGE");
    if(target.hp<=0)return failure("HEAL_TARGET_DOWN");
    if(target.hp>=target.maxHp)return failure("HEAL_NO_EFFECT");
    return undefined;
  }

  private power(character:CharacterSnapshot):number {
    return getEquipmentCombatStatistics(getCharacterStatistics(character.level),character.weaponTraining,character.equipment).healingPower??0;
  }
  private unavailable(id:string):boolean {return this.pending.has(id)||this.deps.isBusy(id);}
  private cooldown(id:string):number {return Math.max(0,(this.cooldowns.get(id)??0)-this.now());}
  private isRequest(value:unknown):value is HealingRequest {
    if(!value || typeof value!=="object" || Array.isArray(value))return false;
    const request=value as Record<string,unknown>;
    return typeof request.requestId==="string" && request.requestId.length>0 && request.requestId.length<=80 && request.requestId.trim()===request.requestId
      && typeof request.targetId==="string" && request.targetId.length>0 && request.targetId.length<=64 && request.targetId.trim()===request.targetId;
  }
  private prune():void {
    const now=this.now();
    for(const [key,receipt] of this.receipts)if(!receipt.pending && receipt.expiresAt<=now)this.receipts.delete(key);
    for(const [id,until] of this.cooldowns)if(until<=now)this.cooldowns.delete(id);
  }
}
