import { CONTAINER_ITEM_CATEGORY, CONTAINER_SLOT_COUNT, PERMANENT_BACKPACK_SLOT_INDEX, getPendingInventoryItems, type ContainerSlotIndex, type InventoryItem, type InventorySnapshot, type InventoryUpdateResult, type CharacterSnapshot } from "@web-mmorpg/shared";
import { equipmentDisabledReason, equipmentItemSummary } from "./EquipmentIcon";
import { applyItemQualityFrame, itemQualityText } from "./ItemQualityFrame";
import { inventoryItemIcon } from "./InventoryItemIcon";
import { getPermanentBackpack } from "./PermanentBackpack";
import { InventoryDragController } from "./InventoryDragController";
import "./ContainerContentsPanel.css";
const PLACES_PER_PAGE = 40;
interface ContainerContentsPanelHandlers {
    onMoveItem: (itemInstanceId: string, targetContainerInstanceId: string) => Promise<InventoryUpdateResult>;
    onSetContainerSlot?: (slotIndex: ContainerSlotIndex, itemInstanceId: string) => Promise<InventoryUpdateResult>;
    onInventoryChanged: (inventory: InventorySnapshot) => void;
    onChangeContainer: (slotIndex: ContainerSlotIndex) => void;
    onEquipItem?: (item: InventoryItem) => Promise<InventoryUpdateResult>;
    onRefresh?: () => void;
    onTypingChange?: () => void;
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = ""): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className)
        element.className = className;
    return element;
}
export class ContainerContentsPanel {
    private readonly root: HTMLDivElement;
    private readonly title: HTMLElement;
    private readonly capacity: HTMLElement;
    private readonly empty: HTMLElement;
    private readonly grid: HTMLDivElement;
    private readonly feedback: HTMLElement;
    private readonly changeButton: HTMLButtonElement;
    private readonly pendingButton: HTMLButtonElement;
    private readonly pagination: HTMLElement;
    private readonly previousButton: HTMLButtonElement;
    private readonly nextButton: HTMLButtonElement;
    private readonly pageLabel: HTMLElement;
    private readonly popover: HTMLElement;
    private readonly portal: HTMLDivElement;
    private readonly drag:InventoryDragController;
    private snapshot: InventorySnapshot = { items: [] };
    private character: CharacterSnapshot | undefined;
    private slotIndex: ContainerSlotIndex = 0;
    private pendingView = false;
    private page = 0;
    private pending = false;
    private destroyed = false;
    private requestVersion = 0;
    private dataVersion = 0;
    private selectedItemId: string | null = null;
    private returnFocus: HTMLElement | null = null;
    private readonly onOutsidePointer = (event: Event): void => {
        if (!this.selectedItemId || !(event.target instanceof Node) || this.popover.contains(event.target))
            return;
        if (event.target instanceof Element && event.target.closest("[data-container-item]"))
            return;
        this.closeSelection(false);
    };
    constructor(private readonly handlers: ContainerContentsPanelHandlers) {
        this.root = node("div", "", "game-panel container-contents is-hidden");
        this.root.dataset.containerContents = "";
        this.root.setAttribute("role", "dialog");
        this.root.setAttribute("aria-labelledby", "container-contents-title");
        this.root.innerHTML = `<div class="game-panel__header"><h2 id="container-contents-title" data-container-contents-title>Pojemnik</h2><div class="container-contents__header-actions"><button type="button" data-container-pending aria-pressed="false" hidden>Oczekujące</button><button type="button" data-close aria-label="Zamknij zawartość pojemnika">×</button></div></div>
      <p class="container-contents__capacity" data-container-capacity></p><p class="game-panel__empty" data-container-contents-empty hidden></p>
      <p class="container-contents__drag-hint" id="container-drag-hint">Przeciągnij do pojemnika lub upuść w odpowiednim slocie.</p>
      <div class="container-contents__grid" data-container-grid role="list" aria-label="Miejsca w pojemniku"></div>
      <nav class="container-contents__pagination" data-container-pagination aria-label="Strony pojemnika" hidden><button type="button" data-container-page-prev aria-label="Poprzednia strona pojemnika">‹</button><span data-container-page-label aria-live="polite"></span><button type="button" data-container-page-next aria-label="Następna strona pojemnika">›</button></nav>
      <p class="container-contents__feedback" data-container-contents-feedback role="status" aria-live="polite"></p><button type="button" class="container-contents__change" data-change-container>Zmień pojemnik</button>
      <section class="container-contents__item-actions" data-container-item-actions role="dialog" aria-labelledby="container-item-details-title" hidden></section>`;
        document.body.append(this.root);
        this.title = this.require("[data-container-contents-title]");
        this.capacity = this.require("[data-container-capacity]");
        this.empty = this.require("[data-container-contents-empty]");
        this.grid = this.require("[data-container-grid]");
        this.feedback = this.require("[data-container-contents-feedback]");
        this.changeButton = this.require("[data-change-container]");
        this.pendingButton = this.require("[data-container-pending]");
        this.pagination = this.require("[data-container-pagination]");
        this.previousButton = this.require("[data-container-page-prev]");
        this.nextButton = this.require("[data-container-page-next]");
        this.pageLabel = this.require("[data-container-page-label]");
        this.popover = this.require("[data-container-item-actions]");
        this.portal = node("div", "", "container-contents container-contents--portal");
        this.portal.append(this.popover);
        document.body.append(this.portal);
        this.drag=new InventoryDragController(this.grid,{
            snapshot:()=>this.snapshot,source:id=>this.visibleItems().find(item=>item.instanceId===id),
            enabled:()=>!this.pending&&!this.destroyed&&!this.root.classList.contains("is-hidden"),
            onStart:()=>{this.feedback.textContent="";delete this.feedback.dataset.state;this.closeSelection(false);},
            onDrop:(id,target)=>{void this.perform(()=>this.handlers.onMoveItem(id,target),"Przeniesiono przedmiot.");},
            ...(this.handlers.onSetContainerSlot ? {onAssignContainer:(id:string,slot:ContainerSlotIndex)=>{
                void this.perform(()=>this.handlers.onSetContainerSlot!(slot,id),"Założono pojemnik.");
            }} : {}),
            canEquip:(item,slot)=>!!this.character && !!this.handlers.onEquipItem && item.equipment?.slot===slot && !equipmentDisabledReason(item,this.character,this.snapshot),
            onEquipDrop:id=>{
                const item=this.visibleItems().find(entry=>entry.instanceId===id);
                if(item&&this.handlers.onEquipItem)void this.perform(()=>this.handlers.onEquipItem!(item),"Założono przedmiot.");
            },
            onStateChange:()=>this.handlers.onTypingChange?.(),
            onMessage:message=>{this.feedback.textContent=message;delete this.feedback.dataset.state;}
        });
        for (const surface of [this.root, this.portal]) {
            for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click"])
                surface.addEventListener(type, event => event.stopPropagation());
            surface.addEventListener("focusin", () => this.handlers.onTypingChange?.());
            surface.addEventListener("focusout", () => queueMicrotask(() => { if (!this.destroyed)
                this.handlers.onTypingChange?.(); }));
            surface.addEventListener("keydown", event => { if (event.key !== "Escape")
                return; event.stopPropagation(); if (this.selectedItemId)
                this.closeSelection(true);
            else
                this.hide(); });
        }
        document.addEventListener("pointerdown", this.onOutsidePointer, true);
        this.require<HTMLButtonElement>("[data-close]").addEventListener("click", () => this.hide());
        this.changeButton.addEventListener("click", () => { if (this.pending || this.destroyed || this.slotIndex === PERMANENT_BACKPACK_SLOT_INDEX || this.assignedContainer()?.permanentContainer)
            return; this.hide(); this.handlers.onChangeContainer(this.slotIndex); });
        this.pendingButton.addEventListener("click", () => { if (this.pending)
            return; this.drag.cancel();this.pendingView = !this.pendingView; this.page = 0; this.closeSelection(false); this.render(); this.pendingButton.focus(); });
        this.previousButton.addEventListener("click", () => this.changePage(-1));
        this.nextButton.addEventListener("click", () => this.changePage(1));
    }
    update(snapshot: InventorySnapshot, character?: CharacterSnapshot): void {
        if (this.destroyed)
            return;
        if (character && this.character?.playerId !== character.playerId) {
            this.drag.cancel();
            this.requestVersion++;
            this.pending = false;
            this.closeSelection(false);
        }
        if (character)
            this.character = character;
        this.dataVersion++;
        this.snapshot = structuredClone(snapshot);
        this.render();
        this.drag.revalidate();
    }
    show(slotIndex: ContainerSlotIndex): void {
        if (this.destroyed || this.pending || !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= CONTAINER_SLOT_COUNT)
            return;
        if (slotIndex === PERMANENT_BACKPACK_SLOT_INDEX && !getPermanentBackpack(this.snapshot)) {
            this.hide();
            return;
        }
        this.slotIndex = slotIndex;
        this.drag.cancel();
        this.page = 0;
        this.pendingView = false;
        this.closeSelection(false);
        this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.feedback.textContent = "";
        delete this.feedback.dataset.state;
        this.root.classList.remove("is-hidden");
        this.render();
        this.require<HTMLButtonElement>("[data-close]").focus();
    }
    hide(): void {
        if (this.destroyed)
            return;
        this.drag.cancel();
        this.requestVersion++;
        this.pending = false;
        this.closeSelection(false);
        this.root.classList.add("is-hidden");
        if (this.returnFocus?.isConnected)
            this.returnFocus.focus();
        this.handlers.onTypingChange?.();
    }
    destroy(): void {
        if (this.destroyed)
            return;
        this.hide();
        this.drag.destroy();
        this.destroyed = true;
        document.removeEventListener("pointerdown", this.onOutsidePointer, true);
        this.root.remove();
        this.portal.remove();
    }
    get isTyping(): boolean { return this.drag.isDragging||(!this.root.classList.contains("is-hidden") && document.activeElement instanceof HTMLElement && (this.root.contains(document.activeElement) || this.portal.contains(document.activeElement)) && document.activeElement.matches("select,input,textarea")); }
    private assignedContainer(): InventoryItem | undefined {
        if (this.slotIndex === PERMANENT_BACKPACK_SLOT_INDEX)
            return getPermanentBackpack(this.snapshot);
        const id = this.snapshot.containerSlots?.[this.slotIndex];
        return this.snapshot.items.find(item => item.instanceId === id && item.category === CONTAINER_ITEM_CATEGORY && !item.containerInstanceId && Number.isSafeInteger(item.containerCapacity) && (item.containerCapacity ?? 0) > 0);
    }
    private visibleItems(): InventoryItem[] {
        if (this.pendingView)
            return getPendingInventoryItems(this.snapshot);
        const container = this.assignedContainer();
        return container ? this.snapshot.items.filter(item => item.containerInstanceId === container.instanceId && !item.equippedSlot) : [];
    }
    private render(): void {
        const focus = document.activeElement instanceof HTMLElement && this.popover.contains(document.activeElement) ? document.activeElement.dataset.containerFocus : undefined;
        const waiting = getPendingInventoryItems(this.snapshot);
        if (this.pendingView && !waiting.length) {
            this.pendingView = false;
            this.page = 0;
            this.closeSelection(false);
        }
        const container = this.assignedContainer(), items = this.visibleItems(), capacity = this.pendingView ? items.length : container?.containerCapacity ?? 0, pageCount = Math.ceil(capacity / PLACES_PER_PAGE);
        this.page = Math.max(0, Math.min(this.page, pageCount - 1));
        this.title.textContent = this.pendingView ? "Oczekujące" : container?.name ?? `Pojemnik ${this.slotIndex + 1}`;
        this.capacity.textContent = this.pendingView ? `Oczekujące przedmioty: ${waiting.length}.` : container ? `${items.length} / ${capacity} zajętych miejsc` : "";
        this.pendingButton.hidden = !waiting.length;
        this.pendingButton.textContent = `Oczekujące (${waiting.length})`;
        this.pendingButton.setAttribute("aria-pressed", String(this.pendingView));
        this.pendingButton.disabled = this.pending;
        this.empty.hidden = this.pendingView || !!container;
        this.empty.textContent = "Brak dostępnego pojemnika w tym slocie. Wybierz pojemnik, aby schować przedmioty.";
        this.changeButton.hidden = this.pendingView || this.slotIndex === PERMANENT_BACKPACK_SLOT_INDEX || !!container?.permanentContainer;
        this.changeButton.disabled = this.pending || this.changeButton.hidden;
        this.root.setAttribute("aria-busy", String(this.pending));
        this.grid.replaceChildren();
        if (container && !this.pendingView) this.grid.dataset.containerDropTarget = container.instanceId;
        else delete this.grid.dataset.containerDropTarget;
        this.grid.hidden = !this.pendingView && !container;
        const start = this.page * PLACES_PER_PAGE, end = Math.min(start + PLACES_PER_PAGE, capacity);
        for (let index = start; index < end; index++) {
            const cell = node("div", "", "container-contents__cell");
            cell.dataset.storageCell = String(index + 1);
            cell.setAttribute("role", "listitem");
            const item = items[index];
            if (item) {
                const button = this.itemButton(item);
                cell.append(button);
            }
            else {
                cell.classList.add("container-contents__cell--empty");
                cell.dataset.containerEmptyCell = "";
                cell.setAttribute("aria-label", `Puste miejsce ${index + 1}`);
            }
            this.grid.append(cell);
        }
        this.pagination.hidden = pageCount <= 1;
        this.previousButton.disabled = this.pending || this.page === 0;
        this.nextButton.disabled = this.pending || this.page >= pageCount - 1;
        this.pageLabel.textContent = `Strona ${this.page + 1} / ${Math.max(1, pageCount)}`;
        if (this.selectedItemId && !items.some(item => item.instanceId === this.selectedItemId))
            this.closeSelection(false);
        this.renderPopover();
        if (focus && !this.pending)
            this.popover.querySelector<HTMLElement>(`[data-container-focus="${focus}"]`)?.focus();
        this.handlers.onTypingChange?.();
    }
    private itemButton(item: InventoryItem): HTMLButtonElement {
        const button = node("button", "", "container-contents__item");
        button.type = "button";
        button.dataset.containerItem = item.instanceId;
        button.disabled = this.pending;
        applyItemQualityFrame(button,item);
        button.removeAttribute("role");
        button.setAttribute("aria-label", `Opcje: ${item.name} ×${item.quantity} · ${itemQualityText(item)}`);
        button.setAttribute("aria-haspopup", "dialog");
        button.setAttribute("aria-describedby","container-drag-hint");
        button.setAttribute("aria-keyshortcuts","Space");
        button.title = `${item.name} ×${item.quantity} · ${itemQualityText(item)}${item.description ? ` — ${item.description}` : ""}`;
        button.append(inventoryItemIcon(item));
        if(item.quantity>1){const quantity=node("span",String(item.quantity),"container-contents__quantity");quantity.dataset.containerQuantity="";quantity.setAttribute("aria-hidden","true");button.append(quantity);}
        button.addEventListener("click", () => {
            if (this.pending || !this.visibleItems().some(entry => entry.instanceId === item.instanceId))
                return;
            if (this.selectedItemId === item.instanceId) {
                this.closeSelection(true);
                return;
            }
            this.feedback.textContent = "";
            delete this.feedback.dataset.state;
            this.selectedItemId = item.instanceId;
            this.renderPopover();
            this.popover.scrollTop = 0;
            this.popover.querySelector<HTMLButtonElement>("[data-container-close-actions]")?.focus();
        });
        return button;
    }
    private equipmentAction(item: InventoryItem): HTMLButtonElement | null {
        if (!item.equipment || item.equippedSlot || !this.handlers.onEquipItem)
            return null;
        const equip = node("button", "Załóż", "container-equipment-action");
        equip.type = "button";
        equip.dataset.containerEquip = item.instanceId;
        equip.dataset.containerFocus="equip";
        equip.setAttribute("aria-label", `Załóż ${item.name}`);
        const reason = equipmentDisabledReason(item, this.character, this.snapshot);
        equip.disabled = this.pending || !!reason;
        if (reason)
            equip.title = reason;
        equip.addEventListener("click", () => { const current = this.visibleItems().find(entry => entry.instanceId === item.instanceId); if (!current || equipmentDisabledReason(current, this.character, this.snapshot) || !this.handlers.onEquipItem)
            return; void this.perform(() => this.handlers.onEquipItem!(current), "Założono przedmiot."); });
        return equip;
    }
    private renderPopover(): void {
        const item = this.visibleItems().find(entry => entry.instanceId === this.selectedItemId);
        this.popover.hidden = !item;
        if (!item)
            return;
        this.popover.replaceChildren();
        const header = node("div", "", "container-contents__actions-header"), close = node("button", "×");
        close.type = "button";
        close.dataset.containerCloseActions = "";
        close.dataset.containerFocus = "close";
        close.setAttribute("aria-label", "Zamknij opcje przedmiotu");
        close.addEventListener("click", () => this.closeSelection(true));
        const identity=node("div","","container-contents__details-identity"),icon=inventoryItemIcon(item),name=node("h3",item.name);
        icon.classList.add("container-contents__details-icon");applyItemQualityFrame(icon,item);name.id="container-item-details-title";identity.append(icon,name);
        header.append(identity, close);
        this.popover.append(header, node("p", item.equipment ? equipmentItemSummary(item) : itemQualityText(item)));
        const metadata=node("dl","","container-contents__details-meta");
        const detail=(label:string,value:string):void=>{const row=node("div");row.append(node("dt",`${label} `),node("dd",value));metadata.append(row);};
        detail("Ilość:",String(item.quantity));
        const rarities={COMMON:"Pospolity",UNCOMMON:"Niepospolity",RARE:"Rzadki",EPIC:"Epicki",LEGENDARY:"Legendarny"};
        detail("Rzadkość:",rarities[item.rarity]);
        if(item.containerCapacity!==undefined)detail("Pojemność:",`${item.containerCapacity} miejsc`);
        if(item.durability!==undefined)detail("Trwałość:",`${item.durability}${item.maxDurability===undefined?"":`/${item.maxDurability}`}`);
        else if(item.maxDurability!==undefined)detail("Maksymalna trwałość:",String(item.maxDurability));
        detail("Ulepszenie:",`+${item.upgradeLevel}`);
        if(item.boundToPlayerId)detail("Przypisanie:","Przypisany do postaci");
        if(item.consumableEffects?.healHp!==undefined)detail("Leczenie:",`${item.consumableEffects.healHp} HP`);
        if(item.consumableEffects?.restoreAp!==undefined)detail("Odnawia:",`${item.consumableEffects.restoreAp} PA`);
        this.popover.append(metadata);
        if (item.description)
            this.popover.append(node("p", item.description));
        if (item.category === "medical" || item.category === "consumable" || item.consumableEffects)
            this.popover.append(node("p", "Do użycia w walce."));
        if (item.category === CONTAINER_ITEM_CATEGORY)
            this.popover.append(node("p", "Aby założyć ten pojemnik, upuść go na slot 2–4 w panelu gry."));
        const equip=this.equipmentAction(item);if(equip)this.popover.append(equip);
        if(this.feedback.textContent){const status=node("p",this.feedback.textContent,"container-contents__details-status");status.setAttribute("role","status");if(this.feedback.dataset.state)status.dataset.state=this.feedback.dataset.state;this.popover.append(status);}
        const anchor = [...this.grid.querySelectorAll<HTMLElement>("[data-container-item]")].find(element => element.dataset.containerItem === item.instanceId), rect = anchor?.getBoundingClientRect(), width = Math.min(360, Math.max(0, window.innerWidth - 24));
        this.popover.style.width = `${width}px`;
        this.popover.style.left = `${Math.max(12, Math.min(rect?.left ?? 12, window.innerWidth - width - 12))}px`;
        this.popover.style.top = `${Math.max(12, Math.min((rect?.bottom ?? 12) + 6, window.innerHeight - Math.min(this.popover.getBoundingClientRect().height || 260, window.innerHeight - 24) - 12))}px`;
    }
    private closeSelection(restore: boolean): void {
        const id = this.selectedItemId;
        this.selectedItemId = null;
        this.popover.hidden = true;
        if (restore && id)
            [...this.grid.querySelectorAll<HTMLButtonElement>("[data-container-item]")].find(button => button.dataset.containerItem === id)?.focus();
        this.handlers.onTypingChange?.();
    }
    private changePage(direction: number): void { if (this.pending || this.destroyed)
        return; this.drag.cancel();this.closeSelection(false); this.page += direction; this.render(); }
    private async perform(action: () => Promise<InventoryUpdateResult>, success: string): Promise<void> {
        if (this.pending || this.destroyed)
            return;
        const version = ++this.requestVersion, dataVersion = this.dataVersion;
        this.pending = true;
        this.feedback.textContent = "Oczekiwanie na potwierdzenie…";
        this.feedback.dataset.state = "pending";
        this.render();
        try {
            const result = await action();
            if (this.destroyed || version !== this.requestVersion)
                return;
            if (result.ok) {
                this.feedback.textContent = success;
                this.feedback.dataset.state = "success";
                this.closeSelection(false);
                if (dataVersion !== this.dataVersion) {
                    this.handlers.onRefresh?.();
                    return;
                }
                this.snapshot = structuredClone(result.inventory);
                this.handlers.onInventoryChanged(result.inventory);
            }
            else {
                this.feedback.textContent = result.message;
                this.feedback.dataset.state = "error";
            }
        }
        catch {
            if (!this.destroyed && version === this.requestVersion) {
                this.feedback.textContent = "Nie udało się wykonać operacji. Sprawdź połączenie i spróbuj ponownie.";
                this.feedback.dataset.state = "error";
            }
        }
        finally {
            if (!this.destroyed && version === this.requestVersion) {
                this.pending = false;
                this.render();
            }
        }
    }
    private require<T extends HTMLElement = HTMLElement>(selector: string): T { const element = this.root.querySelector<T>(selector); if (!element)
        throw new Error(`Container contents element missing: ${selector}`); return element; }
}
