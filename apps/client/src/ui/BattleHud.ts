import type { BattleSnapshot, InjuryKind, PlayerId } from "@web-mmorpg/shared";
import type { BattleActionMode } from "../battle/BattlePreview";

interface BattleHudHandlers {
  onActionMode: (mode: BattleActionMode) => void;
  onEndTurn: () => void;
}

const INJURY_LABELS: Record<InjuryKind, string> = {
  brokenArm: "Złamana ręka",
  legTrauma: "Uraz nogi",
  bleeding: "Krwawienie",
  concussion: "Wstrząśnienie",
  chestWound: "Rana klatki piersiowej",
  burn: "Oparzenie",
  poison: "Zatrucie"
};

export class BattleHud {
  private readonly root: HTMLDivElement;
  private readonly turnElement: HTMLElement;
  private readonly nameElement: HTMLElement;
  private readonly roundElement: HTMLElement;
  private readonly hpElement: HTMLElement;
  private readonly apElement: HTMLElement;
  private readonly orderElement: HTMLElement;
  private readonly injuriesElement: HTMLElement;
  private readonly statusElement: HTMLElement;
  private readonly moveButton: HTMLButtonElement;
  private readonly meleeButton: HTMLButtonElement;
  private readonly rangedButton: HTMLButtonElement;
  private readonly endButton: HTMLButtonElement;

  constructor(handlers: BattleHudHandlers) {
    this.root = document.createElement("div");
    this.root.className = "battle-hud battle-hud--mvp2";
    this.root.innerHTML = `
      <div class="battle-hud__top">
        <div>
          <span class="battle-hud__turn" data-turn>Walka</span>
          <strong class="battle-hud__name" data-name>—</strong>
        </div>
        <strong class="battle-hud__round" data-round>Runda 1</strong>
      </div>
      <div class="battle-hud__stats">
        <span>HP <strong data-hp>—</strong></span>
        <span>AP <strong data-ap>—</strong></span>
      </div>
      <div class="battle-hud__order">
        <span>Kolejka</span>
        <strong data-order>—</strong>
      </div>
      <div class="battle-hud__injuries" data-injuries></div>
      <div class="battle-hud__status" data-status>Wybierz akcję.</div>
      <div class="battle-hud__actions">
        <button type="button" data-action="move">Ruch</button>
        <button type="button" data-action="melee">Wręcz</button>
        <button type="button" data-action="ranged">Dystans</button>
        <button type="button" data-action="end">Koniec tury</button>
      </div>
    `;

    document.body.appendChild(this.root);
    this.turnElement = this.requireElement("[data-turn]");
    this.nameElement = this.requireElement("[data-name]");
    this.roundElement = this.requireElement("[data-round]");
    this.hpElement = this.requireElement("[data-hp]");
    this.apElement = this.requireElement("[data-ap]");
    this.orderElement = this.requireElement("[data-order]");
    this.injuriesElement = this.requireElement("[data-injuries]");
    this.statusElement = this.requireElement("[data-status]");
    this.moveButton = this.requireElement<HTMLButtonElement>("[data-action='move']");
    this.meleeButton = this.requireElement<HTMLButtonElement>("[data-action='melee']");
    this.rangedButton = this.requireElement<HTMLButtonElement>("[data-action='ranged']");
    this.endButton = this.requireElement<HTMLButtonElement>("[data-action='end']");

    this.moveButton.addEventListener("click", () => handlers.onActionMode("move"));
    this.meleeButton.addEventListener("click", () => handlers.onActionMode("meleeAttack"));
    this.rangedButton.addEventListener("click", () => handlers.onActionMode("rangedAttack"));
    this.endButton.addEventListener("click", handlers.onEndTurn);
  }

  update(snapshot: BattleSnapshot, playerId: PlayerId, mode: BattleActionMode): void {
    const active = snapshot.combatants.find(
      (combatant) => combatant.id === snapshot.activeCombatantId
    );
    const owned = active?.ownerPlayerId === playerId;

    this.roundElement.textContent = `Runda ${snapshot.round}`;
    this.orderElement.textContent = snapshot.turnOrder
      .map((id) => snapshot.combatants.find((combatant) => combatant.id === id)?.name)
      .filter((name): name is string => Boolean(name))
      .join(" → ") || "—";

    if (!active) {
      this.turnElement.textContent = "Brak aktywnej jednostki";
      this.nameElement.textContent = "—";
      this.hpElement.textContent = "—";
      this.apElement.textContent = "—";
      this.injuriesElement.textContent = "";
      this.statusElement.textContent = "Oczekiwanie na stan walki…";
      this.setDisabled(true);
      return;
    }

    this.turnElement.textContent = snapshot.finished
      ? "Walka zakończona"
      : owned
        ? "Twoja tura"
        : `Tura: ${active.name}`;
    this.nameElement.textContent = active.name;
    this.hpElement.textContent = `${active.hp}/${active.maxHp}`;
    this.apElement.textContent = `${active.ap}/${active.maxAp}`;

    const injuries = active.injuries.map((injury) => INJURY_LABELS[injury]);
    this.injuriesElement.textContent = injuries.length
      ? `Urazy: ${injuries.join(", ")}`
      : active.severelyInjured
        ? "Stan: ciężko ranny"
        : "Stan: bez urazów";

    const disabled = snapshot.finished || !owned || active.hp <= 0;
    this.setDisabled(disabled);
    this.moveButton.classList.toggle("is-active", mode === "move");
    this.meleeButton.classList.toggle("is-active", mode === "meleeAttack");
    this.rangedButton.classList.toggle("is-active", mode === "rangedAttack");

    if (snapshot.finished) {
      this.statusElement.textContent = "Walka została rozstrzygnięta.";
    } else if (!owned) {
      this.statusElement.textContent = "Czekaj na ruch przeciwnika.";
    } else if (mode === "move") {
      this.statusElement.textContent = "Zielone pola pokazują dostępny ruch.";
    } else if (mode === "meleeAttack") {
      this.statusElement.textContent = "Wybierz sąsiadującego przeciwnika.";
    } else {
      this.statusElement.textContent = "Wybierz przeciwnika w zasięgu i linii widzenia.";
    }
  }

  setStatus(message: string): void {
    this.statusElement.textContent = message;
  }

  destroy(): void {
    this.root.remove();
  }

  private setDisabled(disabled: boolean): void {
    this.moveButton.disabled = disabled;
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
