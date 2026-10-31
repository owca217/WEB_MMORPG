import "./FloatingGameWindow.css";
import { isForegroundGameWindow } from "./gameWindows";

interface FloatingGameWindowOptions { id:string; title:string; width:number; onOpen?:()=>void; onClose?:()=>void; }

/** A movable, nonmodal game surface; content updates never replace its frame. */
export class FloatingGameWindow {
  readonly element:HTMLElement;
  readonly content:HTMLElement;
  private readonly closeButton:HTMLButtonElement;
  private readonly viewport:VisualViewport|null;
  private returnFocus:HTMLElement|null=null;
  private position:{x:number;y:number}|null=null;
  private drag:{id:number;x:number;y:number;left:number;top:number;moved:boolean}|null=null;
  private cancelledPointer:number|null=null;
  private clickGuard:number|undefined;
  private destroyed=false;
  constructor(private readonly options:FloatingGameWindowOptions) {
    this.element=document.createElement("section");this.element.className="social-floating-window is-hidden";
    this.element.dataset.floatingGameWindow=options.id;this.element.setAttribute("role","dialog");this.element.setAttribute("aria-modal","false");
    const header=document.createElement("header");header.className="social-floating-window__header";header.dataset.floatingDragHandle="";
    const title=document.createElement("h2");title.id=`floating-${options.id}-title`;title.textContent=options.title;this.element.setAttribute("aria-labelledby",title.id);
    this.closeButton=document.createElement("button");this.closeButton.type="button";this.closeButton.dataset.close="";this.closeButton.textContent="×";this.closeButton.setAttribute("aria-label",`Zamknij: ${options.title}`);
    header.append(title,this.closeButton);this.content=document.createElement("div");this.content.className="social-floating-window__content";this.content.dataset.floatingContent="";
    this.element.append(header,this.content);document.body.append(this.element);
    this.closeButton.addEventListener("click",()=>this.hide());
    header.addEventListener("pointerdown",event=>{
      if(event.button!==0 || event.target instanceof Element && event.target.closest("button,input,select,textarea,a"))return;
      event.preventDefault();this.raise();this.clamp();const position=this.position!;
      this.cancelledPointer=null;this.drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:position.x,top:position.y,moved:false};
    });
    this.element.addEventListener("pointerdown",()=>this.raise());
    for(const type of ["pointerdown","pointerup","mousedown","mouseup","touchstart","touchend","click"])this.element.addEventListener(type,event=>event.stopPropagation());
    this.element.addEventListener("keydown",event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();this.hide();}});
    this.viewport=window.visualViewport;
    window.addEventListener("resize",this.onResize);this.viewport?.addEventListener("resize",this.onResize);this.viewport?.addEventListener("scroll",this.onResize);
    window.addEventListener("pointermove",this.onMove,true);window.addEventListener("pointerup",this.onRelease,true);window.addEventListener("pointercancel",this.onRelease,true);
    document.addEventListener("game-ui-back",this.onBack);
  }
  get isOpen():boolean{return !this.destroyed&&!this.element.classList.contains("is-hidden");}
  refreshLayout():void { if(this.isOpen)this.clamp(); }
  show(focus=true):void {
    if(this.destroyed)return;const opening=!this.isOpen;
    if(opening)this.returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    this.element.classList.remove("is-hidden");this.raise();this.clamp();
    if(opening&&focus)this.closeButton.focus({preventScroll:true});if(opening)this.options.onOpen?.();
  }
  hide():void {
    if(!this.isOpen)return;const restore=this.element.contains(document.activeElement);this.cancelDrag();this.element.classList.add("is-hidden");
    if(restore&&this.returnFocus?.isConnected)this.returnFocus.focus({preventScroll:true});this.options.onClose?.();
  }
  destroy():void {
    if(this.destroyed)return;this.hide();this.destroyed=true;
    window.removeEventListener("resize",this.onResize);this.viewport?.removeEventListener("resize",this.onResize);this.viewport?.removeEventListener("scroll",this.onResize);
    window.removeEventListener("pointermove",this.onMove,true);window.removeEventListener("pointerup",this.onRelease,true);window.removeEventListener("pointercancel",this.onRelease,true);
    this.clearClickGuard();
    document.removeEventListener("game-ui-back",this.onBack);this.element.remove();
  }
  private raise():void{
    const peers=[...document.querySelectorAll<HTMLElement>('[data-floating-game-window]')];
    for(const peer of peers)peer.style.zIndex="1116";this.element.style.zIndex="1117";
  }
  private cancelDrag():void{if(this.drag)this.cancelledPointer=this.drag.id;this.drag=null;}
  private readonly onResize=():void=>{this.cancelDrag();if(this.isOpen)this.clamp();};
  private readonly onMove=(event:PointerEvent):void=>{
    if(this.cancelledPointer===event.pointerId){event.preventDefault();event.stopPropagation();return;}
    if(!this.drag||event.pointerId!==this.drag.id)return;event.preventDefault();event.stopPropagation();
    if(Math.hypot(event.clientX-this.drag.x,event.clientY-this.drag.y)>3)this.drag.moved=true;
    this.position={x:this.drag.left+event.clientX-this.drag.x,y:this.drag.top+event.clientY-this.drag.y};this.clamp();
  };
  private readonly onRelease=(event:PointerEvent):void=>{
    if(this.drag?.id!==event.pointerId&&this.cancelledPointer!==event.pointerId)return;event.preventDefault();event.stopPropagation();const moved=this.drag?.moved||this.cancelledPointer===event.pointerId;this.drag=null;this.cancelledPointer=null;
    if(moved){this.clearClickGuard();window.addEventListener("click",this.onClick,true);this.clickGuard=window.setTimeout(()=>this.clearClickGuard(),0);}
  };
  private readonly onClick=(event:Event):void=>{event.preventDefault();event.stopImmediatePropagation();this.clearClickGuard();};
  private clearClickGuard():void {if(this.clickGuard!==undefined)window.clearTimeout(this.clickGuard);this.clickGuard=undefined;window.removeEventListener("click",this.onClick,true);}
  private readonly onBack=(event:Event):void=>{
    if(!event.cancelable||event.defaultPrevented||!this.isOpen)return;
    if(!isForegroundGameWindow(this.element))return;event.preventDefault();this.hide();
  };
  private clamp():void {
    const styles=getComputedStyle(document.documentElement),inset=(name:string)=>Number.parseFloat(styles.getPropertyValue(`--safe-area-${name}`))||0;
    const left=(this.viewport?.offsetLeft??0)+inset("left")+8,top=(this.viewport?.offsetTop??0)+inset("top")+8;
    const width=Math.max(1,(this.viewport?.width??window.innerWidth)-inset("left")-inset("right")-16);
    const height=Math.max(1,(this.viewport?.height??window.innerHeight)-inset("top")-inset("bottom")-16);
    this.element.style.width=`${Math.min(this.options.width,width)}px`;this.element.style.maxHeight=`${height}px`;
    const rect=this.element.getBoundingClientRect(),measuredWidth=rect.width||Math.min(this.options.width,width),measuredHeight=rect.height||Math.min(420,height);
    const initial=this.options.id.endsWith("trade")?32:0,position=this.position??{x:left+initial,y:top+64+initial};
    this.position={x:Math.max(left,Math.min(position.x,left+width-measuredWidth)),y:Math.max(top,Math.min(position.y,top+height-measuredHeight))};
    this.element.style.left=`${this.position.x}px`;this.element.style.top=`${this.position.y}px`;
  }
}
