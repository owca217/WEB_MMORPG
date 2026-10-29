import { CONTAINER_ITEM_CATEGORY, CONTAINER_SLOT_COUNT, type ContainerSlotIndex, type InventorySnapshot, type SetContainerSlotResult } from "@web-mmorpg/shared";
import { containerIcon } from "./ContainerIcon";

interface ContainerPickerHandlers {
  onSetContainerSlot: (slotIndex: ContainerSlotIndex, itemInstanceId: string | null) => Promise<SetContainerSlotResult>;
  onInventoryChanged: (inventory: InventorySnapshot) => void;
}

export class ContainerPicker {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLElement;
  private readonly list: HTMLDivElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly feedback: HTMLElement;
  private snapshot: InventorySnapshot = { items: [] };
  private slotIndex: ContainerSlotIndex = 0;
  private pending = false;
  private destroyed = false;
  private returnFocus: HTMLElement | null = null;

  constructor(private readonly handlers: ContainerPickerHandlers) {
    this.root = document.createElement("div");
    this.root.className = "game-panel game-panel--containers is-hidden";
    this.root.dataset.containerPicker = "";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-labelledby", "container-picker-title");
    this.root.innerHTML = `
      <div class="game-panel__header">
        <h2 id="container-picker-title" data-container-picker-title>Pojemnik 1</h2>
        <button type="button" data-close aria-label="Zamknij wybór pojemnika">×</button>
      </div>
      <p class="container-picker__description">Wybierz pojemnik do tego slotu. Założony w innym slocie zostanie przeniesiony.</p>
      <div class="container-picker__list" data-container-list></div>
      <p class="container-picker__feedback" data-container-feedback role="status" aria-live="polite"></p>
      <button type="button" class="container-picker__clear" data-container-clear>Zdejmij pojemnik</button>
    `;
    document.body.appendChild(this.root);
    this.title = this.require("[data-container-picker-title]");
    this.list = this.require("[data-container-list]");
    this.clearButton = this.require<HTMLButtonElement>("[data-container-clear]");
    this.feedback = this.require("[data-container-feedback]");
    this.clearButton.addEventListener("click", () => { void this.setSlot(null); });
    this.require("[data-close]").addEventListener("click", () => this.hide());
    this.root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.stopPropagation(); this.hide(); }
    });
  }

  update(snapshot: InventorySnapshot): void {
    this.snapshot = snapshot;
    this.render();
  }

  show(slotIndex: ContainerSlotIndex): void {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= CONTAINER_SLOT_COUNT || this.pending) return;
    this.slotIndex = slotIndex;
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.feedback.textContent = "";
    this.root.classList.remove("is-hidden");
    this.render();
    this.require<HTMLButtonElement>("[data-close]").focus();
  }

  hide(): void {
    this.root.classList.add("is-hidden");
    if (this.returnFocus?.isConnected) this.returnFocus.focus();
  }

  destroy(): void {
    this.destroyed = true;
    this.root.remove();
  }

  private render(): void {
    this.title.textContent = `Pojemnik ${this.slotIndex + 1}`;
    this.clearButton.disabled = this.pending || !this.snapshot.containerSlots?.[this.slotIndex];
    this.root.setAttribute("aria-busy", `${this.pending}`);
    this.list.replaceChildren();
    const containers = this.snapshot.items.filter((item) => item.category === CONTAINER_ITEM_CATEGORY && !item.containerInstanceId);
    if (containers.length === 0) {
      const empty = document.createElement("p");
      empty.className = "game-panel__empty";
      empty.textContent = "Nie masz jeszcze żadnych pojemników.";
      this.list.appendChild(empty);
    }
    for (const item of containers) {
      const equippedIndex = this.snapshot.containerSlots?.findIndex((id) => id === item.instanceId) ?? -1;
      const selected = equippedIndex === this.slotIndex;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "container-picker__choice";
      button.dataset.containerInstance = item.instanceId;
      button.disabled = this.pending || selected;
      const content = document.createElement("span");
      content.className = "container-picker__content";
      const name = document.createElement("strong");
      name.textContent = item.name;
      const description = document.createElement("span");
      description.textContent = item.description;
      const action = document.createElement("span");
      action.className = "container-picker__action";
      action.textContent = selected ? "Założony tutaj" : equippedIndex >= 0 ? `Przenieś ze slotu ${equippedIndex + 1}` : "Załóż tutaj";
      content.append(name, description, action);
      button.append(containerIcon(item), content);
      button.addEventListener("click", () => { void this.setSlot(item.instanceId); });
      this.list.appendChild(button);
    }
  }

  private async setSlot(itemInstanceId: string | null): Promise<void> {
    if (this.pending) return;
    this.pending = true;
    this.feedback.textContent = "Zapisywanie…";
    this.feedback.dataset.state = "pending";
    this.render();
    try {
      const result = await this.handlers.onSetContainerSlot(this.slotIndex, itemInstanceId);
      if (this.destroyed) return;
      if (result.ok) {
        this.snapshot = result.inventory;
        this.handlers.onInventoryChanged(result.inventory);
        this.hide();
      } else {
        this.feedback.textContent = result.message;
        this.feedback.dataset.state = "error";
      }
    } catch {
      if (this.destroyed) return;
      this.feedback.textContent = "Nie udało się zapisać pojemnika. Spróbuj ponownie.";
      this.feedback.dataset.state = "error";
    } finally {
      this.pending = false;
      if (!this.destroyed) this.render();
    }
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Container picker element missing: ${selector}`);
    return element;
  }
}
