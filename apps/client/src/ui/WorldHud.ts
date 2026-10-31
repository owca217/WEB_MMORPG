import {
  CONTAINER_ITEM_CATEGORY, CONTAINER_SLOT_COUNT, resolveCharacterSkin, getEquippedWeaponFamily, getPendingInventoryItems, PERMANENT_BACKPACK_CAPACITY, PERMANENT_BACKPACK_SLOT_INDEX,
  type ContainerSlotIndex, type EquipmentSlot, type InventorySnapshot, type PlayerStateSnapshot, type UserRole
} from "@web-mmorpg/shared";
import { CHARACTER_SKIN_ATLASES, getCharacterSkinFrame } from "../characters/characterSkinAssets";
import type { BattleResultSummary, ConnectionState } from "../net/GameSocket";
import { containerIcon } from "./ContainerIcon";
import { itemQualityText } from "./ItemQualityFrame";
import { getAssignedContainers, getPermanentBackpack } from "./PermanentBackpack";
import { experienceProgressMarkup } from "./ExperienceProgress";
import { COMPACT_WORLD_QUERY, calculateWorldLayout } from "./worldLayout";
import { closeForegroundGamePanel } from "./gameWindows";
import { HudEquipmentSlots } from "./HudEquipmentSlots";
import { GoldDisplay } from "./GoldDisplay";
import "./WorldHud.css";

interface WorldHudHandlers {
  onInventory?: () => void;
  onContainerSlot?: (slotIndex: ContainerSlotIndex) => void;
  onCharacter: () => void;
  onEquipment?: (slot:EquipmentSlot) => void;
  onHealing?: () => void;
  onAdmin: () => void;
  onLogout?: () => void;
  onChat?: () => void;
  onSocial?: () => void;
  onOptions?: () => void;
  onParty?: () => void;
  onTrade?: () => void;
  onLayoutChange?: () => void;
}

