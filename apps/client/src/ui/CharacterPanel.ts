import {
  getCharacterStatistics,
  getWeaponCombatStatistics,
  getWeaponProficiency,
  normalizeWeaponTraining,
  WEAPON_FAMILIES,
  MAX_CHARACTER_LEVEL,
  type CharacterSnapshot,
  type InjuryKind,
  type WeaponLoadout,
  type WeaponLoadoutResult
} from "@web-mmorpg/shared";
import { experienceProgressMarkup } from "./ExperienceProgress";

const INJURY_LABELS: Record<InjuryKind, string> = {
  brokenArm: "Złamana ręka",
  legTrauma: "Uraz nogi",
  bleeding: "Krwawienie",
  concussion: "Wstrząśnienie",
  chestWound: "Rana klatki piersiowej",
  burn: "Oparzenie",
  poison: "Zatrucie"
};

interface CharacterPanelHandlers {
  onSetWeaponLoadout: (loadout: WeaponLoadout) => Promise<WeaponLoadoutResult>;
  onChanged: (character: CharacterSnapshot) => void;
  onTypingChange?: () => void;
}

export class CharacterPanel {
  private readonly root: HTMLDivElement;
  private readonly content: HTMLDivElement;
  private character: CharacterSnapshot | undefined;
  private draft: WeaponLoadout | undefined;
  private savedLoadout: WeaponLoadout | undefined;
  private saving = false;
  private requestVersion = 0;
  private destroyed = false;
  private status = "";

