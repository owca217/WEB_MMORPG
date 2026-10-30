import {
  CONTAINER_ITEM_CATEGORY,
  CONTAINER_SLOT_COUNT,
  type ContainerSlotIndex,
  type InventoryItem,
  type InventorySnapshot,
  type InventoryUpdateResult,
  type CharacterSnapshot
} from "@web-mmorpg/shared";
import { containerIcon } from "./ContainerIcon";
import { equipmentDisabledReason, equipmentIcon } from "./EquipmentIcon";
import "./ContainerContentsPanel.css";

const PLACES_PER_PAGE = 40;

interface ContainerContentsPanelHandlers {
  onMoveItem: (itemInstanceId: string, targetContainerInstanceId: string | null) => Promise<InventoryUpdateResult>;
  onInventoryChanged: (inventory: InventorySnapshot) => void;
  onChangeContainer: (slotIndex: ContainerSlotIndex) => void;
  onEquipItem?: (item:InventoryItem)=>Promise<InventoryUpdateResult>;
}

export class ContainerContentsPanel {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLElement;
  private readonly capacity: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly grid: HTMLDivElement;
  private readonly candidates: HTMLDivElement;
  private readonly candidatesSection: HTMLElement;
  private readonly feedback: HTMLElement;
  private readonly changeButton: HTMLButtonElement;
  private readonly pagination: HTMLElement;
  private readonly previousButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly pageLabel: HTMLElement;
  private snapshot: InventorySnapshot = { items: [] };
  private character:CharacterSnapshot|undefined;
  private equipmentRequestVersion=0;
  private slotIndex: ContainerSlotIndex = 0;
  private page = 0;
  private pending = false;
  private destroyed = false;
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly handlers: ContainerContentsPanelHandlers) {
    this.root = document.createElement("div");
    this.root.className = "game-panel container-contents is-hidden";
    this.root.dataset.containerContents = "";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-labelledby", "container-contents-title");
    this.root.innerHTML = `
      <div class="game-panel__header">
        <h2 id="container-contents-title" data-container-contents-title>Pojemnik</h2>
        <button type="button" data-close aria-label="Zamknij zawartość pojemnika">×</button>
      </div>
      <p class="container-contents__capacity" data-container-capacity></p>
      <p class="game-panel__empty" data-container-contents-empty hidden></p>
      <div class="container-contents__grid" data-container-grid role="list" aria-label="Miejsca w pojemniku"></div>
      <nav class="container-contents__pagination" data-container-pagination aria-label="Strony pojemnika" hidden>
        <button type="button" data-container-page-prev aria-label="Poprzednia strona pojemnika">‹</button>
        <span data-container-page-label aria-live="polite"></span>
        <button type="button" data-container-page-next aria-label="Następna strona pojemnika">›</button>
      </nav>
      <section class="container-contents__candidates" data-container-candidates-section>
        <h3>Włóż do pojemnika</h3>
        <p class="container-contents__description">Wybierz przedmiot poniżej, aby go schować. Kliknij przedmiot w pojemniku, aby go wyjąć.</p>
        <div class="container-contents__list" data-container-candidates></div>
      </section>
      <p class="container-contents__feedback" data-container-contents-feedback role="status" aria-live="polite"></p>
      <button type="button" class="container-contents__change" data-change-container>Zmień pojemnik</button>
    `;
    document.body.appendChild(this.root);
    this.title = this.require("[data-container-contents-title]");
    this.capacity = this.require("[data-container-capacity]");
    this.empty = this.require("[data-container-contents-empty]");
    this.grid = this.require<HTMLDivElement>("[data-container-grid]");
    this.candidates = this.require<HTMLDivElement>("[data-container-candidates]");
    this.candidatesSection = this.require("[data-container-candidates-section]");
    this.feedback = this.require("[data-container-contents-feedback]");
    this.changeButton = this.require<HTMLButtonElement>("[data-change-container]");
    this.pagination = this.require("[data-container-pagination]");
    this.previousButton = this.require<HTMLButtonElement>("[data-container-page-prev]");
    this.nextButton = this.require<HTMLButtonElement>("[data-container-page-next]");
    this.pageLabel = this.require("[data-container-page-label]");
    this.require("[data-close]").addEventListener("click", () => this.hide());
    this.changeButton.addEventListener("click", () => {
      if (this.pending || this.destroyed) return;
      this.hide();
      this.handlers.onChangeContainer(this.slotIndex);
    });
    this.previousButton.addEventListener("click", () => this.changePage(-1));
    this.nextButton.addEventListener("click", () => this.changePage(1));
    this.root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.stopPropagation(); this.hide(); }
    });
  }

  update(snapshot: InventorySnapshot,character?:CharacterSnapshot): void {
    if (this.destroyed) return;
    if(character && this.character?.playerId!==character.playerId)this.equipmentRequestVersion++;
    if(character)this.character=character;
    this.snapshot = snapshot;
    this.render();
  }

  show(slotIndex: ContainerSlotIndex): void {
    if (this.destroyed || this.pending || !Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= CONTAINER_SLOT_COUNT) return;
    this.slotIndex = slotIndex;
    this.page = 0;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.feedback.textContent = "";
    delete this.feedback.dataset.state;
    this.root.classList.remove("is-hidden");
    this.render();
    this.require<HTMLButtonElement>("[data-close]").focus();
  }

  hide(): void {
    if (this.destroyed) return;
    this.equipmentRequestVersion++;
    this.root.classList.add("is-hidden");
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
  }

  destroy(): void {
    this.destroyed = true;
    this.equipmentRequestVersion++;
    this.root.remove();
  }

  private assignedContainer(): InventoryItem | undefined {
    const assignedId = this.snapshot.containerSlots?.[this.slotIndex];
    return this.snapshot.items.find((item) => item.instanceId === assignedId
      && item.category === CONTAINER_ITEM_CATEGORY
      && !item.containerInstanceId
      && Number.isSafeInteger(item.containerCapacity)
      && (item.containerCapacity ?? 0) > 0);
  }

  private render(): void {
    const container = this.assignedContainer();
    const capacity = container?.containerCapacity ?? 0;
    const contents = container ? this.snapshot.items.filter((item) => item.containerInstanceId === container.instanceId && !item.equippedSlot) : [];
    const pageCount = Math.ceil(capacity / PLACES_PER_PAGE);
    this.page = Math.max(0, Math.min(this.page, pageCount - 1));
    this.title.textContent = container?.name ?? `Pojemnik ${this.slotIndex + 1}`;
    this.capacity.textContent = container ? `${contents.length} / ${capacity} zajętych miejsc` : "";
    this.empty.hidden = !!container;
    this.empty.textContent = container ? "" : "Brak dostępnego pojemnika w tym slocie. Wybierz pojemnik, aby schować przedmioty.";
    this.changeButton.disabled = this.pending;
    this.root.setAttribute("aria-busy", `${this.pending}`);
    this.grid.replaceChildren();
    this.grid.hidden = !container;
    const start = this.page * PLACES_PER_PAGE;
    const end = Math.min(start + PLACES_PER_PAGE, capacity);
    for (let index = start; index < end; index++) {
      const cell = document.createElement("div");
      cell.className = "container-contents__cell";
      cell.dataset.storageCell = `${index + 1}`;
      cell.setAttribute("role", "listitem");
      const item = contents[index];
      if (item) {
        const button = this.itemButton(item, "remove");
        button.disabled = this.pending;
        button.addEventListener("click", () => { void this.moveItem(item.instanceId, null); });
        cell.appendChild(this.withEquipmentAction(item,button));
      } else {
        cell.classList.add("container-contents__cell--empty");
        cell.dataset.containerEmptyCell = "";
        cell.setAttribute("aria-label", `Puste miejsce ${index + 1}`);
        const label = document.createElement("span");
        label.textContent = `${index + 1}`;
        label.setAttribute("aria-hidden", "true");
        cell.appendChild(label);
      }
      this.grid.appendChild(cell);
    }
    this.pagination.hidden = pageCount <= 1;
    this.previousButton.disabled = this.pending || this.page === 0;
    this.nextButton.disabled = this.pending || this.page >= pageCount - 1;
    this.pageLabel.textContent = `Strona ${this.page + 1} / ${Math.max(1, pageCount)}`;
    this.candidatesSection.hidden = !container;
    this.candidates.replaceChildren();
    if (!container) return;

    const assignedIds = new Set(this.snapshot.containerSlots?.filter((id) => id !== null));
    const nonemptyIds = new Set(this.snapshot.items.map((item) => item.containerInstanceId).filter((id) => !!id));
    const eligible = this.snapshot.items.filter((item) => !item.containerInstanceId
      && !item.equippedSlot
      && item.instanceId !== container.instanceId
      && !assignedIds.has(item.instanceId)
      && !(item.category === CONTAINER_ITEM_CATEGORY && nonemptyIds.has(item.instanceId)));
    if (eligible.length === 0) {
      const empty = document.createElement("p");
      empty.className = "game-panel__empty";
      empty.textContent = "Nie masz przedmiotów, które można tu włożyć.";
      this.candidates.appendChild(empty);
    }
    for (const item of eligible) {
      const button = this.itemButton(item, "put");
      button.disabled = this.pending || contents.length >= capacity;
      button.addEventListener("click", () => { void this.moveItem(item.instanceId, container.instanceId); });
      this.candidates.appendChild(this.withEquipmentAction(item,button));
    }
  }

  private itemButton(item: InventoryItem, action: "put" | "remove"): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `container-contents__item container-contents__item--${action}`;
    if (action === "put") button.dataset.containerPut = item.instanceId;
    else button.dataset.containerRemove = item.instanceId;
    button.setAttribute("aria-label", `${action === "put" ? "Włóż" : "Wyjmij"} ${item.name} ×${item.quantity}`);
    button.title = `${item.name} ×${item.quantity}${item.description ? ` — ${item.description}` : ""}`;
    const content = document.createElement("span");
    content.className = "container-contents__item-text";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const quantity = document.createElement("span");
    quantity.className = "container-contents__quantity";
    quantity.textContent = `×${item.quantity}`;
    content.append(name, quantity);
    button.append(item.equipment?equipmentIcon(item):containerIcon(item), content);
    return button;
  }

  private withEquipmentAction(item:InventoryItem,storageButton:HTMLButtonElement):HTMLElement {
    if(!item.equipment || item.equippedSlot || !this.handlers.onEquipItem)return storageButton;
    const row=document.createElement("div");row.className="container-equipment-row";
    const equip=document.createElement("button");equip.type="button";equip.className="container-equipment-action";equip.dataset.containerEquip=item.instanceId;
    equip.textContent="Załóż";equip.setAttribute("aria-label",`Załóż ${item.name}`);
    const reason=equipmentDisabledReason(item,this.character,this.snapshot);equip.disabled=this.pending||!!reason;if(reason)equip.title=reason;
    equip.addEventListener("click",()=>{void this.equipItem(item);});row.append(storageButton,equip);return row;
  }

  private async equipItem(item:InventoryItem):Promise<void> {
    if(this.pending||this.destroyed||!this.handlers.onEquipItem||equipmentDisabledReason(item,this.character,this.snapshot))return;
    const version=++this.equipmentRequestVersion;this.pending=true;this.feedback.textContent="Zakładanie przedmiotu…";this.render();
    try {
      const result=await this.handlers.onEquipItem(item);
      if(this.destroyed||version!==this.equipmentRequestVersion)return;
      if(result.ok){this.snapshot=result.inventory;this.feedback.textContent="Założono przedmiot.";this.handlers.onInventoryChanged(result.inventory);}
      else this.feedback.textContent=result.message;
    }catch{if(!this.destroyed&&version===this.equipmentRequestVersion)this.feedback.textContent="Nie udało się założyć przedmiotu. Sprawdź uzbrojenie i spróbuj ponownie.";}
    finally{this.pending=false;if(!this.destroyed)this.render();}
  }

  private changePage(direction: number): void {
    if (this.pending || this.destroyed) return;
    this.page += direction;
    this.render();
  }

  private async moveItem(itemInstanceId: string, targetContainerInstanceId: string | null): Promise<void> {
    if (this.pending || this.destroyed) return;
    this.pending = true;
    this.feedback.textContent = "Przenoszenie przedmiotu…";
    this.feedback.dataset.state = "pending";
    this.render();
    try {
      const result = await this.handlers.onMoveItem(itemInstanceId, targetContainerInstanceId);
      if (this.destroyed) return;
      if (result.ok) {
        this.snapshot = result.inventory;
        this.feedback.textContent = targetContainerInstanceId ? "Włożono przedmiot do pojemnika." : "Wyjęto przedmiot z pojemnika.";
        this.feedback.dataset.state = "success";
        this.handlers.onInventoryChanged(result.inventory);
      } else {
        this.feedback.textContent = result.message;
        this.feedback.dataset.state = "error";
      }
    } catch {
      if (this.destroyed) return;
      this.feedback.textContent = "Nie udało się przenieść przedmiotu. Spróbuj ponownie.";
      this.feedback.dataset.state = "error";
    } finally {
      this.pending = false;
      if (!this.destroyed) this.render();
    }
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Container contents element missing: ${selector}`);
    return element;
  }
}
