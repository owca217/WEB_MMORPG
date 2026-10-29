import type { ChatMessage } from "@web-mmorpg/shared";

const copy = (message: ChatMessage): ChatMessage => ({...message, ...(message.worldPosition ? {worldPosition:{...message.worldPosition}} : {})});
export class ChatStateStore {
  private messages: ChatMessage[] = [];
  private readonly listeners = new Set<() => void>();
  get(): ChatMessage[] { return this.messages.map(copy); }
  add(message: ChatMessage): void { this.merge([message]); }
  merge(incoming: readonly ChatMessage[]): void {
    const known=new Set(this.messages.map(message=>message.id));
    const fresh=incoming.filter(message=>!known.has(message.id) && (known.add(message.id),true));
    if (!fresh.length) return;
    const ordered=[...this.messages,...fresh.map(copy)].sort((a,b)=>a.sentAt-b.sentAt);
    const keep=new Set(["nearby","global"].flatMap(channel=>ordered.filter(message=>message.channel===channel).slice(-100).map(message=>message.id)));
    this.messages=ordered.filter(message=>keep.has(message.id));
    for(const listener of this.listeners) listener();
  }
  reset(): void { this.messages=[]; for(const listener of this.listeners) listener(); }
  subscribe(listener:()=>void):()=>void { this.listeners.add(listener); return ()=>this.listeners.delete(listener); }
}
export const chatStateStore=new ChatStateStore();