const glyphs = {
  character: '<circle cx="12" cy="7" r="4"/><path d="M4 23v-3a8 8 0 0 1 16 0v3"/>',
  bag: '<path d="M8 8V6a4 4 0 0 1 8 0v2"/><rect x="5" y="8" width="14" height="15" rx="3"/><path d="M5 14h14M9 18h6"/>',
  social: '<circle cx="9" cy="7" r="3"/><path d="M2 22v-4a7 7 0 0 1 14 0v4M17 4a3 3 0 0 1 0 6m1 4a6 6 0 0 1 4 6v2"/>',
  chat: '<path d="M3 3h18v14H10l-7 5V3Z"/><path d="M7 8h10M7 12h7"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>'
};
function glyph(name: keyof typeof glyphs): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${glyphs[name]}</svg>`;
}

/** Scene-owned chrome. Resources remain visible even when compact panels are closed. */
export class WorldHud {
  private readonly root: HTMLDivElement;
  private readonly content: HTMLElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly compactViewport: MediaQueryList | null;
  private readonly containerSlots: HTMLButtonElement[] = [];
  private readonly equipmentSlots:HudEquipmentSlots;
  private readonly goldDisplay:GoldDisplay;
  private pendingCount = 0;
  private readonly togglePending: HTMLElement;
  private selectedSlot: ContainerSlotIndex = 0;
  private collapsed = true;
  private menuOpened = false;
  private destroyed = false;
  private visibilityKey = "";
  private resultTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly onViewportChange = (): void => {
    this.collapsed = true;
    this.updateVisibility();
  };
  private readonly onBack = (event: Event): void => {
    if (!event.defaultPrevented && this.closePanel()) event.preventDefault();
  };
  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (closeForegroundGamePanel() || this.closePanel()) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  constructor(private readonly handlers: WorldHudHandlers) {
    this.root = document.createElement("div");
    this.root.className = "world-hud";
    this.root.innerHTML = `
      <header class="world-hud__topbar">
        <div class="world-hud__brand"><span class="world-hud__crest" aria-hidden="true">W</span><strong>WEB <span>MMORPG</span></strong></div>
        <div class="world-hud__location"><span aria-hidden="true">◆</span><strong data-location-name>Osada Zielony Brzeg</strong><small>Świat gry</small></div>
        <div class="world-hud__compact-resources"><strong data-compact-name>Podróżnik</strong><span data-compact-hp>HP —</span><div class="world-hud__compact-meter"><span data-compact-hp-fill></span></div><div class="world-hud__compact-xp" data-compact-experience></div></div>
        <span class="world-hud__connection" data-connection role="status">Łączenie…</span>
      </header>
      <aside class="world-hud__content" id="world-hud-content" data-hud-content aria-label="Postać i torby">
        <div class="world-hud__rail-heading"><strong class="world-hud__heading-identity"><span data-level aria-label="Poziom postaci">—</span> <span data-name>—</span></strong><button type="button" data-hud-close aria-label="Zamknij panel gry">${glyph("close")}</button></div>
        <section class="world-hud__hero">
          <div class="world-hud__equipment-host" data-hud-equipment-host></div>
          <div class="world-hud__portrait" aria-hidden="true"><span data-portrait-sprite></span></div>
        </section>
        <section class="world-hud__resources" aria-label="Zasoby postaci">
          <div class="world-hud__resource-label"><span>Życie</span><b data-hp>—</b></div>
          <div class="world-hud__hp-track" data-hp-meter role="progressbar" aria-label="Punkty życia" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span data-hp-fill></span></div>
          <div class="world-hud__ap-gold-row"><div class="world-hud__ap-row"><span>Punkty akcji</span><b data-ap>—</b></div><div data-hud-gold></div></div>
          <div data-experience-container></div>
        </section>
        <div class="world-hud__section-heading"><span>Twoje torby</span></div>
        <div class="world-hud__container-slots" data-container-slots aria-label="Pojemniki"></div>
        <section class="world-hud__storage" id="world-container-contents" data-container-contents-host aria-label="Zawartość wybranego pojemnika"></section>
      </aside>
      <p class="world-hud__battle-result" data-battle-result role="status" hidden></p>
      <nav class="world-hud__actions" aria-label="Menu gry">
        <button type="button" data-character>${glyph("character")}<span>Postać</span><kbd>C</kbd></button>
        <button type="button" data-hud-toggle aria-controls="world-hud-content" aria-expanded="false" aria-label="Rozwiń panel gry">${glyph("bag")}<span>Torby</span><span class="world-hud__badge" data-hud-pending hidden aria-hidden="true"></span></button>
        <div class="world-hud__nav-divider" aria-hidden="true"></div>
        <button type="button" data-hud-social aria-expanded="false">${glyph("social")}<span>Społeczność</span><b class="world-hud__badge" data-social-count hidden></b></button>
        <button type="button" data-hud-chat aria-expanded="false">${glyph("chat")}<span>Czat</span><b class="world-hud__badge" data-chat-count hidden></b></button>
        <span class="world-hud__nav-hint">Kliknij na mapie, aby iść <span aria-hidden="true">·</span> WASD</span>
        <button type="button" class="world-hud__menu-toggle" data-hud-menu-toggle aria-controls="world-hud-menu" aria-expanded="false">${glyph("menu")}<span>Menu</span></button>
      </nav>
      <div class="world-hud__menu" id="world-hud-menu" data-hud-menu hidden><span>Menu gry</span><button type="button" data-options>Opcje</button><button type="button" data-party>Drużyna</button><button type="button" data-trade>Handel</button><button type="button" data-healing hidden>Leczenie</button><button type="button" data-admin hidden>Panel ADMIN</button><button type="button" data-logout>Wyloguj się</button><button type="button" data-menu-close data-close>Zamknij menu</button></div>
    `;
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) this.root.addEventListener(type, event => event.stopPropagation());
    document.body.appendChild(this.root);
    document.body.classList.add("has-world-hud");
    this.equipmentSlots=new HudEquipmentSlots({onSelect:slot=>handlers.onEquipment?.(slot)});
    this.require("[data-hud-equipment-host]").append(this.equipmentSlots.element);
    this.equipmentSlots.element.append(this.require(".world-hud__portrait"));
    this.goldDisplay=new GoldDisplay();
    this.require("[data-hud-gold]").append(this.goldDisplay.element);
    this.content = this.require("[data-hud-content]");
    this.toggleButton = this.require("[data-hud-toggle]");
    this.togglePending = this.require("[data-hud-pending]");
    this.compactViewport = typeof window.matchMedia === "function" ? window.matchMedia(COMPACT_WORLD_QUERY) : null;
    this.compactViewport?.addEventListener("change", this.onViewportChange);
    this.toggleButton.addEventListener("click", () => {
      this.collapsed = !this.collapsed;
      this.menuOpened = false;
      this.updateVisibility();
    });
    this.require("[data-hud-close]").addEventListener("click", () => this.closePanel());
    this.require("[data-hud-menu-toggle]").addEventListener("click", () => {
      this.menuOpened = !this.menuOpened;
      this.collapsed = true;
      this.updateVisibility();
    });
    this.require("[data-menu-close]").addEventListener("click", () => this.closePanel());
    const slots = this.require("[data-container-slots]");
    for (let index = 0; index < CONTAINER_SLOT_COUNT; index++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "world-hud__container-slot";
      button.dataset.containerSlot = `${index}`;
      if (index !== PERMANENT_BACKPACK_SLOT_INDEX) button.dataset.containerSlotTarget = `${index}`;
      button.addEventListener("click", () => this.handlers.onContainerSlot?.(index as ContainerSlotIndex));
      slots.appendChild(button);
      this.containerSlots.push(button);
    }
    this.require("[data-character]").addEventListener("click", handlers.onCharacter);
    this.require<HTMLButtonElement>("[data-healing]").addEventListener("click", () => { if (!this.require("[data-healing]").hidden) { this.closePanel(); handlers.onHealing?.(); } });
    this.require("[data-hud-chat]").addEventListener("click", () => handlers.onChat?.());
    this.require("[data-hud-social]").addEventListener("click", () => handlers.onSocial?.());
    this.require("[data-options]").addEventListener("click", () => { this.closePanel(); handlers.onOptions?.(); });
    this.require("[data-party]").addEventListener("click", () => { this.closePanel(); handlers.onParty?.(); });
    this.require("[data-trade]").addEventListener("click", () => { this.closePanel(); handlers.onTrade?.(); });
    this.require("[data-admin]").addEventListener("click", () => { this.closePanel(); handlers.onAdmin(); });
    this.require("[data-logout]").addEventListener("click", () => handlers.onLogout?.());
    document.addEventListener("game-ui-back", this.onBack);
    document.addEventListener("keydown", this.onEscape);
    this.updateInventory({items:[]});
    this.updatePortrait();
    this.updateVisibility();
  }

  get containerContentsHost(): HTMLElement { return this.require("[data-container-contents-host]"); }

  showContainerSlot(slotIndex: ContainerSlotIndex, reveal = true): void {
    this.selectedSlot = slotIndex;
    this.updateSelectedContainer();
    if (reveal) {
      this.collapsed = false;
      this.menuOpened = false;
      this.updateVisibility();
    }
  }

  get isPanelOpen(): boolean { return this.menuOpened || (this.isCompact && !this.collapsed); }
  private get isCompact(): boolean {
    return this.compactViewport?.matches ?? calculateWorldLayout(window.innerWidth, window.innerHeight).compact;
  }

  updateSession(role: UserRole): void { this.require("[data-admin]").hidden = role !== "ADMIN"; }

  update(state: PlayerStateSnapshot): void {
    const hero = state.character;
    this.require("[data-healing]").hidden = !this.handlers.onHealing || getEquippedWeaponFamily(hero.equipment) !== "staff" || !((hero.statistics?.healingPower ?? 0) > 0);
    this.require("[data-name]").textContent = hero.nickname;
    this.require("[data-name]").title = hero.nickname;
    this.require("[data-compact-name]").textContent = `${hero.level} ${hero.nickname}`;
    this.require("[data-level]").textContent = `${hero.level}`;
    this.require("[data-level]").setAttribute("aria-label",`Poziom ${hero.level}`);
    const health = `${hero.hp}/${hero.maxHp}`;
    this.require("[data-hp]").textContent = health;
    this.require("[data-compact-hp]").textContent = `HP ${health}`;
    const percent = Math.max(0, Math.min(100, hero.hp / Math.max(1, hero.maxHp) * 100));
    this.require("[data-hp-fill]").style.width = `${percent}%`;
    this.require("[data-compact-hp-fill]").style.width = `${percent}%`;
    const meter = this.require("[data-hp-meter]");
    meter.setAttribute("aria-valuenow", `${hero.hp}`);
    meter.setAttribute("aria-valuemax", `${hero.maxHp}`);
    this.require("[data-ap]").textContent = `${hero.maxAp}`;
    this.goldDisplay.update(state.gold);
    this.equipmentSlots.update(hero,state.inventory);
    this.require("[data-experience-container]").innerHTML = experienceProgressMarkup(hero);
    this.require("[data-compact-experience]").innerHTML = experienceProgressMarkup(hero);
    this.updatePortrait(hero.appearance);
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
      if (!item && !permanentSlot) button.setAttribute("aria-haspopup", "dialog");
      else button.removeAttribute("aria-haspopup");
      button.setAttribute("aria-controls", "world-container-contents");
      button.classList.toggle("is-equipped", Boolean(item));
      button.classList.toggle("is-empty", !item);
      button.replaceChildren(containerIcon(item));
      if (item) button.prepend(number);
      if (item) button.append(label);
      if(permanentSlot&&this.pendingCount){const count=document.createElement("span");count.className="world-hud__pending-count";count.dataset.pendingInventory="";count.textContent=String(this.pendingCount);count.setAttribute("aria-hidden","true");button.append(count);}
    });
    this.updateSelectedContainer();
  }

  updateChatStatus(status: { opened: boolean; unread: number }): void { this.updateBadge("chat", status.opened, status.unread); }
  updateSocialStatus(status: { opened: boolean; notifications: number }): void { this.updateBadge("social", status.opened, status.notifications); }
  setLocation(name: string): void { this.require("[data-location-name]").textContent = name; }

  showBattleResult(result: BattleResultSummary): void {
    const outcome = result.outcome === "victory" ? "Zwycięstwo!" : "Porażka.";
    const growth = result.levelsGained > 0 ? ` Awans na poziom ${result.level}!` : "";
    const party = result.partyBonusExperience ? ` (premia drużyny: +${result.partyBonusExperience} XP)` : "";
    const gold = result.goldGained ? ` +${result.goldGained} złota.` : "";
    const notification = this.require("[data-battle-result]");
    notification.textContent = `${outcome} +${result.experienceGained} XP${party}.${gold}${growth}`;
    notification.hidden = false;
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.resultTimer = setTimeout(() => { notification.hidden = true; }, 12000);
  }

  setConnectionState(state: ConnectionState): void {
    const connection = this.require("[data-connection]");
    connection.dataset.state = state;
    connection.textContent = state === "connected" ? "Połączono" : state === "connecting" ? "Ponowne łączenie…" : "Brak połączenia z serwerem";
  }

  closePanel(): boolean {
    if (!this.isPanelOpen) return false;
    const focusMenu = this.menuOpened;
    this.menuOpened = false;
    this.collapsed = true;
    this.updateVisibility();
    this.require<HTMLButtonElement>(focusMenu ? "[data-hud-menu-toggle]" : "[data-hud-toggle]").focus();
    return true;
  }

  closeMenu(): void {
    if (!this.menuOpened) return;
    this.menuOpened=false;
    this.updateVisibility();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.resultTimer) clearTimeout(this.resultTimer);
    this.compactViewport?.removeEventListener("change", this.onViewportChange);
    document.removeEventListener("game-ui-back", this.onBack);
    document.removeEventListener("keydown", this.onEscape);
    this.equipmentSlots.destroy();this.goldDisplay.destroy();
    this.root.remove();
    document.body.classList.remove("has-world-hud");
  }

  private updateBadge(kind: "chat" | "social", opened: boolean, count: number): void {
    if (this.destroyed) return;
    const button = this.require(`[data-hud-${kind}]`);
    button.setAttribute("aria-expanded", String(opened));
    button.setAttribute("aria-label", `${kind === "chat" ? "Czat" : "Społeczność"}${count > 0 ? `, nowe: ${count}` : ""}`);
    const badge = this.require(`[data-${kind}-count]`);
    badge.hidden = count <= 0;
    badge.textContent = count > 99 ? "99+" : String(count);
  }

  private updatePortrait(appearance?: Record<string, unknown>): void {
    const skin = resolveCharacterSkin(appearance);
    const frame = getCharacterSkinFrame(skin.id, 0);
    const sprite = this.require("[data-portrait-sprite]");
    sprite.style.backgroundImage = `url("${CHARACTER_SKIN_ATLASES[skin.id].url}")`;
    sprite.style.backgroundPosition = `0 -${frame.y / 4}px`;
    sprite.style.height = `${frame.height / 4}px`;
  }

  private updateSelectedContainer(): void {
    this.containerSlots.forEach((button, index) => {
      const selected=index===this.selectedSlot;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  private updateVisibility(): void {
    const compact = this.isCompact;
    const closed = compact && this.collapsed;
    this.root.dataset.compact = String(compact);
    this.root.classList.toggle("has-menu-open",this.menuOpened);
    this.content.hidden = closed;
    this.root.classList.toggle("is-collapsed", closed);
    this.toggleButton.hidden = !compact;
    this.toggleButton.setAttribute("aria-expanded", String(!closed));
    this.togglePending.textContent = String(this.pendingCount);
    this.togglePending.hidden = this.pendingCount === 0;
    this.toggleButton.setAttribute("aria-label", `${closed ? "Rozwiń panel gry" : "Zwiń panel gry"}${this.pendingCount ? ` · Oczekujące: ${this.pendingCount}` : ""}`);
    this.require("[data-hud-menu]").hidden = !this.menuOpened;
    this.require("[data-hud-menu-toggle]").setAttribute("aria-expanded", String(this.menuOpened));
    const visibilityKey = `${compact}:${closed}:${this.menuOpened}`;
    if (visibilityKey !== this.visibilityKey) {
      this.visibilityKey = visibilityKey;
      this.handlers.onLayoutChange?.();
    }
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`World HUD element missing: ${selector}`);
    return element;
  }
}
