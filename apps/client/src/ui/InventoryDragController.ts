import { CONTAINER_ITEM_CATEGORY, isEquipmentSlot, type ContainerSlotIndex, type EquipmentSlot, type InventoryItem, type InventorySnapshot } from "@web-mmorpg/shared";
import { inventoryItemIcon } from "./InventoryItemIcon";
import { applyItemQualityFrame } from "./ItemQualityFrame";
import { getAssignedContainers } from "./PermanentBackpack";

interface DragOptions {
    snapshot: () => InventorySnapshot;
    source: (instanceId: string) => InventoryItem | undefined;
    enabled: () => boolean;
    onStart: () => void;
    onDrop: (instanceId: string, containerInstanceId: string) => void;
    canEquip?: (item: InventoryItem, slot: EquipmentSlot) => boolean;
    onEquipDrop?: (instanceId: string, slot: EquipmentSlot) => void;
    onAssignContainer?: (instanceId: string, slot: ContainerSlotIndex) => void;
    onStateChange: () => void;
    onMessage: (message: string) => void;
}
interface Gesture {
    instanceId: string;
    source: HTMLElement;
    pointerId: number | null;
    touch: boolean;
    x: number;
    y: number;
    startX: number;
    startY: number;
    active: boolean;
    committed: boolean;
    cancelled: boolean;
}

/** Keeps an in-flight pointer gesture alive when an authoritative update replaces its source cell. */
export class InventoryDragController {
    private gesture: Gesture | null = null;
    private ghost: HTMLDivElement | null = null;
    private holdTimer: ReturnType<typeof setTimeout> | undefined;
    private suppressClick = false;
    private destroyed = false;
    private readonly highlightedTargets=new Set<HTMLElement>();

    constructor(private readonly root: HTMLElement, private readonly options: DragOptions) {
        root.addEventListener("pointerdown", this.onPointerDown);
        root.addEventListener("keydown", this.onSourceKey);
        root.addEventListener("dragstart", this.onNativeDrag);
    }
    get isDragging(): boolean { return this.gesture?.active === true; }

    revalidate(): void {
        if (!this.gesture || this.gesture.committed || this.gesture.cancelled) return;
        if (!this.sourceItem(this.gesture.instanceId)) this.cancel();
        else if (this.gesture.active) this.highlightTargets();
    }
    cancel(): void {
        const gesture=this.gesture;
        if(gesture?.cancelled)return;
        if(gesture?.active&&gesture.pointerId!==null){this.clearHold();this.clearVisuals();gesture.active=false;gesture.cancelled=true;this.options.onStateChange();return;}
        this.finish(false);
    }
    destroy(): void {
        if (this.destroyed) return;
        this.cancel();
        this.destroyed = true;
        if(!this.gesture)this.unlisten();
        this.root.removeEventListener("pointerdown", this.onPointerDown);
        this.root.removeEventListener("keydown", this.onSourceKey);
        this.root.removeEventListener("dragstart", this.onNativeDrag);
    }

