import type { SocialSnapshot } from "@web-mmorpg/shared";
export class SocialStateStore {
  private state:SocialSnapshot|null=null;
  private readonly listeners=new Set<()=>void>();
  get():SocialSnapshot|null{return this.state ? structuredClone(this.state) : null;}
  set(state:SocialSnapshot):void {
    if(this.state && this.state.selfId!==state.selfId)return;
    if(this.state && (state.revision??0)<(this.state.revision??0))return;
    this.state=structuredClone(state);for(const listener of this.listeners)listener();
  }
  reset():void {this.state=null;for(const listener of this.listeners)listener();}
  subscribe(listener:()=>void):()=>void{this.listeners.add(listener);return()=>this.listeners.delete(listener);}
}
export const socialStateStore=new SocialStateStore();
