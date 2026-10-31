import {
  BATTLE_ITEM_AP_COST,
  type BattleSnapshot,
  getBattleHealingPreview,
  type CharacterSnapshot,
  type CombatantSnapshot,
  type InjuryKind,
  type InventoryItem,
  type InventorySnapshot,
  type InventoryUpdateResult
} from "@web-mmorpg/shared";
import type { BattleHudRegions, LayoutRect } from "../scenes/battleLayout";
import "./BattleHud.css";
import { applyItemQualityFrame, itemQualityText } from "./ItemQualityFrame";

interface BattleHudHandlers {
  onEndTurn: () => void;
  onHealSelf?: () => void;
  onSelectHealingTarget?: (combatantId:string) => void;
  onTypingChange?: () => void;
  onUseItem: (instanceId: string) => Promise<InventoryUpdateResult>;
  onInventoryChanged: (inventory: InventorySnapshot) => void;
  onToggleAuto?: () => void;
  onToggleZoom?: () => void;
  onLayoutChanged?: () => void;
}

const INJURY_LABELS: Record<InjuryKind, string> = {
  brokenArm: "Złamana ręka", legTrauma: "Uraz nogi", bleeding: "Krwawienie",
  concussion: "Wstrząśnienie", chestWound: "Rana klatki piersiowej", burn: "Oparzenie", poison: "Zatrucie"
};

