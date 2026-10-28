import type { CombatantSnapshot } from "@web-mmorpg/shared";

export type AttackMode = "meleeAttack" | "rangedAttack" | null;

interface BattleHudHandlers {
  onAttackMode: (mode: Exclude<AttackMode, null>) => void;
  onEndTurn: () => void;
}

export class BattleHud {
  private readonly root: HTMLDivElement;
  private readonly nameElement: HTMLElement;
  private readonly levelElement: HTMLElement;
  private readonly hpElement: HTMLElement;
  private readonly apElement: HTMLElement;
  private readonly meleeDamageElement: HTMLElement;
  private readonly rangedDamageElement: HTMLElement;
  private readonly armorElement: HTMLElement;
  private readonly injuriesElement: HTMLElement;
  private readonly meleeButton: HTMLButtonElement;
  private readonly rangedButton: HTMLButtonElement;
  private readonly endButton: HTMLButtonElement;

  constructor(handlers: BattleHudHandlers) {
    this.root = document.createElement("div");
    this.root.className = "battle-hud";
    this.root.innerHTML = `
      <div class="battle-hud__name"><span data-name>Brak aktywnej postaci</span> <small>· Poz. <span data-level>—</span></small></div>
      <div>HP <span data-hp>-</span></div>
      <div>AP <span data-ap>-</span></div>
      <div class="battle-hud__combat-stats" title="Obrażenia przed pancerzem celu i wpływem urazów">
        <span>Wręcz <b data-melee-damage>—</b></span>
        <span>Dystans <b data-ranged-damage>—</b></span>
        <span>Pancerz <b data-armor>—</b></span>
      </div>
      <div class="battle-hud__injuries" data-injuries></div>
      <div class="battle-hud__actions">
        <button type="button" data-action="melee">Wręcz</button>
        <button type="button" data-action="ranged">Dystans</button>
        <button type="button" data-action="end">Koniec tury</button>
      </div>
    `;

    document.body.appendChild(this.root);
    this.nameElement = this.requireElement("[data-name]");
    this.levelElement = this.requireElement("[data-level]");
    this.hpElement = this.requireElement("[data-hp]");
    this.apElement = this.requireElement("[data-ap]");
    this.meleeDamageElement = this.requireElement("[data-melee-damage]");
    this.rangedDamageElement = this.requireElement("[data-ranged-damage]");
    this.armorElement = this.requireElement("[data-armor]");
    this.injuriesElement = this.requireElement("[data-injuries]");
    this.meleeButton = this.requireElement<HTMLButtonElement>("[data-action='melee']");
    this.rangedButton = this.requireElement<HTMLButtonElement>("[data-action='ranged']");
    this.endButton = this.requireElement<HTMLButtonElement>("[data-action='end']");

    this.meleeButton.addEventListener("click", () => handlers.onAttackMode("meleeAttack"));
    this.rangedButton.addEventListener("click", () => handlers.onAttackMode("rangedAttack"));
    this.endButton.addEventListener("click", handlers.onEndTurn);
  }

  update(combatant: CombatantSnapshot | undefined, owned: boolean, mode: AttackMode): void {
    this.levelElement.textContent = combatant?.level === undefined ? "—" : `${combatant.level}`;
    this.meleeDamageElement.textContent = combatant?.combatStats ? `${combatant.combatStats.meleeDamage}` : "—";
    this.rangedDamageElement.textContent = combatant?.combatStats ? `${combatant.combatStats.rangedDamage}` : "—";
    this.armorElement.textContent = combatant?.combatStats ? `${combatant.combatStats.armor}` : "—";
    if (!combatant) {
      this.nameElement.textContent = "Brak aktywnej postaci";
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
      ? `Urazy: ${combatant.injuries.join(", ")}`
      : combatant.severelyInjured
        ? "Ciężko ranny"
        : "Brak urazów";

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
