/* @vitest-environment jsdom */
import type { InventoryItem,InventorySnapshot } from "@web-mmorpg/shared";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {InventoryDragController} from "../src/ui/InventoryDragController";

const item=(id:string,extra:Partial<InventoryItem>={}):InventoryItem=>({instanceId:id,itemId:id,itemDefinitionId:id,name:id,quantity:1,category:"material",description:"",rarity:"COMMON",upgradeLevel:0,...extra});
const pack=item("pack",{category:"container",containerCapacity:16,permanentContainer:true}),side=item("side",{category:"container",containerCapacity:8});
let snapshot:InventorySnapshot,root:HTMLDivElement,source:HTMLButtonElement,target:HTMLButtonElement,controller:InventoryDragController,hit:Element|null;
let drop=vi.fn<(instanceId:string,containerInstanceId:string)=>void>(),state=vi.fn<()=>void>();
function pointer(type:string,node:EventTarget,x=0,y=0,pointerType="mouse"):Event {const event=new MouseEvent(type,{bubbles:true,cancelable:true,button:0,clientX:x,clientY:y});Object.defineProperties(event,{pointerId:{value:1},pointerType:{value:pointerType},isPrimary:{value:true}});node.dispatchEvent(event);return event;}
function key(node:EventTarget,key:string):void {node.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true}));}
beforeEach(()=>{
 document.body.replaceChildren();snapshot={items:[pack,side,item("wood",{quantity:3,quality:"GOOD",containerInstanceId:"pack"})],containerSlots:["pack","side",null,null]};
 root=document.createElement("div");source=document.createElement("button");source.dataset.containerItem="wood";root.append(source);target=document.createElement("button");target.dataset.containerDropTarget="side";document.body.append(root,target);hit=target;Object.defineProperty(document,"elementFromPoint",{configurable:true,value:vi.fn(()=>hit)});
 drop=vi.fn<(instanceId:string,containerInstanceId:string)=>void>();state=vi.fn<()=>void>();controller=new InventoryDragController(root,{snapshot:()=>snapshot,source:id=>snapshot.items.find(entry=>entry.instanceId===id),enabled:()=>true,onStart:vi.fn(),onDrop:drop,onStateChange:state,onMessage:vi.fn()});
});
afterEach(()=>{window.dispatchEvent(new Event("blur"));controller.destroy();vi.useRealTimers();vi.restoreAllMocks();});

it("centers the dragged icon and equips only on release over a matching currently eligible equipment slot",()=>{
 controller.destroy();
 snapshot.items=snapshot.items.map(entry=>entry.instanceId==="wood"?item("wood",{quantity:1,containerInstanceId:"pack",equipment:{slot:"mainHand",weaponFamily:"sword",twoHanded:false,minimumLevel:1,modifiers:[]}}):entry);
 const gear=document.createElement("article");gear.dataset.equipmentDropTarget="mainHand";document.body.append(gear);hit=gear;
 let eligible=true;const equip=vi.fn();
 controller=new InventoryDragController(root,{snapshot:()=>snapshot,source:id=>snapshot.items.find(entry=>entry.instanceId===id),enabled:()=>true,onStart:vi.fn(),onDrop:drop,canEquip:()=>eligible,onEquipDrop:equip,onStateChange:state,onMessage:vi.fn()});
 pointer("pointerdown",source);pointer("pointermove",document,100,120);
 const ghost=document.querySelector<HTMLElement>("[data-inventory-drag-ghost]")!;
 expect(ghost.style.left).toBe("100px");expect(ghost.style.top).toBe("120px");expect(gear.classList.contains("inventory-drop-target--valid")).toBe(true);
 expect(equip).not.toHaveBeenCalled();expect(drop).not.toHaveBeenCalled();
 pointer("pointerup",document.body,100,120);expect(equip).toHaveBeenCalledExactlyOnceWith("wood","mainHand");
 gear.dataset.equipmentDropTarget="helmet";
 pointer("pointerdown",source);pointer("pointermove",document,100,120);pointer("pointerup",document.body,100,120);expect(equip).toHaveBeenCalledTimes(1);
 gear.dataset.equipmentDropTarget="mainHand";
 pointer("pointerdown",source);pointer("pointermove",document,100,120);eligible=false;pointer("pointerup",document.body,100,120);expect(equip).toHaveBeenCalledTimes(1);
 eligible=true;gear.hidden=true;
 pointer("pointerdown",source);pointer("pointermove",document,100,120);pointer("pointerup",document.body,100,120);expect(equip).toHaveBeenCalledTimes(1);expect(drop).not.toHaveBeenCalled();
});

