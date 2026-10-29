import {
  BATTLE_ITEM_AP_COST,
  type CharacterSnapshot,
  type CombatantSnapshot,
  type InjuryKind,
  type InventoryItem,
  type InventorySnapshot,
  type InventoryUpdateResult
} from "@web-mmorpg/shared";
import "./BattleHud.css";

interface BattleHudHandlers {
  onEndTurn: () => void;
  onUseItem: (instanceId: string) => Promise<InventoryUpdateResult>;
  onInventoryChanged: (inventory: InventorySnapshot) => void;
  onToggleAuto?: () => void;
}

const INJURY_LABELS: Record<InjuryKind, string> = {
  brokenArm: "Złamana ręka", legTrauma: "Uraz nogi", bleeding: "Krwawienie",
  concussion: "Wstrząśnienie", chestWound: "Rana klatki piersiowej", burn: "Oparzenie", poison: "Zatrucie"
};

function positiveEffect(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

export class BattleHud {
  private readonly root: HTMLDivElement;
  private readonly itemsElement: HTMLElement;
  private readonly feedbackElement: HTMLElement;
  private readonly endButton: HTMLButtonElement;
  private readonly autoButton: HTMLButtonElement;
  private ownCombatant: CombatantSnapshot | undefined;
  private character: CharacterSnapshot | undefined;
  private ownedTurn = false;
  private inventory: InventorySnapshot = { items: [] };
  private pending = false;
  private destroyed = false;
  private autoBattle = false;
  private autoPending = false;

  constructor(private readonly handlers: BattleHudHandlers) {
    this.root = document.createElement("div");
    this.root.className = "battle-hud";
    this.root.setAttribute("role", "complementary");
    this.root.setAttribute("aria-label", "Twoja postać w walce");
    this.root.innerHTML = `
      <header class="battle-hud__header">
        <span class="battle-hud__eyebrow">Twoja postać</span>
        <div class="battle-hud__name" data-name>Brak postaci</div>
        <div class="battle-hud__identity"><span>Poziom <b data-level>—</b></span><span>Inicjatywa <b data-initiative>—</b></span></div>
      </header>
      <section class="battle-hud__resources" aria-label="Zasoby postaci">
        <div class="battle-hud__resource battle-hud__resource--hp">
          <div><span>HP</span><strong data-hp>—</strong></div>
          <div class="battle-hud__meter" aria-hidden="true"><span data-hp-fill></span></div>
        </div>
        <div class="battle-hud__resource battle-hud__resource--ap">
          <div><span>AP</span><strong data-ap>—</strong></div>
          <div class="battle-hud__meter" aria-hidden="true"><span data-ap-fill></span></div>
        </div>
      </section>
      <section class="battle-hud__section" aria-label="Statystyki postaci">
        <h2>Statystyki</h2>
        <dl class="battle-hud__stats" title="Obrażenia przed pancerzem celu i wpływem urazów">
          <div><dt>Wręcz</dt><dd data-melee-damage>—</dd></div>
          <div><dt>Dystans</dt><dd data-ranged-damage>—</dd></div>
          <div><dt>Pancerz</dt><dd data-armor>—</dd></div>
        </dl>
        <dl class="battle-hud__stats battle-hud__attributes" data-attributes hidden>
          <div><dt>Siła</dt><dd data-stat="strength">—</dd></div>
          <div><dt>Zręczność</dt><dd data-stat="dexterity">—</dd></div>
          <div><dt>Żywotność</dt><dd data-stat="vitality">—</dd></div>
        </dl>
        <p class="battle-hud__injuries" data-injuries>Brak urazów</p>
      </section>
      <section class="battle-hud__turn" aria-label="Akcje tury">
        <p class="battle-hud__turn-status" data-turn-status>Oczekiwanie na postać</p>
        <p class="battle-hud__auto-status" data-auto-status hidden>Auto: wyłączone</p>
        <button type="button" class="battle-hud__auto" data-action="auto" hidden>Włącz auto</button>
        <button type="button" class="battle-hud__end-turn" data-action="end" disabled>Koniec tury</button>
      </section>
      <p class="battle-hud__feedback" data-battle-feedback role="status" aria-live="polite"></p>
      <section class="battle-hud__section battle-hud__consumables" aria-label="Przedmioty do użycia w walce">
        <h2>Przedmioty <span class="battle-hud__cost">${BATTLE_ITEM_AP_COST} AP / użycie</span></h2>
        <div class="battle-hud__items" data-battle-items></div>
      </section>
    `;
    this.itemsElement = this.requireElement("[data-battle-items]");
    this.feedbackElement = this.requireElement("[data-battle-feedback]");
    this.endButton = this.requireElement<HTMLButtonElement>("[data-action='end']");
    this.autoButton = this.requireElement<HTMLButtonElement>("[data-action='auto']");
    this.autoButton.hidden = !handlers.onToggleAuto;
    this.autoButton.addEventListener("click", () => {
      if (!this.destroyed && !this.pending && !this.autoPending && this.ownCombatant && this.ownCombatant.hp > 0) this.handlers.onToggleAuto?.();
    });
    this.endButton.addEventListener("click", () => {
      if (this.canAct()) this.handlers.onEndTurn();
    });
    document.body.appendChild(this.root);
    this.render();
  }

  get busy(): boolean {
    return this.pending || this.autoPending;
  }

  update(
    ownCombatant: CombatantSnapshot | undefined,
    ownedTurn: boolean,
    inventory: InventorySnapshot,
    character?: CharacterSnapshot
  ): void {
    if (this.destroyed) return;
    this.ownCombatant = ownCombatant;
    this.ownedTurn = ownedTurn;
    this.inventory = inventory;
    this.character = character;
    this.render();
  }

  setStatus(message: string): void {
    if (this.destroyed) return;
    this.feedbackElement.textContent = message;
    this.feedbackElement.dataset.state = "info";
  }

  setAutoBattle(enabled: boolean, pending = false): void {
    if (this.destroyed) return;
    if (this.autoBattle === enabled && this.autoPending === pending) return;
    this.autoBattle = enabled;
    this.autoPending = pending;
    this.render();
  }

  destroy(): void {
    this.destroyed = true;
    this.pending = false;
    this.root.remove();
  }

  private render(): void {
    const combatant = this.ownCombatant;
    this.requireElement("[data-name]").textContent = combatant?.name ?? "Brak postaci";
    this.requireElement("[data-level]").textContent = combatant?.level === undefined ? "—" : `${combatant.level}`;
    this.requireElement("[data-initiative]").textContent = combatant ? `${combatant.initiative}` : "—";
    this.requireElement("[data-hp]").textContent = combatant ? `${combatant.hp}/${combatant.maxHp}` : "—";
    this.requireElement("[data-ap]").textContent = combatant ? `${combatant.ap}/${combatant.maxAp}` : "—";
    this.setMeter("[data-hp-fill]", combatant?.hp ?? 0, combatant?.maxHp ?? 0);
    this.setMeter("[data-ap-fill]", combatant?.ap ?? 0, combatant?.maxAp ?? 0);
    this.requireElement("[data-melee-damage]").textContent = combatant?.combatStats ? `${combatant.combatStats.meleeDamage}` : "—";
    this.requireElement("[data-ranged-damage]").textContent = combatant?.combatStats ? `${combatant.combatStats.rangedDamage}` : "—";
    this.requireElement("[data-armor]").textContent = combatant?.combatStats ? `${combatant.combatStats.armor}` : "—";
    const attributes = this.character?.statistics;
    this.requireElement("[data-attributes]").hidden = !combatant || !attributes;
    for (const stat of ["strength", "dexterity", "vitality"] as const) {
      this.requireElement(`[data-stat='${stat}']`).textContent = combatant && attributes ? `${attributes[stat]}` : "—";
    }
    this.requireElement("[data-injuries]").textContent = !combatant ? ""
      : [
        ...(combatant.severelyInjured ? ["Ciężko ranny"] : []),
        ...(combatant.injuries.length ? combatant.injuries.map((injury) => INJURY_LABELS[injury]) : [])
      ].join(" · ") || "Brak urazów";
    this.requireElement("[data-turn-status]").textContent = !combatant ? "Oczekiwanie na postać"
      : combatant.hp <= 0 ? "Postać pokonana"
        : this.ownedTurn ? "Twoja tura" : "Tura przeciwnika";
    this.root.dataset.ownedTurn = `${this.ownedTurn}`;
    this.root.setAttribute("aria-busy", `${this.pending || this.autoPending}`);
    const autoStatus = this.requireElement("[data-auto-status]");
    autoStatus.hidden = !this.autoBattle && !this.autoPending;
    autoStatus.textContent = this.autoPending ? "Zmiana sterowania…" : "Auto: włączone";
    this.autoButton.textContent = this.autoBattle ? "Przejmij sterowanie" : "Włącz auto";
    this.autoButton.disabled = this.pending || this.autoPending || !combatant || combatant.hp <= 0;
    this.root.dataset.autoBattle = String(this.autoBattle);
    this.endButton.disabled = !this.canAct();
    this.renderItems();
  }

  private renderItems(): void {
    const items = this.inventory.items.filter((item) => item.category === "medical"
      || item.category === "consumable"
      || positiveEffect(item.consumableEffects?.healHp) > 0
      || positiveEffect(item.consumableEffects?.restoreAp) > 0);
    this.itemsElement.replaceChildren();
    if (items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "battle-hud__empty";
      empty.textContent = "Nie masz przedmiotów do użycia w walce.";
      this.itemsElement.appendChild(empty);
    }
    for (const item of items) {
      const row = document.createElement("article");
      row.className = "battle-hud__item";
      row.dataset.itemInstanceId = item.instanceId;
      const heading = document.createElement("div");
      heading.className = "battle-hud__item-heading";
      const icon = document.createElement("span");
      icon.className = "battle-hud__item-icon";
      icon.textContent = "+";
      icon.setAttribute("aria-hidden", "true");
      if (item.iconUrl) {
        const image = document.createElement("img");
        image.src = item.iconUrl;
        image.alt = "";
        image.addEventListener("error", () => image.remove(), { once: true });
        icon.appendChild(image);
      }
      const name = document.createElement("strong");
      name.textContent = item.name;
      const quantity = document.createElement("span");
      quantity.className = "battle-hud__quantity";
      quantity.textContent = `×${item.quantity}`;
      heading.append(icon, name, quantity);
      const effects = document.createElement("p");
      effects.className = "battle-hud__item-effects";
      const healHp = positiveEffect(item.consumableEffects?.healHp);
      const restoreAp = positiveEffect(item.consumableEffects?.restoreAp);
      effects.textContent = [
        ...(healHp ? [`+${healHp} HP`] : []),
        ...(restoreAp ? [`+${restoreAp} AP`] : [])
      ].join(" · ") || "Brak działania w walce";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "battle-hud__use-item";
      button.dataset.useItem = item.instanceId;
      button.textContent = this.pending ? "Oczekiwanie…" : `Użyj · ${BATTLE_ITEM_AP_COST} AP`;
      button.setAttribute("aria-label", `Użyj ${item.name}, koszt ${BATTLE_ITEM_AP_COST} AP`);
      const reason = this.itemDisabledReason(item);
      button.disabled = !!reason;
      if (reason) button.title = reason;
      button.addEventListener("click", () => { void this.useItem(item.instanceId); });
      row.append(heading, effects, button);
      if (reason && reason !== "Brak działania w walce") {
        const explanation = document.createElement("p");
        explanation.className = "battle-hud__item-reason";
        explanation.textContent = reason;
        row.appendChild(explanation);
      }
      this.itemsElement.appendChild(row);
    }
  }

  private canAct(): boolean {
    return !this.destroyed && !this.pending && !this.autoBattle && !this.autoPending && this.ownedTurn && !!this.ownCombatant && this.ownCombatant.hp > 0;
  }

  private itemDisabledReason(item: InventoryItem): string | undefined {
    const healHp = positiveEffect(item.consumableEffects?.healHp);
    const restoreAp = positiveEffect(item.consumableEffects?.restoreAp);
    if (!healHp && !restoreAp) return "Brak działania w walce";
    if (item.quantity < 1) return "Brak przedmiotu";
    const combatant = this.ownCombatant;
    if (!combatant) return "Brak postaci w walce";
    if (combatant.hp <= 0) return "Postać pokonana";
    if (this.autoBattle) return "Przejmij sterowanie, aby użyć przedmiotu.";
    if (this.autoPending) return "Oczekiwanie na zmianę sterowania…";
    if (!this.ownedTurn) return "Poczekaj na swoją turę";
    if (this.pending) return "Oczekiwanie na serwer…";
    if (combatant.ap < BATTLE_ITEM_AP_COST) return `Potrzeba ${BATTLE_ITEM_AP_COST} AP`;
    const canHeal = healHp > 0 && combatant.hp < combatant.maxHp;
    const canRestoreAp = Math.min(combatant.maxAp, combatant.ap - BATTLE_ITEM_AP_COST + restoreAp) > combatant.ap;
    if (!canHeal && !canRestoreAp) return healHp > 0
      ? restoreAp > 0 ? "Pełne HP; brak zysku AP" : "Pełne HP"
      : "Brak zysku AP";
    return undefined;
  }

  private async useItem(instanceId: string): Promise<void> {
    if (this.destroyed || this.pending) return;
    const item = this.inventory.items.find((candidate) => candidate.instanceId === instanceId);
    if (!item || this.itemDisabledReason(item)) return;
    this.pending = true;
    this.feedbackElement.textContent = "Używanie przedmiotu…";
    this.feedbackElement.dataset.state = "pending";
    this.render();
    try {
      const result = await this.handlers.onUseItem(instanceId);
      if (this.destroyed) return;
      if (result.ok) {
        this.inventory = result.inventory;
        this.feedbackElement.textContent = `Użyto: ${item.name}.`;
        this.feedbackElement.dataset.state = "success";
        this.handlers.onInventoryChanged(result.inventory);
      } else {
        this.feedbackElement.textContent = result.message;
        this.feedbackElement.dataset.state = "error";
      }
    } catch {
      if (this.destroyed) return;
      this.feedbackElement.textContent = "Nie udało się użyć przedmiotu. Spróbuj ponownie.";
      this.feedbackElement.dataset.state = "error";
    } finally {
      this.pending = false;
      if (!this.destroyed) this.render();
    }
  }

  private setMeter(selector: string, value: number, maximum: number): void {
    this.requireElement(selector).style.width = `${maximum > 0 ? Math.min(100, Math.max(0, value / maximum * 100)) : 0}%`;
  }

  private requireElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Battle HUD element missing: ${selector}`);
    return element;
  }
}
