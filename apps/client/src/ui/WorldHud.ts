import type { PlayerStateSnapshot } from "@web-mmorpg/shared";
import type { ConnectionState } from "../net/GameSocket";
import { worldWindowMenuItem } from "./windowMenuItems";
import "./world-hud.css";

interface WorldHudHandlers {
  onInventory: () => void;
  onCharacter: () => void;
  onStatistics: () => void;
  onProfessions: () => void;
  onParty?: () => void;
  onLogout: () => void;
}

let nextMenuId = 0;

export class WorldHud {
  private readonly root: HTMLDivElement;
  private readonly hp: HTMLElement;
  private readonly experience: HTMLElement;
  private readonly connection: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly menuToggle: HTMLButtonElement;
  private readonly menuButtons: HTMLButtonElement[] = [];
  private readonly onOutsidePointer = (event: PointerEvent): void => {
    if (event.target instanceof Node && !this.root.contains(event.target)) {
      this.setMenuOpen(false);
    }
  };
  private readonly onEscape = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !this.menu.hidden) {
      event.preventDefault();
      this.setMenuOpen(false, true);
    }
  };

  constructor(handlers: WorldHudHandlers) {
    const menuId = `world-window-menu-${++nextMenuId}`;
    this.root = document.createElement("div");
    this.root.className = "world-hud";
    this.root.setAttribute("role", "region");
    this.root.setAttribute("aria-label", "Panel gracza");
    this.root.innerHTML = `
      <div class="world-hud__stats">
        <div class="world-hud__stat world-hud__stat--hp">
          <span>HP</span><b data-hp>—</b>
        </div>
        <div class="world-hud__stat world-hud__stat--experience" title="Doświadczenie">
          <span aria-label="Doświadczenie">EXP</span><b data-experience>—</b>
        </div>
      </div>
      <button class="world-hud__menu-toggle" type="button" data-menu-toggle
        aria-expanded="false" aria-controls="${menuId}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
        <span>Menu</span>
        <svg class="world-hud__chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
      </button>
      <nav class="world-hud__menu" id="${menuId}" data-window-menu aria-label="Okna gry" hidden></nav>
      <span class="world-hud__connection" data-connection role="status">Łączenie…</span>
    `;
    this.hp = this.require("[data-hp]");
    this.experience = this.require("[data-experience]");
    this.connection = this.require("[data-connection]");
    this.menu = this.require("[data-window-menu]");
    this.menuToggle = this.require<HTMLButtonElement>("[data-menu-toggle]");

    this.addAction(
      "inventory",
      worldWindowMenuItem("inventory").label,
      handlers.onInventory
    );
    this.addAction(
      "character",
      worldWindowMenuItem("character").label,
      handlers.onCharacter
    );
    this.addAction(
      "statistics",
      worldWindowMenuItem("statistics").label,
      handlers.onStatistics
    );
    this.addAction(
      "professions",
      worldWindowMenuItem("professions").label,
      handlers.onProfessions
    );
    if (handlers.onParty) {
      this.addAction("party", worldWindowMenuItem("party").label, handlers.onParty);
    }
    this.addAction("logout", worldWindowMenuItem("logout").label, handlers.onLogout);

    this.menuToggle.addEventListener("click", () => this.setMenuOpen(this.menu.hidden));
    this.root.addEventListener("keydown", (event) => this.navigateMenu(event));
    this.root.addEventListener("focusout", (event) => {
      if (!(event.relatedTarget instanceof Node) || !this.root.contains(event.relatedTarget)) {
        this.setMenuOpen(false);
      }
    });
    document.addEventListener("pointerdown", this.onOutsidePointer);
    document.addEventListener("keydown", this.onEscape);
    document.body.appendChild(this.root);
  }

  update(state: PlayerStateSnapshot): void {
    const { hp, maxHp, experience } = state.character;
    this.hp.textContent = `${hp}/${maxHp}`;
    const hpPercent = maxHp > 0 ? Math.max(0, Math.min(100, hp / maxHp * 100)) : 0;
    this.root.style.setProperty("--hud-hp", `${hpPercent}%`);
    this.experience.textContent = typeof experience === "number" && Number.isFinite(experience)
      ? Math.max(0, Math.trunc(experience)).toLocaleString("pl-PL")
      : "0";
  }

  setConnectionState(state: ConnectionState): void {
    this.root.dataset.connection = state;
    this.connection.textContent = state === "connected"
      ? "Połączono"
      : state === "connecting" ? "Ponowne łączenie…" : "Brak połączenia z serwerem";
  }

  destroy(): void {
    document.removeEventListener("pointerdown", this.onOutsidePointer);
    document.removeEventListener("keydown", this.onEscape);
    this.root.remove();
  }

  private addAction(key: string, label: string, handler: () => void): void {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset[key] = "";
    button.textContent = label;
    button.addEventListener("click", () => {
      this.setMenuOpen(false, true);
      handler();
    });
    this.menu.appendChild(button);
    this.menuButtons.push(button);
  }

  private setMenuOpen(open: boolean, restoreFocus = false): void {
    this.menu.hidden = !open;
    this.menuToggle.setAttribute("aria-expanded", String(open));
    if (restoreFocus) this.menuToggle.focus();
  }

  private navigateMenu(event: KeyboardEvent): void {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    if (this.menu.hidden && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    event.stopPropagation();
    const index = this.menuButtons.findIndex((button) => button === document.activeElement);
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = this.menuButtons.length - 1;
    else if (index < 0) next = event.key === "ArrowDown" ? 0 : this.menuButtons.length - 1;
    else next = (index + (event.key === "ArrowDown" ? 1 : -1) + this.menuButtons.length) % this.menuButtons.length;
    this.setMenuOpen(true);
    this.menuButtons[next]?.focus();
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`World HUD element missing: ${selector}`);
    return element;
  }
}
