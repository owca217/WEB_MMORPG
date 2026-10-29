import { CONTAINER_ITEM_CATEGORY, CONTAINER_SLOT_COUNT, type ContainerSlotIndex, type InventorySnapshot, type PlayerStateSnapshot, type UserRole } from "@web-mmorpg/shared";
import type { BattleResultSummary, ConnectionState } from "../net/GameSocket";
import { containerIcon } from "./ContainerIcon";
import { experienceProgressMarkup } from "./ExperienceProgress";

interface WorldHudHandlers {
  onInventory?: () => void;
  onContainerSlot?: (slotIndex: ContainerSlotIndex) => void;
  onCharacter: () => void;
  onAdmin: () => void;
  onLogout?: () => void;
}

export class WorldHud {
  private readonly root: HTMLDivElement;
  private readonly name: HTMLElement;
  private readonly hp: HTMLElement;
  private readonly level: HTMLElement;
  private readonly experience: HTMLElement;
  private readonly battleResult: HTMLElement;
  private readonly ap: HTMLElement;
  private readonly gold: HTMLElement;
  private readonly connection: HTMLElement;
  private readonly adminButton: HTMLButtonElement;
  private readonly containerSlots: HTMLButtonElement[] = [];
  private readonly content: HTMLElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly compactViewport: MediaQueryList | null;
  private collapsed = false;
  private readonly onViewportChange = (): void => {
    if (!this.compactViewport?.matches) this.collapsed = false;
    this.updateVisibility();
  };

