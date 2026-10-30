import { getEquippedWeaponFamily, getPendingInventoryItems, CONTAINER_ITEM_CATEGORY, CONTAINER_SLOT_COUNT, PERMANENT_BACKPACK_CAPACITY, PERMANENT_BACKPACK_SLOT_INDEX, type ContainerSlotIndex, type InventorySnapshot, type PlayerStateSnapshot, type UserRole } from "@web-mmorpg/shared";
import type { BattleResultSummary, ConnectionState } from "../net/GameSocket";
import { containerIcon } from "./ContainerIcon";
import { experienceProgressMarkup } from "./ExperienceProgress";
import { itemQualityText } from "./ItemQualityFrame";
import { getAssignedContainers, getPermanentBackpack } from "./PermanentBackpack";

interface WorldHudHandlers {
  onInventory?: () => void;
  onContainerSlot?: (slotIndex: ContainerSlotIndex) => void;
  onCharacter: () => void;
  onHealing?: () => void;
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
  private readonly healingButton:HTMLButtonElement;
  private readonly hasHealing:boolean;
  private readonly adminButton: HTMLButtonElement;
  private readonly containerSlots: HTMLButtonElement[] = [];
  private readonly content: HTMLElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly togglePending:HTMLElement;
  private readonly compactViewport: MediaQueryList | null;
  private collapsed = false;
  private pendingCount=0;
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
        <span class="world-hud__pending-count" data-hud-pending hidden aria-hidden="true"></span>
      </button>
      <div class="world-hud__content" id="world-hud-content" data-hud-content>
      <div class="world-hud__identity">
        <strong data-name>—</strong>
        <span data-connection>Łączenie…</span>
      </div>
      <div class="world-hud__location" data-location-name>Osada Zielony Brzeg</div>
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
        <button type="button" data-healing hidden>Leczenie</button>
        <button type="button" data-admin hidden>Panel ADMIN</button>
        <button type="button" data-logout>Wyloguj</button>
      </div>
      </div>
    `;
    for(const type of ["pointerdown","pointerup","mousedown","mouseup","touchstart","touchend"])this.root.addEventListener(type,event=>event.stopPropagation());
    document.body.appendChild(this.root);

    this.healingButton=this.require<HTMLButtonElement>("[data-healing]");
    this.hasHealing=Boolean(handlers.onHealing);
    this.healingButton.addEventListener("click",()=>{if(!this.healingButton.hidden)handlers.onHealing?.();});
    this.content = this.require("[data-hud-content]");
    this.toggleButton = this.require<HTMLButtonElement>("[data-hud-toggle]");
    this.togglePending=this.require("[data-hud-pending]");
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

  setLocation(name:string):void {
    this.require("[data-location-name]").textContent=name;
  }

  updateSession(role: UserRole): void {
    this.adminButton.hidden = role !== "ADMIN";
  }

  update(state: PlayerStateSnapshot): void {
    const character = state.character;
    this.healingButton.hidden=!this.hasHealing || getEquippedWeaponFamily(character.equipment)!=="staff" || !((character.statistics?.healingPower ?? 0) > 0);
    this.name.textContent = character.nickname;
    this.hp.textContent = `${character.hp}/${character.maxHp}`;
    this.level.textContent = `${character.level}`;
    this.experience.innerHTML = experienceProgressMarkup(character);
    this.ap.textContent = `${character.maxAp}`;
    this.gold.textContent = state.gold === undefined ? "—" : `${state.gold}`;
    this.updateInventory(state.inventory);
  }

  updateInventory(inventory: InventorySnapshot): void {
    this.pendingCount=getPendingInventoryItems(inventory).length;this.togglePending.textContent=String(this.pendingCount);this.togglePending.hidden=this.pendingCount===0;this.updateVisibility();
    const storageTargets = new Set(getAssignedContainers(inventory).map(item => item.instanceId));
    this.containerSlots.forEach((button, slotIndex) => {
      const instanceId = inventory.containerSlots?.[slotIndex];
      const permanentSlot=slotIndex===PERMANENT_BACKPACK_SLOT_INDEX;
      const item = permanentSlot ? getPermanentBackpack(inventory) : inventory.items.find((candidate) => candidate.instanceId === instanceId && candidate.category === CONTAINER_ITEM_CATEGORY && !candidate.containerInstanceId);
      if (item && storageTargets.has(item.instanceId)) button.dataset.containerDropTarget = item.instanceId;
      else delete button.dataset.containerDropTarget;
      const number = document.createElement("span");
      number.className = "world-hud__container-number";
      number.textContent = `${slotIndex + 1}`;
      const label = document.createElement("span");
      label.className = "world-hud__container-name";
      label.textContent = item?.name ?? "Pusty";
      button.title = permanentSlot ? item ? `${item.name} · ${PERMANENT_BACKPACK_CAPACITY} miejsc · na stałe · ${itemQualityText(item)}` : "Ładowanie plecaka" : `Pojemnik ${slotIndex + 1}: ${item?.name ?? "pusty"}${item ? ` · ${itemQualityText(item)}` : ""}`;
      if(permanentSlot&&this.pendingCount)button.title+=` · Oczekujące: ${this.pendingCount}`;
      button.setAttribute("aria-label", `${button.title}. ${permanentSlot ? item ? "Otwórz plecak" : "Odśwież plecak" : "Wybierz pojemnik"}`);
      button.classList.toggle("is-permanent",permanentSlot&&!!item);
      button.classList.toggle("is-equipped", Boolean(item));
      button.classList.toggle("is-empty", !item);
      button.replaceChildren(containerIcon(item));
      if (item) button.prepend(number);
      if (item) button.append(label);
      if(permanentSlot&&this.pendingCount){const count=document.createElement("span");count.className="world-hud__pending-count";count.dataset.pendingInventory="";count.textContent=String(this.pendingCount);count.setAttribute("aria-hidden","true");button.append(count);}
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
    const label = `${collapsed ? "Rozwiń panel gry" : "Zwiń panel gry"}${this.pendingCount?` · Oczekujące: ${this.pendingCount}`:""}`;
    this.toggleButton.setAttribute("aria-label", label);
    this.toggleButton.title = label;
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`World HUD element missing: ${selector}`);
    return element;
  }
}