    private sourceItem(instanceId: string): InventoryItem | undefined {
        if (!this.options.enabled()) return undefined;
        const item = this.options.source(instanceId), snapshot = this.options.snapshot();
        const assigned = getAssignedContainers(snapshot);
        if (!item || item.quantity <= 0 || item.equippedSlot || item.permanentContainer || assigned.some(bag => bag.instanceId === instanceId)) return undefined;
        if (item.containerInstanceId && !assigned.some(bag => bag.instanceId === item.containerInstanceId)) return undefined;
        return item;
    }
    private canDrop(instanceId: string, containerId: string): boolean {
        const item = this.sourceItem(instanceId), snapshot = this.options.snapshot();
        if (!item || item.instanceId === containerId || item.containerInstanceId === containerId) return false;
        if (snapshot.items.some(child => child.containerInstanceId === item.instanceId)) return false;
        const target = getAssignedContainers(snapshot).find(bag => bag.instanceId === containerId);
        if (!target) return false;
        return snapshot.items.filter(child => child.containerInstanceId === containerId && !child.equippedSlot).length < target.containerCapacity!;
    }
    private canEquipAt(instanceId: string, target: HTMLElement): boolean {
        const slot = target.dataset.equipmentDropTarget, item = this.sourceItem(instanceId);
        return !!item && isEquipmentSlot(slot) && item.equipment?.slot === slot
            && !!this.options.onEquipDrop && this.options.canEquip?.(item, slot) === true;
    }
    private isContainerAssignment(instanceId: string, target: HTMLElement): boolean {
        return !!this.options.onAssignContainer && target.hasAttribute("data-container-slot-target")
            && this.sourceItem(instanceId)?.category === CONTAINER_ITEM_CATEGORY;
    }
    private canAssignAt(instanceId: string, target: HTMLElement): boolean {
        const slot = Number(target.dataset.containerSlotTarget), item = this.sourceItem(instanceId);
        return this.isContainerAssignment(instanceId, target) && Number.isInteger(slot) && slot >= 1 && slot <= 3
            && !!item && Number.isSafeInteger(item.containerCapacity) && (item.containerCapacity ?? 0) > 0;
    }
    private validTarget(instanceId: string, target: HTMLElement): boolean {
        if (target.closest("[hidden], .is-hidden")) return false;
        if (this.isContainerAssignment(instanceId, target)) return this.canAssignAt(instanceId, target);
        return target.hasAttribute("data-equipment-drop-target") ? this.canEquipAt(instanceId, target)
            : this.canDrop(instanceId, target.dataset.containerDropTarget ?? "");
    }
    private targetAt(x: number, y: number): HTMLElement | null {
        return document.elementFromPoint?.(x, y)?.closest<HTMLElement>("[data-container-drop-target], [data-equipment-drop-target], [data-container-slot-target]") ?? null;
    }
    private sourceButton(event: Event): HTMLElement | null {
        return event.target instanceof Element ? event.target.closest<HTMLElement>("[data-container-item]") : null;
    }
    private readonly onNativeDrag = (event: Event): void => { event.preventDefault(); };
    private readonly onPointerDown = (event: PointerEvent): void => {
        if (this.destroyed || this.gesture || event.button !== 0 || event.isPrimary === false) return;
        const source = this.sourceButton(event), instanceId = source?.dataset.containerItem;
        if (!source || !instanceId || !this.sourceItem(instanceId)) return;
        this.clearClickGuard();
        this.gesture = { source, instanceId, pointerId: event.pointerId, touch: event.pointerType === "touch", x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, active: false, committed: false,cancelled:false };
        this.listen();
        if (this.gesture.touch) this.holdTimer = setTimeout(() => this.activate(), 250);
    };
    private readonly onSourceKey = (event: KeyboardEvent): void => {
        if (event.key !== " " && event.key !== "Spacebar") return;
        const source = this.sourceButton(event), instanceId = source?.dataset.containerItem;
        if (!source || !instanceId || !this.sourceItem(instanceId) || this.gesture) return;
        event.preventDefault(); event.stopImmediatePropagation();
        this.clearClickGuard();
        const rect = source.getBoundingClientRect();
        this.gesture = { source, instanceId, pointerId: null, touch: false, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, startX: rect.left, startY: rect.top, active: false, committed: false,cancelled:false };
        this.listen(); this.activate();
        this.targets().find(target => this.validTarget(instanceId, target))?.focus();
    };
    private activate(): void {
        const gesture = this.gesture, item = gesture && this.sourceItem(gesture.instanceId);
        if (!gesture || !item || gesture.active) return;
        this.clearHold(); gesture.active = true;
        this.options.onStart();
        gesture.source.classList.add("inventory-drag-source");
        const ghost = document.createElement("div");
        ghost.className = "container-contents inventory-drag-ghost"; ghost.dataset.inventoryDragGhost = "";
        applyItemQualityFrame(ghost, item); ghost.setAttribute("aria-hidden", "true");
        ghost.append(inventoryItemIcon(item));
        if (item.quantity > 1) { const count = document.createElement("span"); count.className = "container-contents__quantity"; count.textContent = String(item.quantity); ghost.append(count); }
        document.body.append(ghost); this.ghost = ghost; this.positionGhost(); this.highlightTargets();
        if (gesture.pointerId !== null) { try { gesture.source.setPointerCapture?.(gesture.pointerId); } catch { /* The document listeners also cover replaced cells. */ } }
        this.options.onMessage(item.category === CONTAINER_ITEM_CATEGORY
            ? "Upuść pojemnik w slocie 2–4, aby go założyć. Klawiatura: Tab wybiera slot, Enter zatwierdza, Escape anuluje."
            : "Najedź na plecak lub upuść przedmiot w slocie uzbrojenia. Klawiatura: Tab wybiera slot, Enter zatwierdza, Escape anuluje.");
        this.options.onStateChange();
    }
    private readonly onPointerMove = (event: PointerEvent): void => {
        const gesture = this.gesture;
        if (!gesture || gesture.pointerId === null || event.pointerId !== gesture.pointerId) return;
        gesture.x = event.clientX; gesture.y = event.clientY;
        if(gesture.cancelled){event.preventDefault();event.stopImmediatePropagation();return;}
        if (!gesture.active) {
            const distance = Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY);
            if (gesture.touch) { if (distance > 8) this.finish(false); return; }
            if (distance < 6) return;
            this.activate();
        }
        if (!this.gesture?.active) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (gesture.committed) return;
        this.positionGhost(); this.highlightTargets();
        const target = this.targetAt(event.clientX, event.clientY);
        if (target?.hasAttribute("data-container-drop-target") && !this.isContainerAssignment(gesture.instanceId, target) && this.validTarget(gesture.instanceId, target)) this.commit(target.dataset.containerDropTarget!);
    };
    private readonly onPointerUp = (event: PointerEvent): void => {
        const gesture = this.gesture;
        if (!gesture || gesture.pointerId === null || event.pointerId !== gesture.pointerId) return;
        const shield=gesture.active||gesture.cancelled;
        if (shield) { event.preventDefault(); event.stopImmediatePropagation(); }
        if (gesture.active && !gesture.cancelled && !gesture.committed) {
            const target = this.targetAt(event.clientX, event.clientY);
            if (target && this.isContainerAssignment(gesture.instanceId, target)) {
                if (this.validTarget(gesture.instanceId, target)) this.commitContainerAssignment(target);
                else this.options.onMessage("Nie można założyć pojemnika w tym slocie.");
            } else if (target?.hasAttribute("data-equipment-drop-target")) {
                if (this.validTarget(gesture.instanceId, target)) this.commitEquipment(target);
                else this.options.onMessage("Nie można założyć przedmiotu w tym slocie. Sprawdź jego wymagania.");
            }
        }
        this.finish(false);
        if(shield)this.blockNextClick();
    };
    private readonly onPointerCancel = (event: PointerEvent): void => { if (this.gesture?.pointerId === event.pointerId) this.finish(false); };
    private readonly onTouchMove = (event: TouchEvent): void => {
        if (this.gesture?.touch&&(this.gesture.active||this.gesture.cancelled)) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    private readonly onCompatibilityRelease=(event:Event):void=>{if(this.gesture?.active||this.gesture?.cancelled||this.suppressClick){event.preventDefault();event.stopImmediatePropagation();}};
    private readonly onContextMenu = (event: Event): void => { if (this.gesture?.touch) { event.preventDefault(); event.stopImmediatePropagation(); } };
    private readonly onScroll = (): void => { if (this.gesture && !this.gesture.active&&!this.gesture.cancelled) this.finish(false); };
    private readonly onBlur=():void=>{this.finish(false);this.clearClickGuard();};
    private readonly onGlobalKey = (event: KeyboardEvent): void => {
        const gesture = this.gesture;
        if (!gesture) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); this.cancel(); return; }
        if (gesture.pointerId !== null) return;
        if (event.key === " " || event.key === "Spacebar") { event.preventDefault(); event.stopImmediatePropagation(); this.finish(true); return; }
        if (event.key !== "Enter") return;
        event.preventDefault(); event.stopImmediatePropagation();
        const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-container-drop-target], [data-equipment-drop-target], [data-container-slot-target]") : null;
        if (target && this.validTarget(gesture.instanceId, target)) {
            if (this.isContainerAssignment(gesture.instanceId, target)) this.commitContainerAssignment(target);
            else if (target.hasAttribute("data-equipment-drop-target")) this.commitEquipment(target);
            else this.commit(target.dataset.containerDropTarget!);
        } else this.options.onMessage("Nie można umieścić przedmiotu w tym slocie.");
    };
    private readonly onFocus = (event: FocusEvent): void => {
        if (this.gesture?.pointerId !== null || !(event.target instanceof HTMLElement)) return;
        const rect = event.target.getBoundingClientRect(); this.gesture.x = rect.left + rect.width / 2; this.gesture.y = rect.top + rect.height / 2; this.positionGhost();
    };
    private commit(containerId: string): void {
        const gesture = this.gesture;
        if (!gesture || gesture.committed || !this.canDrop(gesture.instanceId, containerId)) return;
        gesture.committed = true;
        this.clearVisuals();
        const keyboard = gesture.pointerId === null;
        this.options.onDrop(gesture.instanceId, containerId);
        if (keyboard) this.finish(false);
    }
    private commitEquipment(target: HTMLElement): void {
        const gesture = this.gesture, slot = target.dataset.equipmentDropTarget;
        if (!gesture || gesture.committed || !isEquipmentSlot(slot) || !this.validTarget(gesture.instanceId, target)) return;
        gesture.committed = true;
        this.clearVisuals();
        const keyboard = gesture.pointerId === null;
        this.options.onEquipDrop!(gesture.instanceId, slot);
        if (keyboard) this.finish(false);
    }
    private commitContainerAssignment(target: HTMLElement): void {
        const gesture = this.gesture;
        if (!gesture || gesture.committed || !this.validTarget(gesture.instanceId, target)) return;
        gesture.committed = true;
        this.clearVisuals();
        const keyboard = gesture.pointerId === null;
        this.options.onAssignContainer!(gesture.instanceId, Number(target.dataset.containerSlotTarget) as ContainerSlotIndex);
        if (keyboard) this.finish(false);
    }
    private targets(): HTMLElement[] { return [...document.querySelectorAll<HTMLElement>("[data-container-drop-target], [data-equipment-drop-target], [data-container-slot-target]")]; }
    private highlightTargets(): void {
        const gesture = this.gesture;
        if (!gesture?.active || gesture.committed) return;
        for (const target of this.targets()) {this.highlightedTargets.add(target); const valid = this.validTarget(gesture.instanceId, target); target.classList.toggle("inventory-drop-target--valid", valid); target.classList.toggle("inventory-drop-target--invalid", !valid); }
    }
    private positionGhost(): void { if (this.ghost && this.gesture) { this.ghost.style.left = `${this.gesture.x}px`; this.ghost.style.top = `${this.gesture.y}px`; } }
    private clearVisuals(): void {
        this.ghost?.remove(); this.ghost = null; this.gesture?.source.classList.remove("inventory-drag-source");
        for (const target of this.highlightedTargets) target.classList.remove("inventory-drop-target--valid", "inventory-drop-target--invalid");this.highlightedTargets.clear();
    }
    private clearHold(): void { if (this.holdTimer !== undefined) clearTimeout(this.holdTimer); this.holdTimer = undefined; }
    private finish(restoreFocus: boolean): void {
        const gesture = this.gesture; this.clearHold(); this.clearVisuals(); this.gesture = null; this.unlisten();
        if (restoreFocus && gesture?.source.isConnected) gesture.source.focus();
        if (gesture?.active&&!this.destroyed) this.options.onStateChange();
    }
    private readonly onClick = (event: MouseEvent): void => { if (this.suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); } this.clearClickGuard(); };
    private blockNextClick(): void {
        this.clearClickGuard(); this.suppressClick = true; document.addEventListener("click", this.onClick, true);
        document.addEventListener("pointerdown",this.onNewPointer,true);
        document.addEventListener("mouseup",this.onCompatibilityRelease,true);document.addEventListener("touchend",this.onCompatibilityRelease,true);window.addEventListener("blur",this.onBlur);
    }
    private readonly onNewPointer=():void=>this.clearClickGuard();
    private clearClickGuard(): void { this.suppressClick = false; document.removeEventListener("click", this.onClick, true);document.removeEventListener("pointerdown",this.onNewPointer,true);document.removeEventListener("mouseup",this.onCompatibilityRelease,true);document.removeEventListener("touchend",this.onCompatibilityRelease,true);if(!this.gesture)window.removeEventListener("blur",this.onBlur); }
    private listen(): void {
        document.addEventListener("pointermove", this.onPointerMove, true); document.addEventListener("pointerup", this.onPointerUp, true); document.addEventListener("pointercancel", this.onPointerCancel, true);
        document.addEventListener("touchmove", this.onTouchMove, { capture: true, passive: false }); document.addEventListener("contextmenu", this.onContextMenu, true);
        document.addEventListener("mouseup",this.onCompatibilityRelease,true);document.addEventListener("touchend",this.onCompatibilityRelease,true);
        document.addEventListener("keydown", this.onGlobalKey, true); document.addEventListener("focusin", this.onFocus, true); document.addEventListener("scroll", this.onScroll, true);
        window.addEventListener("blur",this.onBlur);
    }
    private unlisten(): void {
        document.removeEventListener("pointermove", this.onPointerMove, true); document.removeEventListener("pointerup", this.onPointerUp, true); document.removeEventListener("pointercancel", this.onPointerCancel, true);
        document.removeEventListener("touchmove", this.onTouchMove, true); document.removeEventListener("contextmenu", this.onContextMenu, true);
        document.removeEventListener("mouseup",this.onCompatibilityRelease,true);document.removeEventListener("touchend",this.onCompatibilityRelease,true);
        document.removeEventListener("keydown", this.onGlobalKey, true); document.removeEventListener("focusin", this.onFocus, true); document.removeEventListener("scroll", this.onScroll, true);
        window.removeEventListener("blur",this.onBlur);
    }
}