  constructor(handlers: WorldHudHandlers) {
    this.root = document.createElement("div");
    this.root.className = "world-hud";
    this.root.innerHTML = `
      <button type="button" class="world-hud__toggle" data-hud-toggle aria-controls="world-hud-content" aria-expanded="true" aria-label="Zwiń panel gry" hidden>
        <svg class="world-hud__toggle-collapse" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><path d="m6 14 6-6 6 6"/></svg>
        <svg class="world-hud__toggle-expand" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 9h18M8 13h2m-2 3h2m4-3h3m-3 3h3"/></svg>
      </button>
      <div class="world-hud__content" id="world-hud-content" data-hud-content>
      <div class="world-hud__identity">
        <strong data-name>—</strong>
        <span data-connection>Łączenie…</span>
      </div>
      <div class="world-hud__stats">
        <span>Poziom <b data-level>—</b></span>
        <span>HP <b data-hp>—</b></span>
        <span>AP <b data-ap>—</b></span>
        <span>Złoto <b data-gold>—</b></span>
      </div>
      <div data-experience-container></div>
      <p class="world-hud__battle-result" data-battle-result role="status" hidden></p>
      <div class="world-hud__containers" aria-label="Pojemniki">
        <span class="world-hud__container-title">Pojemniki</span>
        <div class="world-hud__container-slots" data-container-slots></div>
      </div>
      <div class="world-hud__actions">
        <button type="button" data-character>Postać</button>
        <button type="button" data-admin hidden>Panel ADMIN</button>
        <button type="button" data-logout>Wyloguj</button>
      </div>
      </div>
    `;
    document.body.appendChild(this.root);

    this.content = this.require("[data-hud-content]");
    this.toggleButton = this.require<HTMLButtonElement>("[data-hud-toggle]");
    this.compactViewport = typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 600px), (max-height: 500px) and (orientation: landscape)")
      : null;
    this.compactViewport?.addEventListener("change", this.onViewportChange);
    this.toggleButton.addEventListener("click", () => {
      if (!this.compactViewport?.matches) return;
      this.collapsed = !this.collapsed;
      this.updateVisibility();
    });
    this.updateVisibility();
    this.name = this.require("[data-name]");
    this.hp = this.require("[data-hp]");
    this.level = this.require("[data-level]");
    this.experience = this.require("[data-experience-container]");
    this.battleResult = this.require("[data-battle-result]");
    this.ap = this.require("[data-ap]");
    this.gold = this.require("[data-gold]");
    this.connection = this.require("[data-connection]");
    this.adminButton = this.require<HTMLButtonElement>("[data-admin]");
    const slots = this.require("[data-container-slots]");
    for (let slotIndex = 0; slotIndex < CONTAINER_SLOT_COUNT; slotIndex += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "world-hud__container-slot";
      button.dataset.containerSlot = `${slotIndex}`;
      button.setAttribute("aria-haspopup", "dialog");
      button.addEventListener("click", () => handlers.onContainerSlot?.(slotIndex as ContainerSlotIndex));
      slots.appendChild(button);
      this.containerSlots.push(button);
    }
    this.updateInventory({ items: [] });
    this.require<HTMLButtonElement>("[data-character]").addEventListener("click", handlers.onCharacter);
    this.adminButton.addEventListener("click", handlers.onAdmin);
    this.require<HTMLButtonElement>("[data-logout]").addEventListener(
      "click",
      handlers.onLogout ?? (() => undefined)
    );
  }

  updateSession(role: UserRole): void {
    this.adminButton.hidden = role !== "ADMIN";
  }

  update(state: PlayerStateSnapshot): void {
    const character = state.character;
    this.name.textContent = character.nickname;
    this.hp.textContent = `${character.hp}/${character.maxHp}`;
    this.level.textContent = `${character.level}`;
    this.experience.innerHTML = experienceProgressMarkup(character);
    this.ap.textContent = `${character.maxAp}`;
    this.gold.textContent = state.gold === undefined ? "—" : `${state.gold}`;
    this.updateInventory(state.inventory);
  }

  updateInventory(inventory: InventorySnapshot): void {
    this.containerSlots.forEach((button, slotIndex) => {
      const instanceId = inventory.containerSlots?.[slotIndex];
      const item = inventory.items.find((candidate) => candidate.instanceId === instanceId && candidate.category === CONTAINER_ITEM_CATEGORY && !candidate.containerInstanceId);
      const number = document.createElement("span");
      number.className = "world-hud__container-number";
      number.textContent = `${slotIndex + 1}`;
      const label = document.createElement("span");
      label.className = "world-hud__container-name";
      label.textContent = item?.name ?? "Pusty";
      button.title = `Pojemnik ${slotIndex + 1}: ${item?.name ?? "pusty"}`;
      button.setAttribute("aria-label", `${button.title}. Wybierz pojemnik`);
      button.classList.toggle("is-equipped", Boolean(item));
      button.classList.toggle("is-empty", !item);
      button.replaceChildren(containerIcon(item));
      if (item) button.prepend(number);
      if (item) button.append(label);
    });
  }

  showBattleResult(result: BattleResultSummary): void {
    const outcome = result.outcome === "victory" ? "Zwycięstwo!" : "Porażka.";
    const growth = result.levelsGained > 0 ? ` Awans na poziom ${result.level}!` : "";
    const party = result.partyBonusExperience ? ` (w tym premia drużyny: +${result.partyBonusExperience} XP)` : "";
    const gold = result.goldGained ? ` +${result.goldGained} złota.` : "";
    this.battleResult.textContent = `${outcome} +${result.experienceGained} XP${party}.${gold}${growth}`;
    this.battleResult.hidden = false;
  }

  setConnectionState(state: ConnectionState): void {
    this.connection.dataset.state = state;
    this.connection.textContent =
      state === "connected"
        ? "Połączono"
        : state === "connecting"
          ? "Ponowne łączenie…"
          : "Brak połączenia z serwerem";
  }

  destroy(): void {
    this.compactViewport?.removeEventListener("change", this.onViewportChange);
    this.root.remove();
  }

  private updateVisibility(): void {
    const compact = this.compactViewport?.matches ?? false;
    const collapsed = compact && this.collapsed;
    this.toggleButton.hidden = !compact;
    this.content.hidden = collapsed;
    this.root.classList.toggle("is-collapsed", collapsed);
    this.toggleButton.setAttribute("aria-expanded", `${!collapsed}`);
    const label = collapsed ? "Rozwiń panel gry" : "Zwiń panel gry";
    this.toggleButton.setAttribute("aria-label", label);
    this.toggleButton.title = label;
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`World HUD element missing: ${selector}`);
    return element;
  }
}
