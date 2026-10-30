import { CONTAINER_ITEM_CATEGORY, CONTAINER_SLOT_COUNT, PERMANENT_BACKPACK_SLOT_INDEX, getPendingInventoryItems, type ContainerSlotIndex, type InventoryItem, type InventorySnapshot, type InventoryUpdateResult, type CharacterSnapshot } from "@web-mmorpg/shared";
import { containerIcon } from "./ContainerIcon";
import { equipmentDisabledReason, equipmentIcon, equipmentItemSummary } from "./EquipmentIcon";
import { itemQualityText } from "./ItemQualityFrame";
import { getAssignedContainers, getPermanentBackpack } from "./PermanentBackpack";
import "./ContainerContentsPanel.css";
const PLACES_PER_PAGE = 40;
interface ContainerContentsPanelHandlers {
    onMoveItem: (itemInstanceId: string, targetContainerInstanceId: string) => Promise<InventoryUpdateResult>;
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
    private selectedTargetId = "";
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
      <div class="container-contents__grid" data-container-grid role="list" aria-label="Miejsca w pojemniku"></div>
      <nav class="container-contents__pagination" data-container-pagination aria-label="Strony pojemnika" hidden><button type="button" data-container-page-prev aria-label="Poprzednia strona pojemnika">‹</button><span data-container-page-label aria-live="polite"></span><button type="button" data-container-page-next aria-label="Następna strona pojemnika">›</button></nav>
      <p class="container-contents__feedback" data-container-contents-feedback role="status" aria-live="polite"></p><button type="button" class="container-contents__change" data-change-container>Zmień pojemnik</button>
      <section class="container-contents__item-actions" data-container-item-actions role="dialog" aria-label="Opcje przedmiotu" hidden></section>`;
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
            return; this.pendingView = !this.pendingView; this.page = 0; this.closeSelection(false); this.render(); this.pendingButton.focus(); });
        this.previousButton.addEventListener("click", () => this.changePage(-1));
        this.nextButton.addEventListener("click", () => this.changePage(1));
    }
    update(snapshot: InventorySnapshot, character?: CharacterSnapshot): void {
        if (this.destroyed)
            return;
        if (character && this.character?.playerId !== character.playerId) {
            this.requestVersion++;
            this.pending = false;
            this.closeSelection(false);
        }
        if (character)
            this.character = character;
        this.dataVersion++;
        this.snapshot = structuredClone(snapshot);
        this.render();
    }
    show(slotIndex: ContainerSlotIndex): void {
        if (this.destroyed || this.pending || !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= CONTAINER_SLOT_COUNT)
            return;
        if (slotIndex === PERMANENT_BACKPACK_SLOT_INDEX && !getPermanentBackpack(this.snapshot)) {
            this.hide();
            return;
        }
        this.slotIndex = slotIndex;
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
        this.destroyed = true;
        document.removeEventListener("pointerdown", this.onOutsidePointer, true);
        this.root.remove();
        this.portal.remove();
    }
    get isTyping(): boolean { return !this.root.classList.contains("is-hidden") && document.activeElement instanceof HTMLElement && (this.root.contains(document.activeElement) || this.portal.contains(document.activeElement)) && document.activeElement.matches("select,input,textarea"); }
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
        this.grid.hidden = !this.pendingView && !container;
        const start = this.page * PLACES_PER_PAGE, end = Math.min(start + PLACES_PER_PAGE, capacity);
        for (let index = start; index < end; index++) {
            const cell = node("div", "", "container-contents__cell");
            cell.dataset.storageCell = String(index + 1);
            cell.setAttribute("role", "listitem");
            const item = items[index];
            if (item) {
                const button = this.itemButton(item);
                cell.append(this.withEquipmentAction(item, button));
            }
            else {
                cell.classList.add("container-contents__cell--empty");
                cell.dataset.containerEmptyCell = "";
                cell.setAttribute("aria-label", `Puste miejsce ${index + 1}`);
                const label = node("span", String(index + 1));
                label.setAttribute("aria-hidden", "true");
                cell.append(label);
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
        button.setAttribute("aria-label", `Opcje: ${item.name} ×${item.quantity} · ${itemQualityText(item)}`);
        button.setAttribute("aria-haspopup", "dialog");
        button.title = `${item.name} ×${item.quantity} · ${itemQualityText(item)}${item.description ? ` — ${item.description}` : ""}`;
        const text = node("span", "", "container-contents__item-text");
        text.append(node("strong", item.name), node("span", `×${item.quantity}`, "container-contents__quantity"));
        button.append(item.equipment ? equipmentIcon(item) : containerIcon(item), text);
        button.addEventListener("click", () => { if (this.pending || !this.visibleItems().some(entry => entry.instanceId === item.instanceId))
            return; if (this.selectedItemId === item.instanceId) {
            this.closeSelection(true);
            return;
        } this.selectedItemId = item.instanceId; this.selectedTargetId = ""; this.renderPopover(); this.popover.querySelector<HTMLButtonElement>("[data-container-close-actions]")?.focus(); });
        return button;
    }
    private withEquipmentAction(item: InventoryItem, button: HTMLButtonElement): HTMLElement {
        if (!item.equipment || item.equippedSlot || !this.handlers.onEquipItem)
            return button;
        const row = node("div", "", "container-equipment-row");
        const equip = node("button", "Załóż", "container-equipment-action");
        equip.type = "button";
        equip.dataset.containerEquip = item.instanceId;
        equip.setAttribute("aria-label", `Załóż ${item.name}`);
        const reason = equipmentDisabledReason(item, this.character, this.snapshot);
        equip.disabled = this.pending || !!reason;
        if (reason)
            equip.title = reason;
        equip.addEventListener("click", () => { const current = this.visibleItems().find(entry => entry.instanceId === item.instanceId); if (!current || equipmentDisabledReason(current, this.character, this.snapshot) || !this.handlers.onEquipItem)
            return; void this.perform(() => this.handlers.onEquipItem!(current), "Założono przedmiot."); });
        row.append(button, equip);
        return row;
    }
    private moveTargets(item: InventoryItem): Array<{
        item: InventoryItem;
        free: number;
    }> {
        const seen = new Set<string>(), targets: Array<{
            item: InventoryItem;
            free: number;
        }> = [];
        for (const target of getAssignedContainers(this.snapshot)) {
            if (seen.has(target.instanceId) || target.instanceId === item.instanceId || target.instanceId === item.containerInstanceId)
                continue;
            seen.add(target.instanceId);
            const used = this.snapshot.items.filter(entry => entry.containerInstanceId === target.instanceId && !entry.equippedSlot).length;
            targets.push({ item: target, free: Math.max(0, target.containerCapacity! - used) });
        }
        return targets;
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
        header.append(node("strong", `${item.name} ×${item.quantity}`), close);
        this.popover.append(header, node("p", item.equipment ? equipmentItemSummary(item) : itemQualityText(item)));
        if (item.description)
            this.popover.append(node("p", item.description));
        if (item.category === "medical" || item.category === "consumable" || item.consumableEffects)
            this.popover.append(node("p", "Do użycia w walce."));
        if (item.category === CONTAINER_ITEM_CATEGORY)
            this.popover.append(node("p", "Ten pojemnik możesz założyć w jednym z trzech slotów panelu gry."));
        const nonempty = item.category === CONTAINER_ITEM_CATEGORY && this.snapshot.items.some(entry => entry.containerInstanceId === item.instanceId), targets = this.moveTargets(item);
        const label = node("label", "Przenieś do"), select = node("select");
        select.dataset.containerMoveTarget = "";
        select.dataset.containerFocus = "target";
        for (const target of targets) {
            const option = node("option", `${target.item.name} · wolne ${target.free}/${target.item.containerCapacity}`);
            option.value = target.item.instanceId;
            option.disabled = nonempty || target.free === 0;
            select.append(option);
        }
        if (!targets.some(target => target.item.instanceId === this.selectedTargetId && target.free > 0))
            this.selectedTargetId = nonempty ? "" : targets.find(target => target.free > 0)?.item.instanceId ?? "";
        if (!targets.length)
            select.append(node("option", "Brak wolnego miejsca"));
        select.value = this.selectedTargetId;
        select.disabled = this.pending || nonempty || !this.selectedTargetId;
        select.addEventListener("change", () => { this.selectedTargetId = select.value; });
        label.append(select);
        const move = node("button", "Przenieś");
        move.type = "button";
        move.dataset.containerMove = "";
        move.dataset.containerFocus = "move";
        move.disabled = this.pending || nonempty || !this.selectedTargetId;
        move.addEventListener("click", () => { const current = this.visibleItems().find(entry => entry.instanceId === item.instanceId), target = this.selectedTargetId; if (!current || !target || current.permanentContainer || (this.moveTargets(current).find(entry => entry.item.instanceId === target)?.free ?? 0) <= 0)
            return; if (current.category === CONTAINER_ITEM_CATEGORY && this.snapshot.items.some(entry => entry.containerInstanceId === current.instanceId))
            return; void this.perform(() => this.handlers.onMoveItem(current.instanceId, target), "Przeniesiono przedmiot."); });
        this.popover.append(label, move);
        if (nonempty)
            this.popover.append(node("p", "Ten pojemnik zawiera przedmioty i nie może trafić do innego pojemnika."));
        else if (!this.selectedTargetId)
            this.popover.append(node("p", "Brak wolnego miejsca w innych założonych pojemnikach."));
        const anchor = [...this.grid.querySelectorAll<HTMLElement>("[data-container-item]")].find(element => element.dataset.containerItem === item.instanceId), rect = anchor?.getBoundingClientRect(), width = Math.min(320, Math.max(0, window.innerWidth - 24));
        this.popover.style.width = `${width}px`;
        this.popover.style.left = `${Math.max(12, Math.min(rect?.left ?? 12, window.innerWidth - width - 12))}px`;
        this.popover.style.top = `${Math.max(12, Math.min((rect?.bottom ?? 12) + 6, window.innerHeight - Math.min(this.popover.getBoundingClientRect().height || 260, window.innerHeight - 24) - 12))}px`;
    }
    private closeSelection(restore: boolean): void {
        const id = this.selectedItemId;
        this.selectedItemId = null;
        this.selectedTargetId = "";
        this.popover.hidden = true;
        if (restore && id)
            [...this.grid.querySelectorAll<HTMLButtonElement>("[data-container-item]")].find(button => button.dataset.containerItem === id)?.focus();
        this.handlers.onTypingChange?.();
    }
    private changePage(direction: number): void { if (this.pending || this.destroyed)
        return; this.closeSelection(false); this.page += direction; this.render(); }
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
