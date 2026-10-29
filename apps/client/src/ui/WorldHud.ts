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
  private readonly connection: HTMLElement;
  private readonly adminButton: HTMLButtonElement;
  private readonly containerSlots: HTMLButtonElement[] = [];

  constructor(handlers: WorldHudHandlers) {
    this.root = document.createElement("div");
    this.root.className = "world-hud";
    this.root.innerHTML = `
      <div class="world-hud__identity">
        <strong data-name>—</strong>
        <span data-connection>Łączenie…</span>
      </div>
      <div class="world-hud__stats">
        <span>Poziom <b data-level>—</b></span>
        <span>HP <b data-hp>—</b></span>
        <span>AP <b data-ap>—</b></span>
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
    `;
    document.body.appendChild(this.root);

    this.name = this.require("[data-name]");
    this.hp = this.require("[data-hp]");
    this.level = this.require("[data-level]");
    this.experience = this.require("[data-experience-container]");
    this.battleResult = this.require("[data-battle-result]");
    this.ap = this.require("[data-ap]");
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
      button.replaceChildren(number, containerIcon(item), label);
    });
  }

  showBattleResult(result: BattleResultSummary): void {
    const outcome = result.outcome === "victory" ? "Zwycięstwo!" : "Porażka.";
    const growth = result.levelsGained > 0 ? ` Awans na poziom ${result.level}!` : "";
    this.battleResult.textContent = `${outcome} +${result.experienceGained} XP.${growth}`;
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
    this.root.remove();
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`World HUD element missing: ${selector}`);
    return element;
  }
}