it("commits once on valid hover before release, survives a replaced source and shields compatibility releases",()=>{
 pointer("pointerdown",source);pointer("pointermove",document,3,0);expect(drop).not.toHaveBeenCalled();pointer("pointermove",document,8,0);expect(drop).toHaveBeenCalledExactlyOnceWith("wood","side");expect(controller.isDragging).toBe(true);
 source.remove();snapshot={...snapshot,items:snapshot.items.map(entry=>entry.instanceId==="wood"?{...entry,containerInstanceId:"side"}:entry)};controller.revalidate();pointer("pointermove",document,30,20);expect(drop).toHaveBeenCalledTimes(1);
 const world=vi.fn();document.body.addEventListener("pointerup",world);document.body.addEventListener("mouseup",world);document.body.addEventListener("click",world);
 pointer("pointerup",document.body,30,20);document.body.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,cancelable:true}));document.body.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true}));expect(world).not.toHaveBeenCalled();expect(controller.isDragging).toBe(false);expect(document.querySelector("[data-inventory-drag-ghost]")).toBeNull();
 document.body.removeEventListener("pointerup",world);document.body.removeEventListener("mouseup",world);document.body.removeEventListener("click",world);
});

it("marks full/current/unassigned targets invalid and uses current capacity before a hover transfer",()=>{
 snapshot.items.push(...Array.from({length:8},(_,index)=>item(`full-${index}`,{containerInstanceId:"side"})));pointer("pointerdown",source);pointer("pointermove",document,9,0);expect(drop).not.toHaveBeenCalled();expect(target.classList.contains("inventory-drop-target--invalid")).toBe(true);
 const ghost=document.querySelector<HTMLElement>("[data-inventory-drag-ghost]")!;expect(ghost.dataset.itemQuality).toBe("GOOD");expect(ghost.textContent).toBe("3");
 target.dataset.containerDropTarget="pack";pointer("pointermove",document,12,0);expect(drop).not.toHaveBeenCalled();target.dataset.containerDropTarget="unassigned";pointer("pointermove",document,14,0);expect(drop).not.toHaveBeenCalled();
 target.dataset.containerDropTarget="side";snapshot.items=snapshot.items.filter(entry=>!entry.instanceId.startsWith("full-"));controller.revalidate();pointer("pointermove",document,18,0);expect(drop).toHaveBeenCalledExactlyOnceWith("wood","side");
});

it("preserves touch scrolling before the hold and activates real touch dragging only after 250ms",()=>{
 vi.useFakeTimers();pointer("pointerdown",source,0,0,"touch");vi.advanceTimersByTime(200);const scroll=new Event("touchmove",{bubbles:true,cancelable:true});document.dispatchEvent(scroll);expect(scroll.defaultPrevented).toBe(false);pointer("pointermove",document,0,12,"touch");vi.advanceTimersByTime(300);expect(controller.isDragging).toBe(false);expect(document.querySelector("[data-inventory-drag-ghost]")).toBeNull();expect(drop).not.toHaveBeenCalled();
 pointer("pointerdown",source,0,0,"touch");vi.advanceTimersByTime(250);expect(controller.isDragging).toBe(true);const dragMove=new Event("touchmove",{bubbles:true,cancelable:true});document.dispatchEvent(dragMove);expect(dragMove.defaultPrevented).toBe(true);pointer("pointermove",document,20,0,"touch");expect(drop).toHaveBeenCalledExactlyOnceWith("wood","side");
 pointer("pointerup",document.body,20,0,"touch");const end=new Event("touchend",{bubbles:true,cancelable:true});document.body.dispatchEvent(end);expect(end.defaultPrevented).toBe(true);
});

