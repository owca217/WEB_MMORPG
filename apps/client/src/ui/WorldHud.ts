import type { PlayerStateSnapshot } from "@web-mmorpg/shared";
import type { ConnectionState } from "../net/GameSocket";

interface WorldHudHandlers {
  onInventory: () => void;
  onCharacter: () => void;
}

export class WorldHud {
  private readonly root: HTMLDivElement;
  private readonly name: HTMLElement;
  private readonly hp: HTMLElement;
  private readonly ap: HTMLElement;
  private readonly connection: HTMLElement;

  constructor(handlers: WorldHudHandlers) {
    this.root = document.createElement("div");
    this.root.className = "world-hud";
    this.root.innerHTML = `
      <div class="world-hud__identity">
        <strong data-name>—</strong>
        <span data-connection>Łączenie…</span>
      </div>
      <div class="world-hud__stats">
        <span>HP <b data-hp>—</b></span>
        <span>AP <b data-ap>—</b></span>
      </div>
      <div class="world-hud__actions">
        <button type="button" data-inventory>Ekwipunek</button>
        <button type="button" data-character>Postać</button>
      </div>
    `;
    document.body.appendChild(this.root);

    this.name = this.require("[data-name]");
    this.hp = this.require("[data-hp]");
    this.ap = this.require("[data-ap]");
    this.connection = this.require("[data-connection]");
    this.require<HTMLButtonElement>("[data-inventory]").addEventListener("click", handlers.onInventory);
    this.require<HTMLButtonElement>("[data-character]").addEventListener("click", handlers.onCharacter);
  }

  update(state: PlayerStateSnapshot): void {
    const character = state.character;
    this.name.textContent = character.nickname;
    this.hp.textContent = `${character.hp}/${character.maxHp}`;
    this.ap.textContent = `${character.maxAp}`;
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
