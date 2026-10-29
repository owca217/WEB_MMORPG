import type { InventorySnapshot } from "@web-mmorpg/shared";
import { gameSocket, type ConnectionState } from "../net/GameSocket";
import { playerStateStore } from "../state/PlayerStateStore";
import { socialStateStore } from "../state/SocialStateStore";
import { SocialPanel } from "./SocialPanel";

interface Options {inBattle:boolean;onTypingChange?:()=>void;onInventoryChanged:(inventory:InventorySnapshot)=>void;}
export class SocialController {
  private readonly panel:SocialPanel;
  private readonly cleanups:Array<()=>void>=[];
  private connection:ConnectionState="connecting";
  private destroyed=false;
  private typing=false;
  private reading:Promise<unknown>|null=null;
  private readonly timer:number;
  constructor(private readonly options:Options) {
    this.panel=new SocialPanel({onAction:async action=>{
      const result=await gameSocket.socialAction(action);
      if(!this.destroyed && result.ok && result.inventory)options.onInventoryChanged(result.inventory);
      return result;
    },onOpen:()=>{void this.refresh();gameSocket.requestPlayerState();}});
    this.cleanups.push(socialStateStore.subscribe(()=>this.render()),playerStateStore.subscribe(()=>this.render()));
    this.cleanups.push(gameSocket.onConnectionState(state=>{this.connection=state;this.render();if(state==="connected")void this.refresh();}));
    const focus=()=>{queueMicrotask(()=>{
      if(this.destroyed)return;
      const typing=this.panel.isTyping;
      if(typing!==this.typing){this.typing=typing;options.onTypingChange?.();}
    });};
    document.addEventListener("focusin",focus);document.addEventListener("focusout",focus);
    this.cleanups.push(()=>{document.removeEventListener("focusin",focus);document.removeEventListener("focusout",focus);});
    this.timer=window.setInterval(()=>{if(this.connection==="connected")void this.refresh();},10000);
    this.render();
  }
  get isTyping():boolean {return this.panel.isTyping;}
  destroy():void {
    this.destroyed=true;window.clearInterval(this.timer);
    for(const cleanup of this.cleanups.splice(0))cleanup();this.panel.destroy();
    if(this.typing)this.options.onTypingChange?.();
  }
  private refresh():Promise<unknown> {
    if(this.reading)return this.reading;
    this.reading=gameSocket.requestSocialState().finally(()=>{this.reading=null;});return this.reading;
  }
  private render():void {
    if(this.destroyed)return;
    const snapshot=socialStateStore.get(),player=playerStateStore.get();
    const inventory=snapshot && player?.character.playerId===snapshot.selfId ? player.inventory : {items:[]};
    this.panel.update(snapshot,inventory,this.connection,this.options.inBattle);
  }
}