function positiveEffect(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

interface BattleHudTeam { members:readonly CombatantSnapshot[]; activeCombatantId:string; healingTargetId:string; }

export class BattleHud {
  private readonly root: HTMLDivElement;
  private readonly itemsElement: HTMLElement;
  private readonly feedbackElement: HTMLElement;
  private readonly endButton: HTMLButtonElement;
  private readonly autoButton: HTMLButtonElement;
  private team:BattleHudTeam|undefined;
  private healingPreview:ReturnType<typeof getBattleHealingPreview>|undefined;
  private ownCombatant: CombatantSnapshot | undefined;
  private character: CharacterSnapshot | undefined;
  private ownedTurn = false;
  private inventory: InventorySnapshot = { items: [] };
  private pending = false;
  private destroyed = false;
  private autoBattle = false;
  private autoPending = false;

  private commandPending = false;
  private battle: BattleSnapshot | undefined;
  private compact = true;
  private detailsOpen = false;
  private readonly onBack = (event: Event) => {
    if (!event.defaultPrevented && this.compact && this.detailsOpen) {
      this.setDetailsOpen(false);
      event.preventDefault();
    }
  };
  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.onBack(event);
  };


  constructor(private readonly handlers: BattleHudHandlers) {
    this.root = document.createElement("div");
    this.root.className = "battle-hud";
    this.root.setAttribute("role", "complementary");
    this.root.setAttribute("aria-label", "Twoja postać w walce");
    this.root.innerHTML = `
      <header class="battle-hud__header" data-battle-header>
        <div class="battle-hud__overview">
        <div class="battle-hud__portrait-name">
          <div class="battle-hud__name" data-name>Brak postaci</div>
          <div class="battle-hud__identity"><span>Poziom <b data-level>—</b></span><span>Inicjatywa <b data-initiative>—</b></span></div>
        </div>
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
        </div>
        <div class="battle-hud__round-strip">
          <strong class="battle-hud__round" data-battle-round>Runda —</strong>
          <p class="battle-hud__turn-status" data-turn-status>Oczekiwanie na postać</p>
          <p class="battle-hud__auto-status" data-auto-status hidden>Auto: wyłączone</p>
          <ol class="battle-hud__turn-order" data-turn-order aria-label="Kolejność tur"></ol>
          <p class="battle-hud__feedback" data-battle-feedback role="status" aria-live="polite"></p>
          <button type="button" class="battle-hud__zoom-toggle" data-toggle-battle-zoom aria-label="Przybliż planszę" title="Przybliż planszę" aria-pressed="false">+</button>
          <button type="button" class="battle-hud__details-toggle" data-toggle-battle-details aria-expanded="false" aria-controls="battle-character-details">Postać</button>
        </div>
      </header>
      <aside class="battle-hud__sidebar" id="battle-character-details" data-battle-sidebar>
        <div class="battle-hud__sidebar-heading"><h2>Postać w walce</h2><button type="button" data-close-battle-details aria-label="Zamknij szczegóły postaci">×</button></div>
      <details class="battle-hud__section battle-hud__statistics" aria-label="Statystyki postaci">
        <summary>Atrybuty i obrażenia</summary>
        <dl class="battle-hud__stats" title="Obrażenia przed pancerzem celu i wpływem urazów">
          <div><dt>Wręcz</dt><dd data-melee-damage>—</dd></div>
          <div><dt>Dystans</dt><dd data-ranged-damage>—</dd></div>
          <div><dt>Pancerz</dt><dd data-armor>—</dd></div>
          <div data-staff-stat hidden><dt>Leczenie</dt><dd data-healing-power>—</dd></div>
          <div data-shield-stat hidden><dt>Tarcza</dt><dd data-shield-block>—</dd></div>
        </dl>
        <dl class="battle-hud__stats battle-hud__attributes" data-attributes hidden>
          <div><dt>Siła</dt><dd data-stat="strength">—</dd></div>
          <div><dt>Zręczność</dt><dd data-stat="dexterity">—</dd></div>
          <div><dt>Żywotność</dt><dd data-stat="vitality">—</dd></div>
        </dl>
      </details>
      <section class="battle-hud__section"><h2>Urazy</h2><p class="battle-hud__injuries" data-injuries>Brak urazów</p></section>
      <details class="battle-hud__section battle-hud__consumables" aria-label="Przedmioty do użycia w walce" open>
        <summary>Przedmioty <span class="battle-hud__cost">${BATTLE_ITEM_AP_COST} AP / użycie</span></summary>
        <div class="battle-hud__items" data-battle-items></div>
      </details>
      <section class="battle-hud__section battle-hud__team" aria-label="Drużyna w walce" data-battle-team hidden><h2>Drużyna</h2><div data-team-members></div></section>
      </aside>
      <section class="battle-hud__dock" data-battle-actions aria-label="Cel i akcje tury">
        <div class="battle-hud__target" data-battle-target></div>
        <div class="battle-hud__turn">
          <button type="button" class="battle-hud__auto" data-action="auto" hidden>Włącz auto</button>
          <button type="button" class="battle-hud__end-turn" data-action="end" disabled>Koniec tury</button>
        </div>
        <div class="battle-hud__healing" data-battle-healing hidden>
          <label class="battle-hud__heal-target" data-healing-target-label hidden>Cel leczenia<select data-battle-healing-target aria-label="Cel leczenia"></select></label>
          <button type="button" class="battle-hud__heal" data-action="heal-self" hidden disabled>Leczenie kosturem</button>
        </div>
      </section>
    `;
    this.itemsElement = this.requireElement("[data-battle-items]");
    this.feedbackElement = this.requireElement("[data-battle-feedback]");
    this.endButton = this.requireElement<HTMLButtonElement>("[data-action='end']");
    this.autoButton = this.requireElement<HTMLButtonElement>("[data-action='auto']");
    this.autoButton.hidden = !handlers.onToggleAuto;
    this.autoButton.addEventListener("click", () => {
      if (!this.destroyed && !this.pending && !this.commandPending && !this.autoPending && this.ownCombatant && this.ownCombatant.hp > 0) this.handlers.onToggleAuto?.();
    });
    this.requireElement<HTMLButtonElement>("[data-action='heal-self']").addEventListener("click",()=>{if(this.canAct() && this.healingPreview?.available)this.handlers.onHealSelf?.();});
    this.requireElement<HTMLSelectElement>("[data-battle-healing-target]").addEventListener("change",event=>{
      const id=(event.currentTarget as HTMLSelectElement).value;
      if(!this.destroyed && !this.pending && !this.commandPending && !this.autoPending && !this.autoBattle)this.handlers.onSelectHealingTarget?.(id);
    });
    for(const type of ["pointerdown","pointerup","mousedown","mouseup","touchstart","touchend"])this.root.addEventListener(type,event=>event.stopPropagation());
    this.root.addEventListener("focusin",()=>this.handlers.onTypingChange?.());
    this.root.addEventListener("focusout",()=>queueMicrotask(()=>this.handlers.onTypingChange?.()));
    this.endButton.addEventListener("click", () => {
      if (this.canAct()) this.handlers.onEndTurn();
    });
    document.body.appendChild(this.root);
    document.body.classList.add("has-battle-hud");
    this.requireElement("[data-toggle-battle-details]").addEventListener("click", () => this.setDetailsOpen(!this.detailsOpen));
    const zoomButton = this.requireElement("[data-toggle-battle-zoom]");
    zoomButton.hidden = !handlers.onToggleZoom;
    zoomButton.addEventListener("click", () => { if (!this.destroyed && this.compact) this.handlers.onToggleZoom?.(); });
    this.requireElement("[data-close-battle-details]").addEventListener("click", () => this.setDetailsOpen(false));
    document.addEventListener("game-ui-back", this.onBack);
    document.addEventListener("keydown", this.onKeyDown);
    this.setViewport(window.innerWidth, window.innerHeight);
    this.render();
  }

  get isTyping():boolean {
    return !this.destroyed && document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement) && document.activeElement.matches("select,input,textarea");
  }

  get busy(): boolean {
    return this.pending || this.autoPending || this.commandPending;
  }

  get attackCardHost(): HTMLElement { return this.requireElement("[data-battle-target]"); }

  get layoutElements(): HTMLElement[] {
    return ["[data-battle-header]", "[data-battle-sidebar]", "[data-battle-actions]"].map(selector => this.requireElement(selector));
  }

  getLayoutRegions(): BattleHudRegions {
    const measure = (selector: string): LayoutRect | undefined => {
      const element = this.requireElement(selector);
      if (element.hidden) return undefined;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 ? rect : undefined;
    };
    const header = measure("[data-battle-header]");
    const sidebar = this.compact ? undefined : measure("[data-battle-sidebar]");
    const actions = measure("[data-battle-actions]");
    const healing = this.root.dataset.hasHealing === "true";
    const portrait = this.root.dataset.portrait === "true";
    const fallbackHeight = this.compact ? portrait ? healing ? 228 : 160 : healing ? 136 : 76 : healing ? 166 : 112;
    // Chat/social live outside this root and share its actual action clearance.
    document.body.style.setProperty("--battle-ui-dock-height", `${actions?.height ?? fallbackHeight}px`);
    return { ...(header ? { header } : {}), ...(sidebar ? { sidebar } : {}), ...(actions ? { actions } : {}) };
  }

  setViewport(width: number, height: number): void {
    this.compact = width < 1100 || height < 600;
    this.root.dataset.compact = String(this.compact);
    this.root.dataset.portrait = String(width < 600);
    this.requireElement("[data-battle-sidebar]").hidden = this.compact && !this.detailsOpen;
  }

  setBoardZoomed(enabled: boolean): void {
    const button = this.requireElement("[data-toggle-battle-zoom]");
    const label = enabled ? "Pokaż całą planszę" : "Przybliż planszę";
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", label);
    button.title = label;
    button.textContent = enabled ? "−" : "+";
  }

  private setDetailsOpen(open: boolean): void {
    this.detailsOpen = open;
    this.requireElement("[data-battle-sidebar]").hidden = this.compact && !open;
    this.requireElement("[data-toggle-battle-details]").setAttribute("aria-expanded", String(open));
    this.handlers.onLayoutChanged?.();
    if (!open && this.compact) this.requireElement("[data-toggle-battle-details]").focus();
  }

  setBattleContext(battle: BattleSnapshot | undefined, commandPending = false): void {
    if (this.destroyed) return;
    this.battle = battle;
    this.commandPending = commandPending;
    this.render();
  }

  update(
    ownCombatant: CombatantSnapshot | undefined,
    ownedTurn: boolean,
    inventory: InventorySnapshot,
    character?: CharacterSnapshot,
    healingPreview?:ReturnType<typeof getBattleHealingPreview>,
    team?:BattleHudTeam
  ): void {
    if (this.destroyed) return;
    this.ownCombatant = ownCombatant;
    this.ownedTurn = ownedTurn;
    this.inventory = inventory;
    this.character = character;
    this.healingPreview=healingPreview;
    this.team=team;
    this.render();
  }

  setStatus(message: string): void {
    if (this.destroyed) return;
    this.feedbackElement.textContent = message;
    this.feedbackElement.dataset.state = "info";
    this.root.dataset.hasFeedback = String(Boolean(message));
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
    document.removeEventListener("game-ui-back", this.onBack);
    document.removeEventListener("keydown", this.onKeyDown);
    this.root.remove();
    document.body.classList.remove("has-battle-hud");
    document.body.style.removeProperty("--battle-ui-dock-height");
  }

  private render(): void {
    const combatant = this.ownCombatant;
    this.root.dataset.hasFeedback = String(Boolean(this.feedbackElement.textContent));
    this.renderTurnOrder();
    this.requireElement("[data-name]").textContent = combatant?.name ?? "Brak postaci";
    this.requireElement("[data-level]").textContent = combatant?.level === undefined ? "—" : `${combatant.level}`;
    this.requireElement("[data-initiative]").textContent = combatant ? `${combatant.initiative}` : "—";
    this.requireElement("[data-hp]").textContent = combatant ? `${combatant.hp}/${combatant.maxHp}` : "—";
    this.requireElement("[data-ap]").textContent = combatant ? `${combatant.ap}/${combatant.maxAp}` : "—";
    this.setMeter("[data-hp-fill]", combatant?.hp ?? 0, combatant?.maxHp ?? 0);
    this.setMeter("[data-ap-fill]", combatant?.ap ?? 0, combatant?.maxAp ?? 0);
    this.requireElement("[data-ap-fill]").style.setProperty("--battle-ap-segments", String(Math.max(1, combatant?.maxAp ?? 1)));
    this.requireElement("[data-melee-damage]").textContent = combatant?.combatStats ? `${combatant.combatStats.meleeDamage}` : "—";
    this.requireElement("[data-ranged-damage]").textContent = combatant?.combatStats ? `${combatant.combatStats.rangedDamage}` : "—";
    this.requireElement("[data-armor]").textContent = combatant?.combatStats ? `${combatant.combatStats.armor}` : "—";
    const healingPower=combatant?.combatStats?.healingPower??0,blockPercent=combatant?.combatStats?.blockPercent??0;
    this.requireElement("[data-staff-stat]").hidden=healingPower<=0;
    this.requireElement("[data-healing-power]").textContent=`${healingPower} HP`;
    this.requireElement("[data-shield-stat]").hidden=blockPercent<=0;
    this.requireElement("[data-shield-block]").textContent=`${new Intl.NumberFormat("pl-PL",{maximumFractionDigits:2}).format(blockPercent)}%`;
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
    const activeAlly=this.team?.members.find(member=>member.id===this.team?.activeCombatantId);
    const active = this.battle?.combatants.find(unit => unit.id === this.battle?.activeCombatantId);
    this.requireElement("[data-turn-status]").textContent = this.commandPending ? "Oczekiwanie na serwer…" : !combatant ? "Oczekiwanie na postać"
      : combatant.hp <= 0 ? "Postać pokonana"
        : this.ownedTurn ? "Twoja tura"
          : activeAlly?.id===combatant.id ? "Oczekiwanie na serwer…"
            : activeAlly ? `Tura: ${activeAlly.name} (drużyna)` : active ? `Tura: ${active.name}` : "Tura przeciwnika";
    this.root.dataset.ownedTurn = `${this.ownedTurn}`;
    this.root.setAttribute("aria-busy", `${this.busy}`);
    const autoStatus = this.requireElement("[data-auto-status]");
    autoStatus.hidden = !this.autoBattle && !this.autoPending;
    autoStatus.textContent = this.autoPending ? "Zmiana sterowania…" : "Auto: włączone";
    this.autoButton.textContent = this.autoBattle ? "Przejmij sterowanie" : "Włącz auto";
    this.autoButton.disabled = this.pending || this.commandPending || this.autoPending || !combatant || combatant.hp <= 0;
    this.root.dataset.autoBattle = String(this.autoBattle);
    this.endButton.disabled = !this.canAct();
    const heal=this.requireElement<HTMLButtonElement>("[data-action='heal-self']");
    heal.hidden=!this.handlers.onHealSelf || !(combatant?.combatStats?.healingPower);
    this.requireElement("[data-battle-healing]").hidden=heal.hidden;
    this.root.dataset.hasHealing=String(!heal.hidden);
    heal.disabled=!this.canAct() || !this.healingPreview?.available;
    const selected=this.team?.members.find(member=>member.id===this.team?.healingTargetId);
    const targetName=selected && selected.id!==combatant?.id ? selected.name : "siebie";
    heal.textContent=`Ulecz ${targetName} · ${this.healingPreview?.amount??0} HP · ${this.healingPreview?.apCost??3} AP`;
    heal.title=this.healingPreview?.reason??"Leczenie kosturem raz na turę";
    this.renderTeam();
    this.renderItems();
  }

  private renderTeam():void {
    const members=this.team?.members??(this.ownCombatant?[this.ownCombatant]:[]);
    const section=this.requireElement("[data-battle-team]"),list=this.requireElement("[data-team-members]");
    section.hidden=members.length<2;list.replaceChildren();
    for(const member of members){
      const row=document.createElement("div");row.className="battle-hud__team-member";row.dataset.teamMember=member.id;
      row.dataset.active=String(member.id===this.team?.activeCombatantId);row.dataset.own=String(member.id===this.ownCombatant?.id);
      const name=document.createElement("strong");name.textContent=`${member.name}${member.id===this.ownCombatant?.id?" (Ty)":""}`;
      const hp=document.createElement("span");hp.textContent=`${member.hp}/${member.maxHp} HP`;
      const state=document.createElement("small");state.textContent=member.hp<=0?"Postać pokonana":member.id===this.team?.activeCombatantId?"Wykonuje turę":"";
      row.append(name,hp,state);list.append(row);
    }
    const label=this.requireElement("[data-healing-target-label]"),select=this.requireElement<HTMLSelectElement>("[data-battle-healing-target]");
    label.hidden=!this.handlers.onSelectHealingTarget || !(this.ownCombatant?.combatStats?.healingPower);
    select.disabled=this.pending || this.commandPending || this.autoPending || this.autoBattle || !this.ownCombatant || this.ownCombatant.hp<=0;
    select.replaceChildren();
    for(const member of members.filter(member=>member.hp>0)){
      const option=document.createElement("option");option.value=member.id;option.textContent=`${member.name}${member.id===this.ownCombatant?.id?" (Ty)":""} · ${member.hp}/${member.maxHp} HP`;select.append(option);
    }
    select.value=this.team?.healingTargetId??this.ownCombatant?.id??"";
  }

  private renderTurnOrder(): void {
    this.requireElement("[data-battle-round]").textContent = `Runda ${this.battle?.round ?? "—"}`;
    const list = this.requireElement("[data-turn-order]");
    list.replaceChildren();
    for (const id of this.battle?.turnOrder ?? []) {
      const unit = this.battle?.combatants.find(combatant => combatant.id === id);
      if (!unit) continue;
      const entry = document.createElement("li");
      entry.dataset.turnCombatant = id;
      entry.textContent = unit.name;
      entry.title = `${unit.name} · ${unit.hp}/${unit.maxHp} HP`;
      entry.setAttribute("aria-current", String(id === this.battle?.activeCombatantId));
      entry.dataset.defeated = String(unit.hp <= 0);
      list.appendChild(entry);
    }
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
      applyItemQualityFrame(icon,item);
      if (item.iconUrl) {
        const image = document.createElement("img");
        image.src = item.iconUrl;
        image.alt = "";
        image.addEventListener("error", () => image.remove(), { once: true });
        icon.appendChild(image);
      }
      const name = document.createElement("strong");
      name.textContent = `${item.name} · ${itemQualityText(item)}`;
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
    return !this.destroyed && !this.pending && !this.commandPending && !this.autoBattle && !this.autoPending && this.ownedTurn && !!this.ownCombatant && this.ownCombatant.hp > 0;
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
    if (this.pending || this.commandPending) return "Oczekiwanie na serwer…";
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
