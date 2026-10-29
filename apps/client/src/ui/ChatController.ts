import type { ChatMessage, ChatViewport } from "@web-mmorpg/shared";
import { gameSocket, type ConnectionState } from "../net/GameSocket";
import { chatStateStore } from "../state/ChatStateStore";
import { ChatWidget } from "./ChatWidget";

interface ChatControllerOptions {
  nearbyAvailable: boolean;
  onNearbyMessage?: (message: ChatMessage) => void;
  onTypingChange?: (typing: boolean) => void;
}

/** A scene owns the window/listeners; the authenticated socket owns the bounded transcript. */
export class ChatController {
  private readonly widget: ChatWidget;
  private readonly cleanups: Array<()=>void> = [];
  private connection: ConnectionState = "connecting";
  private viewport: ChatViewport | undefined;
  private typing = false;
  private destroyed = false;
  constructor(private readonly options: ChatControllerOptions) {
    this.widget=new ChatWidget({onSend:(channel,text)=>gameSocket.sendChatMessage(channel,text),onOpen:()=>{void gameSocket.requestChatHistory();}});
    this.cleanups.push(chatStateStore.subscribe(()=>this.render()));
    this.cleanups.push(gameSocket.onChatMessage(message=>{
      if(message.channel==="nearby" && options.nearbyAvailable) options.onNearbyMessage?.(message);
    }));
    this.cleanups.push(gameSocket.onConnectionState(state=>{
      this.connection=state;
      this.render();
      if(state==="connected") {
        if(this.viewport && options.nearbyAvailable) gameSocket.updateChatViewport(this.viewport);
        void gameSocket.requestChatHistory();
      }
    }));
    const focus=()=>{queueMicrotask(()=>{
      if(this.destroyed) return;
      const typing=this.widget.isTyping;
      if(typing!==this.typing) {this.typing=typing;options.onTypingChange?.(typing);}
    });};
    document.addEventListener("focusin",focus);
    document.addEventListener("focusout",focus);
    this.cleanups.push(()=>{document.removeEventListener("focusin",focus);document.removeEventListener("focusout",focus);});
    this.render();
  }
  get isTyping(): boolean { return this.widget.isTyping; }
  updateViewport(viewport: ChatViewport): void {
    if(!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width<=0 || viewport.height<=0) return;
    if(this.viewport?.width===viewport.width && this.viewport.height===viewport.height) return;
    this.viewport={...viewport};
    if(this.connection==="connected" && this.options.nearbyAvailable) gameSocket.updateChatViewport(viewport);
  }
  destroy(): void {
    this.destroyed=true;
    for(const cleanup of this.cleanups.splice(0)) cleanup();
    this.widget.destroy();
    if(this.typing) this.options.onTypingChange?.(false);
  }
  private render():void { if(!this.destroyed) this.widget.update(chatStateStore.get(),this.connection,this.options.nearbyAvailable); }
}