  constructor(private readonly handlers?: CharacterPanelHandlers) {
    this.root = document.createElement("div");
    this.root.className = "game-panel game-panel--character is-hidden";
    this.root.innerHTML = `
      <div class="game-panel__header">
        <h2>Postać</h2>
        <button type="button" data-close aria-label="Zamknij">×</button>
      </div>
      <div class="character-sheet" data-content></div>
    `;
    document.body.appendChild(this.root);
    this.content = this.require<HTMLDivElement>("[data-content]");
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"]) {
      this.root.addEventListener(type, event => event.stopPropagation());
    }
    this.require<HTMLButtonElement>("[data-close]").addEventListener("click", () => this.hide());
    this.root.addEventListener("focusin", () => this.handlers?.onTypingChange?.());
    this.root.addEventListener("focusout", () => queueMicrotask(() => this.handlers?.onTypingChange?.()));
  }

  update(character: CharacterSnapshot): void {
    if (this.destroyed) return;
    const training = normalizeWeaponTraining(character.weaponTraining);
    const sameCharacter = this.character?.playerId === character.playerId;
    const dirty = this.draft && this.savedLoadout &&
      (this.draft.melee !== this.savedLoadout.melee || this.draft.ranged !== this.savedLoadout.ranged);
    if (!sameCharacter) {
      this.requestVersion += 1;
      this.saving = false;
      this.status = "";
    }
    if (!sameCharacter || !this.draft || (!this.saving && !dirty)) this.draft = { ...training.loadout };
    this.savedLoadout = { ...training.loadout };
    this.character = structuredClone(character);
    const focusedMode = this.isTyping
      ? (document.activeElement as HTMLElement).hasAttribute("data-weapon-melee") ? "melee" : "ranged"
      : undefined;
    const injuries = character.injuries.length
      ? character.injuries.map((injury) => INJURY_LABELS[injury]).join(", ")
      : "Brak";
    const statistics = character.statistics ?? getWeaponCombatStatistics(getCharacterStatistics(character.level), training);
    const currentBase = getCharacterStatistics(character.level);
    const next = getCharacterStatistics(character.level + 1);
    const bonuses = [
      `+${next.strength - currentBase.strength} STR`,
      `+${next.dexterity - currentBase.dexterity} DEX`,
      `+${next.vitality - currentBase.vitality} VIT`,
      `+${next.maxHp - currentBase.maxHp} HP`,
      `+${next.meleeDamage - currentBase.meleeDamage} obrażeń wręcz`,
      `+${next.rangedDamage - currentBase.rangedDamage} obrażeń dystansowych`,
      `+${next.armor - currentBase.armor} pancerza`,
      ...(next.maxAp > currentBase.maxAp ? [`+${next.maxAp - currentBase.maxAp} AP`] : []),
      ...(next.initiative > currentBase.initiative ? [`+${next.initiative - currentBase.initiative} inicjatywy`] : [])
    ];
    const growth = character.level >= MAX_CHARACTER_LEVEL
      ? "Osiągnięto maksymalny poziom."
      : `Poziom ${character.level + 1}: ${bonuses.join(", ")}.`;

    this.content.innerHTML = `
      <dl class="character-sheet__stats">
        <div><dt>Imię</dt><dd data-name></dd></div>
        <div><dt>Poziom</dt><dd>${character.level}</dd></div>
        <div><dt>HP</dt><dd data-stat="hp">${character.hp}/${character.maxHp}</dd></div>
        <div><dt>AP na turę</dt><dd data-stat="maxAp">${character.maxAp}</dd></div>
        <div><dt>Inicjatywa</dt><dd data-stat="initiative">${character.initiative}</dd></div>
        <div><dt>Stan</dt><dd>${character.severelyInjured ? "Ciężko ranny" : "Stabilny"}</dd></div>
      </dl>
      ${experienceProgressMarkup(character)}
      <section class="character-sheet__section">
        <h3>Atrybuty i walka</h3>
        <dl class="character-sheet__stats">
          <div><dt>Siła (STR)</dt><dd data-stat="strength">${statistics.strength}</dd></div>
          <div><dt>Zręczność (DEX)</dt><dd data-stat="dexterity">${statistics.dexterity}</dd></div>
          <div><dt>Żywotność (VIT)</dt><dd data-stat="vitality">${statistics.vitality}</dd></div>
          <div><dt>Obrażenia wręcz</dt><dd data-stat="meleeDamage">${statistics.meleeDamage}</dd></div>
          <div><dt>Obrażenia dystansowe</dt><dd data-stat="rangedDamage">${statistics.rangedDamage}</dd></div>
          <div><dt>Pancerz</dt><dd data-stat="armor">${statistics.armor}</dd></div>
        </dl>
        <p>STR zwiększa obrażenia wręcz, DEX obrażenia dystansowe, a VIT maksymalne HP. Pancerz zmniejsza otrzymywane obrażenia.</p>
        <p>Obrażenia podano przed pancerzem celu i wpływem urazów.</p>
      </section>
      <section class="character-sheet__section">
        <h3>Władanie bronią</h3>
        <p>Każdy skuteczny atak rozwija używany styl o 1 punkt treningu, także w trybie Auto. Biegłość 0–100 zwiększa obrażenia do 25%. Nowy bonus działa od następnej walki.</p>
        <div class="weapon-proficiencies">
          ${WEAPON_FAMILIES.map(family => {
            const skill = getWeaponProficiency(training.experience[family.id]);
            const bonus = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(skill.damageBonusPercent);
            return `<div class="weapon-proficiency" data-weapon-family="${family.id}">
              <div class="weapon-proficiency__summary"><strong>${family.label}</strong><span data-weapon-level>${skill.level}/100</span><span data-weapon-bonus>+${bonus}% obrażeń</span></div>
              <div class="weapon-proficiency__bar" role="progressbar" aria-label="Biegłość: ${family.label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${skill.percentage}"><span style="width:${skill.percentage}%"></span></div>
              <small>${skill.level === 100 ? "Maksymalna biegłość" : `${skill.current} / ${skill.required} punktów do kolejnego poziomu`}</small>
            </div>`;
          }).join("")}
        </div>
        <fieldset class="weapon-style" ${this.saving || !this.handlers ? "disabled" : ""}>
          <legend>Stosowany styl broni</legend>
          <label>Walka wręcz<select data-weapon-melee>${WEAPON_FAMILIES.filter(family => family.mode === "melee").map(family => `<option value="${family.id}" ${this.draft?.melee === family.id ? "selected" : ""}>${family.label}</option>`).join("")}</select></label>
          <label>Walka dystansowa<select data-weapon-ranged>${WEAPON_FAMILIES.filter(family => family.mode === "ranged").map(family => `<option value="${family.id}" ${this.draft?.ranged === family.id ? "selected" : ""}>${family.label}</option>`).join("")}</select></label>
          <button type="button" data-save-weapon-style ${this.saving ? "disabled" : ""}>${this.saving ? "Zapisywanie…" : "Zapisz style"}</button>
        </fieldset>
        <p>Wybór stylu określa biegłość trenowaną przez ataki wręcz i dystansowe. Można go zmienić poza walką; nie zakłada przedmiotu z ekwipunku.</p>
        <p role="status" data-weapon-style-status></p>
      </section>
      <section class="character-sheet__section">
        <h3>Automatyczny rozwój</h3>
        <p>Statystyki rosną automatycznie przy awansie. Inicjatywa rośnie co 2 poziomy, a AP co 10 poziomów, do 8 AP.</p>
        <p data-next-growth>${growth}</p>
      </section>
      <section class="character-sheet__section">
        <h3>Urazy</h3>
        <p data-injuries></p>
      </section>
    `;

    const name = this.content.querySelector<HTMLElement>("[data-name]");
    if (name) name.textContent = character.nickname;
    const injuryElement = this.content.querySelector<HTMLElement>("[data-injuries]");
    if (injuryElement) injuryElement.textContent = injuries;
    this.require<HTMLElement>("[data-weapon-style-status]").textContent = this.status;
    for (const mode of ["melee", "ranged"] as const) {
      const select = this.require<HTMLSelectElement>(`[data-weapon-${mode}]`);
      select.addEventListener("change", () => {
        if (this.draft) Object.assign(this.draft, { [mode]: select.value });
        this.status = "Niezapisane zmiany stylów.";
        this.require<HTMLElement>("[data-weapon-style-status]").textContent = this.status;
      });
    }
    this.require<HTMLButtonElement>("[data-save-weapon-style]").addEventListener("click", () => { void this.saveStyles(); });
    if (focusedMode && !this.saving) this.require<HTMLSelectElement>(`[data-weapon-${focusedMode}]`).focus();
    this.handlers?.onTypingChange?.();
  }

  get isTyping(): boolean {
    const active = document.activeElement;
    return !this.root.classList.contains("is-hidden") && active instanceof HTMLElement &&
      this.root.contains(active) && active.matches("select, input, textarea");
  }

  private async saveStyles(): Promise<void> {
    if (this.destroyed || this.saving || !this.handlers || !this.draft || !this.character) return;
    const version = ++this.requestVersion, playerId = this.character.playerId;
    const loadout = { ...this.draft };
    this.saving = true;
    this.status = "";
    this.update(this.character);
    let result: WeaponLoadoutResult;
    try {
      result = await this.handlers.onSetWeaponLoadout(loadout);
    } catch {
      result = { ok: false, code: "WEAPON_STYLE_UPDATE_FAILED", message: "Nie otrzymano potwierdzenia zapisu stylów broni." };
    }
    if (this.destroyed || version !== this.requestVersion || this.character?.playerId !== playerId) return;
    this.saving = false;
    if (result.ok && result.character.playerId === playerId) {
      this.draft = { ...normalizeWeaponTraining(result.character.weaponTraining).loadout };
      this.savedLoadout = { ...this.draft };
      this.status = "Zapisano style broni.";
      this.update(result.character);
      this.handlers.onChanged(result.character);
    } else {
      this.status = result.ok ? "Połączenie postaci zmieniło się. Otwórz panel ponownie." : result.message;
      this.update(this.character);
    }
  }

  show(): void {
    if (this.character) this.update(this.character);
    this.root.classList.remove("is-hidden");
  }

  hide(): void {
    this.root.classList.add("is-hidden");
    this.requestVersion += 1;
    this.saving = false;
    if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) document.activeElement.blur();
    this.handlers?.onTypingChange?.();
  }

  toggle(): void {
    if (this.root.classList.contains("is-hidden")) this.show(); else this.hide();
  }

  destroy(): void {
    this.hide();
    this.destroyed = true;
    this.root.remove();
  }

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Character panel element missing: ${selector}`);
    return element;
  }
}
