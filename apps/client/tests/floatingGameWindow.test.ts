/* @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { FloatingGameWindow } from "../src/ui/FloatingGameWindow";
const windows: FloatingGameWindow[]=[];
afterEach(()=>{windows.splice(0).forEach(window=>window.destroy());document.body.replaceChildren();vi.restoreAllMocks();vi.unstubAllGlobals();});
function create(){const window=new FloatingGameWindow({id:"party",title:"Drużyna",width:320});windows.push(window);return window;}
function pointer(type:string,x:number,y:number){return Object.assign(new Event(type,{bubbles:true,cancelable:true}),{button:0,pointerId:1,clientX:x,clientY:y});}
it("opens a nonmodal window, restores focus after Escape and preserves its dragged position across reopening",()=>{
 const launcher=document.createElement("button");document.body.append(launcher);launcher.focus();const window=create();window.show();
 expect(window.element.classList.contains("game-panel")).toBe(false);expect(window.element.dataset.floatingGameWindow).toBe("party");
 expect(document.activeElement).toBe(window.element.querySelector("[data-close]"));
 window.element.querySelector('[data-floating-drag-handle]')!.dispatchEvent(pointer("pointerdown",30,90));
 globalThis.window.dispatchEvent(pointer("pointermove",150,170));globalThis.window.dispatchEvent(pointer("pointerup",150,170));
 const position=[window.element.style.left,window.element.style.top];
 window.element.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));expect(window.isOpen).toBe(false);expect(document.activeElement).toBe(launcher);
 window.show();expect([window.element.style.left,window.element.style.top]).toEqual(position);
});
it("clamps dragged windows to the visible viewport and reclamps after a resize",()=>{
 vi.stubGlobal("innerWidth",500);vi.stubGlobal("innerHeight",500);const floating=create();floating.show();
 floating.element.querySelector('[data-floating-drag-handle]')!.dispatchEvent(pointer("pointerdown",20,90));window.dispatchEvent(pointer("pointermove",900,900));window.dispatchEvent(pointer("pointerup",900,900));
 expect(parseFloat(floating.element.style.left)).toBeLessThanOrEqual(172);expect(parseFloat(floating.element.style.top)).toBeLessThanOrEqual(72);
 vi.stubGlobal("innerWidth",240);vi.stubGlobal("innerHeight",220);window.dispatchEvent(new Event("resize"));
 expect(parseFloat(floating.element.style.left)).toBe(8);expect(parseFloat(floating.element.style.top)).toBe(8);
 expect(parseFloat(floating.element.style.maxHeight)).toBe(204);vi.unstubAllGlobals();
});
it("Back closes only the foreground floating window and destroyed windows release document handlers",()=>{
 const first=create(),second=new FloatingGameWindow({id:"trade",title:"Handel",width:360});windows.push(second);first.show();second.show();
 const back=new Event("game-ui-back",{cancelable:true});document.dispatchEvent(back);expect(back.defaultPrevented).toBe(true);expect(first.isOpen).toBe(true);expect(second.isOpen).toBe(false);
 first.destroy();const next=new Event("game-ui-back",{cancelable:true});document.dispatchEvent(next);expect(next.defaultPrevented).toBe(false);
});
it("keeps layers bounded below modal menus and shields map release/click after header dragging",()=>{
 const floating=create();for(let index=0;index<100;index++)floating.show();expect(Number(floating.element.style.zIndex)).toBeLessThan(1140);
 const modal=document.createElement("section");modal.className="game-panel";modal.style.position="fixed";modal.style.zIndex="1140";document.body.append(modal);
 const back=new Event("game-ui-back",{cancelable:true});document.dispatchEvent(back);expect(back.defaultPrevented).toBe(false);expect(floating.isOpen).toBe(true);modal.remove();
 const canvas=document.createElement("canvas"),released=vi.fn(),clicked=vi.fn();document.body.append(canvas);canvas.addEventListener("pointerup",released);canvas.addEventListener("click",clicked);
 floating.element.querySelector('[data-floating-drag-handle]')!.dispatchEvent(pointer("pointerdown",20,90));window.dispatchEvent(pointer("pointermove",100,150));canvas.dispatchEvent(pointer("pointerup",100,150));canvas.click();
 expect(released).not.toHaveBeenCalled();expect(clicked).not.toHaveBeenCalled();canvas.click();expect(clicked).toHaveBeenCalledOnce();
});
it("shields the matching release when a held gesture is cancelled by close or resize",()=>{
 const floating=create(),canvas=document.createElement("canvas"),released=vi.fn(),clicked=vi.fn();document.body.append(canvas);canvas.addEventListener("pointerup",released);canvas.addEventListener("click",clicked);
 for(const cancel of [()=>floating.hide(),()=>window.dispatchEvent(new Event("resize"))]){
  floating.show();floating.element.querySelector('[data-floating-drag-handle]')!.dispatchEvent(pointer("pointerdown",20,90));window.dispatchEvent(pointer("pointermove",100,150));cancel();canvas.dispatchEvent(pointer("pointerup",100,150));canvas.click();
 }
 expect(released).not.toHaveBeenCalled();expect(clicked).not.toHaveBeenCalled();
});
