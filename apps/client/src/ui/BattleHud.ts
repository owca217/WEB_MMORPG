import type { CombatantSnapshot } from "@web-mmorpg/shared";

export type AttackMode = "meleeAttack" | "rangedAttack" | null;

interface BattleHudHandlers {
  onAttackMode: (mode: Exclude<AttackMode, null>) => void;
  onEndTurn: () => void;
}

export class BattleHud {
  private readonly root: HTMLDivElement;
  private readonly nameElement: HTMLElement;
  private readonly hpElement: HTMLElement;
  private readonly apElement: HTMLElement;
  private readonly injuriesElement: HTMLElement;
  private readonly meleeButton: HTMLButtonElement;
  private readonly rangedButton: HTMLButtonElement;
  private readonly endButton: HTMLButtonElement;

  constructor(handlers: BattleHudHandlers) {
    this.root = document.createElement("div");
    this.root.className = "battle-hud";
    this.root.innerHTML = `
      <div class="battle-hud__name" data-name>No active combatant</div>
      <div>HP <span data-hp>-</span></div>
      <div>AP <span data-ap>-</span></div>
      <div class="battle-hud__injuries" data-injuries></div>
      <div class="battle-hud__actions">
        <button type="button" data-action="melee">Melee</button>
        <button type="button" data-action="ranged">Ranged</button>
        <button type="button" data-action="end">End turn</button>
      </div>
    `;

    document.body.appendChild(this.root);
    this.nameElement = this.requireElement("[data-name]");
    this.hpElement = this.requireElement("[data-hp]");
    this.apElement = this.requireElement("[data-ap]");
    this.injuriesElement = this.requireElement("[data-injuries]");
    this.meleeButton = this.requireElement<HTMLButtonElement>("[data-action='melee']");
    this.rangedButton = this.requireElement<HTMLButtonElement>("[data-action='ranged']");
    this.endButton = this.requireElement<HTMLButtonElement>("[data-action='end']");

    this.meleeButton.addEventListener("click", () => handlers.onAttackMode("meleeAttack"));
    this.rangedButton.addEventListener("click", () => handlers.onAttackMode("rangedAttack"));
    this.endButton.addEventListener("click", handlers.onEndTurn);
  }

  update(combatant: CombatantSnapshot | undefined, owned: boolean, mode: AttackMode): void {
    if (!combatant) {
      this.nameElement.textContent = "No active combatant";
      this.hpElement.textContent = "-";
      this.apElement.textContent = "-";
      this.injuriesElement.textContent = "";
      this.setDisabled(true);
      return;
    }

    this.nameElement.textContent = combatant.name;
    this.hpElement.textContent = `${combatant.hp}/${combatant.maxHp}`;
    this.apElement.textContent = `${combatant.ap}/${combatant.maxAp}`;
    this.injuriesElement.textContent = combatant.injuries.length
      ? `Injuries: ${combatant.injuries.join(", ")}`
      : combatant.severelyInjured
        ? "Severely injured"
        : "No injuries";

    this.setDisabled(!owned || combatant.hp <= 0);
    this.meleeButton.classList.toggle("is-active", mode === "meleeAttack");
    this.rangedButton.classList.toggle("is-active", mode === "rangedAttack");
  }

  setStatus(message: string): void {
    this.injuriesElement.textContent = message;
  }

  destroy(): void {
    this.root.remove();
  }

  private setDisabled(disabled: boolean): void {
    this.meleeButton.disabled = disabled;
    this.rangedButton.disabled = disabled;
    this.endButton.disabled = disabled;
  }

  private requireElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Battle HUD element missing: ${selector}`);
    return element;
  }
}
