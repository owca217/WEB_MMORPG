import type { PlayerStateSnapshot, UserRole } from "@web-mmorpg/shared";
import type { BattleResultSummary, ConnectionState } from "../net/GameSocket";
import { experienceProgressMarkup } from "./ExperienceProgress";

interface WorldHudHandlers {
  onInventory: () => void;
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
      <div class="world-hud__actions">
        <button type="button" data-inventory>Ekwipunek</button>
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
    this.require<HTMLButtonElement>("[data-inventory]").addEventListener("click", handlers.onInventory);
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
