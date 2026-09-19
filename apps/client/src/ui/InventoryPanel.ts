import type { InventorySnapshot } from "@web-mmorpg/shared";
import { InterfaceWindowControls } from "./InterfaceWindowControls";

const CATEGORY_LABELS = {
  material: "Materiał",
  medical: "Medyczne"
} as const;

export class InventoryPanel {
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly windowControls: InterfaceWindowControls;

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "game-panel game-panel--inventory is-hidden";
    this.root.innerHTML = `
      <div class="game-panel__header">
        <h2>Ekwipunek</h2>
      </div>
      <div class="inventory-list" data-list></div>
    `;
    document.body.appendChild(this.root);
    this.list = this.require<HTMLDivElement>("[data-list]");
    this.windowControls = new InterfaceWindowControls({
      root: this.root,
      header: this.require<HTMLElement>(".game-panel__header"),
      onClose: () => this.hide()
    });
  }

  update(snapshot: InventorySnapshot): void {
    this.list.replaceChildren();

    if (snapshot.items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "game-panel__empty";
      empty.textContent = "Ekwipunek jest pusty.";
      this.list.appendChild(empty);
      return;
    }

    for (const item of snapshot.items) {
      const row = document.createElement("article");
      row.className = "inventory-item";

      const icon = document.createElement("div");
      icon.className = `inventory-item__icon inventory-item__icon--${item.category}`;
      icon.textContent = item.category === "medical" ? "+" : "◆";

      const content = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${item.name} ×${item.quantity}`;
      const category = document.createElement("span");
      category.textContent = CATEGORY_LABELS[item.category];
      const description = document.createElement("p");
      description.textContent = item.description;
      content.append(title, category, description);

      row.append(icon, content);
      this.list.appendChild(row);
    }
  }

  show(): void {
    this.root.classList.remove("is-hidden");
  }

  hide(): void {
    this.root.classList.add("is-hidden");
  }

  toggle(): void {
    this.root.classList.toggle("is-hidden");
  }

  destroy(): void {
    this.windowControls.destroy();
    this.root.remove();
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Inventory panel element missing: ${selector}`);
    return element;
  }
}