it("retains release capture after Escape/hide even when the pointer stays held longer than 400ms",()=>{
 vi.useFakeTimers();hit=null;pointer("pointerdown",source);pointer("pointermove",document,9,0);key(document,"Escape");expect(controller.isDragging).toBe(false);expect(document.querySelector("[data-inventory-drag-ghost]")).toBeNull();vi.advanceTimersByTime(5000);hit=target;pointer("pointermove",document,40,30);expect(drop).not.toHaveBeenCalled();
 const world=vi.fn();document.body.addEventListener("pointerup",world);document.body.addEventListener("mouseup",world);document.body.addEventListener("click",world);pointer("pointerup",document.body,40,30);document.body.dispatchEvent(new MouseEvent("mouseup",{bubbles:true,cancelable:true}));document.body.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true}));expect(world).not.toHaveBeenCalled();document.body.removeEventListener("pointerup",world);document.body.removeEventListener("mouseup",world);document.body.removeEventListener("click",world);
});

it("supports Space pickup then HUD Enter and Escape cancellation without details controls",()=>{
 key(source," ");expect(controller.isDragging).toBe(true);expect(target.classList.contains("inventory-drop-target--valid")).toBe(true);expect(drop).not.toHaveBeenCalled();key(target,"Escape");expect(controller.isDragging).toBe(false);expect(target.classList.contains("inventory-drop-target--valid")).toBe(false);
 key(source," ");target.focus();key(target,"Enter");expect(drop).toHaveBeenCalledExactlyOnceWith("wood","side");expect(controller.isDragging).toBe(false);expect(state).toHaveBeenCalledTimes(4);
});

it("rejects permanent/equipped sources and nonempty containers, and cancels when a source disappears",()=>{
 snapshot.items=snapshot.items.map(entry=>entry.instanceId==="wood"?{...entry,permanentContainer:true}:entry);key(source," ");expect(controller.isDragging).toBe(false);
 snapshot.items=snapshot.items.map(entry=>entry.instanceId==="wood"?item("wood",{category:"container",containerCapacity:8,containerInstanceId:"pack"}):entry);snapshot.items.push(item("child",{containerInstanceId:"wood"}));key(source," ");key(target,"Enter");expect(drop).not.toHaveBeenCalled();snapshot.items=snapshot.items.filter(entry=>entry.instanceId!=="wood");controller.revalidate();expect(controller.isDragging).toBe(false);expect(document.querySelector("[data-inventory-drag-ghost]")).toBeNull();
});

it("cleans touch timers/ghosts/highlights on pointer cancellation, blur and destroy",()=>{
 vi.useFakeTimers();pointer("pointerdown",source,0,0,"touch");pointer("pointercancel",document,0,0,"touch");vi.advanceTimersByTime(1000);expect(controller.isDragging).toBe(false);pointer("pointerdown",source,0,0,"touch");vi.advanceTimersByTime(250);target.removeAttribute("data-container-drop-target");window.dispatchEvent(new Event("blur"));expect(document.querySelector("[data-inventory-drag-ghost]")).toBeNull();expect(target.classList.contains("inventory-drop-target--valid")).toBe(false);controller.destroy();pointer("pointerdown",source,0,0,"touch");vi.advanceTimersByTime(1000);expect(controller.isDragging).toBe(false);expect(drop).not.toHaveBeenCalled();
});
