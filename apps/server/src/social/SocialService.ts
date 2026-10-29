import type { SocialAction, SocialPlayer, SocialSnapshot, TradeSnapshot } from "@web-mmorpg/shared";
import type { Pool } from "pg";
import { FriendService } from "./FriendService";
import { PartyService } from "./PartyService";
import { TradeService } from "./TradeService";

interface Position { locationId: string; x: number; y: number; }
export class SocialService {
  readonly friends: FriendService;
  readonly parties: PartyService;
  readonly trades: TradeService;
  private revision = 0;
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(pool: Pool, private readonly getPlayer:(id:string)=>SocialPlayer|undefined,
    getPosition:(id:string)=>Position|undefined, private readonly onlineIds:()=>string[]) {
    this.friends=new FriendService(pool,getPlayer);
    this.parties=new PartyService(getPlayer,getPosition);
    this.trades=new TradeService(pool,getPlayer,getPosition);
  }
  markChanged():void {this.revision++;}
  async getSnapshot(actorId:string):Promise<SocialSnapshot> {
    const revision=this.revision;
    const friends=await this.friends.getSnapshot(actorId);
    return {revision,selfId:actorId,onlinePlayers:this.onlineIds().filter(id=>id!==actorId)
      .map(id=>this.getPlayer(id)).filter((player):player is SocialPlayer=>!!player?.online).slice(0,100),
      ...friends,party:this.parties.getParty(actorId),partyInvites:this.parties.getInvites(actorId),trade:this.trades.getSnapshot(actorId)};
  }
  isBusy(actorId:string):boolean {return this.pending.has(actorId)||this.trades.isBusy(actorId);}
  async execute(actorId:string,payload:unknown):Promise<TradeSnapshot|null> {
    if(this.isBusy(actorId)) throw new Error("SOCIAL_ACTION_PENDING");
    const action=this.validate(payload);
    const operation=(async()=>{
      let changedTrade:TradeSnapshot|null=null;
      switch(action.type) {
        case "requestFriend": await this.friends.request(actorId,action.nickname);break;
        case "respondFriend": await this.friends.respond(actorId,action.playerId,action.accept);break;
        case "removeFriend": await this.friends.remove(actorId,action.playerId);break;
        case "inviteParty": this.parties.invite(actorId,action.playerId);break;
        case "respondParty": this.parties.respond(actorId,action.inviteId,action.accept);break;
        case "leaveParty": this.parties.leave(actorId);break;
        case "kickParty": this.parties.kick(actorId,action.playerId);break;
        case "requestTrade": await this.trades.request(actorId,action.playerId);break;
        case "respondTrade": await this.trades.respond(actorId,action.tradeId,action.accept);break;
        case "setTradeOffer": await this.trades.setOffer(actorId,action.tradeId,action.revision,action.items);break;
        case "confirmTrade": changedTrade=await this.trades.confirm(actorId,action.tradeId,action.revision);break;
        case "cancelTrade": await this.trades.cancel(actorId,action.tradeId);break;
      }
      this.markChanged();
      return changedTrade;
    })();
    this.pending.set(actorId,operation);
    try {return await operation;} finally {if(this.pending.get(actorId)===operation)this.pending.delete(actorId);}
  }
  async removeDisconnected(actorId:string):Promise<void> {
    // Signal the trade's abort immediately, then wait for any transaction before cleanup/rehydration.
    const trade=this.trades.removeDisconnected(actorId);
    await Promise.allSettled([trade,this.pending.get(actorId)]);
    this.parties.removeDisconnected(actorId);
    this.markChanged();
  }
  async cancelForBattle(actorId:string):Promise<void> {
    if(this.isBusy(actorId))throw new Error("SOCIAL_ACTION_PENDING");
    const trade=this.trades.getSnapshot(actorId);
    if(trade && (trade.status==="invited"||trade.status==="active")) {
      await this.trades.cancel(actorId,trade.id);this.markChanged();
    }
  }
  async checkDistance(actorId:string):Promise<boolean> {
    const before=this.trades.getSnapshot(actorId);
    if(!before || (before.status!=="active" && before.status!=="invited"))return false;
    await this.trades.checkDistance(actorId);
    const changed=this.trades.getSnapshot(actorId)?.status!==before.status;
    if(changed)this.markChanged();return changed;
  }
  private validate(payload:unknown):SocialAction {
    if(!payload || typeof payload!=="object")throw new Error("INVALID_SOCIAL_ACTION");
    const data=payload as Record<string,unknown>;
    const text=(key:string,max=64)=>typeof data[key]==="string" && (data[key] as string).length>0 && (data[key] as string).length<=max;
    const bool=()=>typeof data.accept==="boolean";
    const revision=()=>Number.isSafeInteger(data.revision) && (data.revision as number)>=0;
    let valid=false;
    switch(data.type) {
      case "requestFriend": valid=text("nickname",20);break;
      case "respondFriend":valid=text("playerId")&&bool();break;
      case "removeFriend":case "inviteParty":case "kickParty":case "requestTrade":valid=text("playerId");break;
      case "respondParty":valid=text("inviteId")&&bool();break;
      case "leaveParty":valid=true;break;
      case "respondTrade":valid=text("tradeId")&&bool();break;
      case "cancelTrade":valid=text("tradeId");break;
      case "confirmTrade":valid=text("tradeId")&&revision();break;
      case "setTradeOffer":valid=text("tradeId")&&revision()&&Array.isArray(data.items)&&data.items.length<=8&&data.items.every(item=>item&&typeof item==="object"&&typeof item.instanceId==="string"&&item.instanceId.length<=64&&Number.isSafeInteger(item.quantity)&&item.quantity>0);break;
    }
    if(!valid)throw new Error("INVALID_SOCIAL_ACTION");
    return payload as SocialAction;
  }
}
