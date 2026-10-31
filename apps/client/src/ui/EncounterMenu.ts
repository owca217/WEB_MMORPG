import "./EncounterMenu.css";
import { getEnemyDefinition, type EncounterSnapshot } from "@web-mmorpg/shared";
import { encounterAvailable, encounterLabel, encounterStatusText } from "../world/encounterPresentation";

interface EncounterMenuHandlers {
  onSelect: (encounterId: string, mode: "manual" | "auto") => void;
}
interface MenuAnchor { x: number; y: number }

/** A scene-owned, viewport-anchored choice. Opening it never starts a battle. */
export class EncounterMenu {
  private readonly root: HTMLDivElement;
  private readonly label: HTMLElement;
  private readonly status: HTMLElement;
  private readonly details: HTMLElement;
  private available=true;
  private encounterId: string | null = null;
  private anchor: MenuAnchor = { x: 0, y: 0 };
  private destroyed = false;
  private readonly viewport: VisualViewport | null;
  private readonly onOutside = (event: Event): void => {
    if (event.target instanceof Node && !this.root.contains(event.target)) this.hide();
  };
  private readonly onKey = (event: KeyboardEvent): void => {
    if (!this.root.hidden && event.key === "Escape") {
      event.preventDefault(); event.stopPropagation(); this.hide();
    }
  };
  private readonly onResize = (): void => this.reposition(this.anchor);

  constructor(private readonly handlers: EncounterMenuHandlers) {
    this.root = document.createElement("div");
    this.root.className = "game-panel encounter-menu";
    this.root.dataset.encounterMenu = "";
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Wybierz tryb walki");
    this.root.innerHTML = `
      <div class="encounter-menu__header"><strong data-encounter-label></strong><button type="button" data-close aria-label="Zamknij menu potwora">×</button></div>
      <div class="encounter-menu__details" data-encounter-details hidden></div>
      <p data-encounter-status role="status" hidden></p>
      <div class="encounter-menu__actions"><button type="button" data-encounter-mode="manual">Walcz</button><button type="button" data-encounter-mode="auto">Auto</button></div>`;
    this.label = this.root.querySelector<HTMLElement>("[data-encounter-label]")!;
    this.status = this.root.querySelector<HTMLElement>("[data-encounter-status]")!;
    this.details = this.root.querySelector<HTMLElement>("[data-encounter-details]")!;
    this.root.querySelector<HTMLButtonElement>("[data-close]")!.addEventListener("click", () => this.hide());
    for (const mode of ["manual", "auto"] as const) {
      this.root.querySelector<HTMLButtonElement>(`[data-encounter-mode="${mode}"]`)!.addEventListener("click", () => {
        const id = this.encounterId;
        if (this.destroyed || this.root.hidden || !id || !this.available) return;
        this.hide();
        this.handlers.onSelect(id, mode);
      });
    }
    this.root.addEventListener("pointerdown", event => event.stopPropagation());
    this.root.addEventListener("pointerup", event => event.stopPropagation());
    document.body.appendChild(this.root);
    // Capture pointerdown, not click: Phaser opens the menu on the later pointerup.
    document.addEventListener("pointerdown", this.onOutside, true);
    document.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.onResize);
    this.viewport = window.visualViewport;
    this.viewport?.addEventListener("resize", this.onResize);
    this.viewport?.addEventListener("scroll", this.onResize);
  }

  show(encounter: Pick<EncounterSnapshot,"id"|"label"|"status"|"respawnAt"|"enemyId">, anchor: MenuAnchor,serverNow=Date.now()): void {
    if (this.destroyed) return;
    this.encounterId = encounter.id;
    this.root.hidden = false;
    this.update(encounter,serverNow);
    this.reposition(anchor);
  }

  update(encounter:Pick<EncounterSnapshot,"id"|"label"|"status"|"respawnAt"|"enemyId">,serverNow=Date.now()):void {
    if(this.destroyed || this.encounterId!==encounter.id)return;
    const enemy = encounter.enemyId ? getEnemyDefinition(encounter.enemyId) : undefined;
    this.label.textContent = enemy?.name ?? encounterLabel(encounter);
    this.details.replaceChildren();
    this.details.hidden = !enemy;
    if (enemy) {
      const description = document.createElement("p");
      description.dataset.encounterDescription = "";
      description.textContent = enemy.description;
      const stats = document.createElement("dl");
      const values: [string, string | number][] = [
        ["Poziom", enemy.level],
        ["Zalecany poziom", `${enemy.recommendedLevels[0]}–${enemy.recommendedLevels[1]}`],
        ["HP", enemy.maxHp],
        ["Obrażenia wręcz", enemy.combatStats.meleeDamage],
        ["Obrażenia dystansowe", enemy.combatStats.rangedDamage],
        ["Pancerz", enemy.combatStats.armor],
        ["PD", enemy.experienceReward]
      ];
      for (const [name, value] of values) {
        const term = document.createElement("dt");
        const amount = document.createElement("dd");
        term.textContent = name;
        amount.textContent = String(value);
        stats.append(term, amount);
      }
      this.details.append(description, stats);
    }
    this.available=encounterAvailable(encounter);
    this.status.textContent=encounterStatusText(encounter,serverNow);
    this.status.hidden=!this.status.textContent;
    for(const button of this.root.querySelectorAll<HTMLButtonElement>("[data-encounter-mode]"))button.disabled=!this.available;
  }

  reposition(anchor: MenuAnchor): void {
    if (this.destroyed || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return;
    this.anchor = { ...anchor };
    if (this.root.hidden) return;
    const margin = 12;
    const safeStyle = getComputedStyle(document.documentElement);
    const safe = (edge: string): number => Number.parseFloat(safeStyle.getPropertyValue(`--safe-area-${edge}`)) || 0;
    const viewportLeft = this.viewport?.offsetLeft ?? 0;
    const viewportTop = this.viewport?.offsetTop ?? 0;
    const viewportWidth = this.viewport?.width ?? window.innerWidth;
    const viewportHeight = this.viewport?.height ?? window.innerHeight;
    const rect = this.root.getBoundingClientRect();
    const leftEdge = viewportLeft + margin + safe("left");
    const topEdge = viewportTop + margin + safe("top");
    const width = Math.min(rect.width || 208, Math.max(0, viewportWidth - margin * 2 - safe("left") - safe("right")));
    const height = rect.height || 128;
    const right = viewportLeft + viewportWidth - margin - safe("right");
    const bottom = viewportTop + viewportHeight - margin - safe("bottom");
    const preferredLeft = anchor.x + 18 + width <= right ? anchor.x + 18 : anchor.x - width - 18;
    this.root.style.left = `${Math.max(leftEdge, Math.min(preferredLeft, right - width))}px`;
    this.root.style.top = `${Math.max(topEdge, Math.min(anchor.y - 44, bottom - height))}px`;
  }

  hide(): void {
    if (this.destroyed) return;
    this.root.hidden = true;
    this.encounterId = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.hide();
    this.destroyed = true;
    document.removeEventListener("pointerdown", this.onOutside, true);
    document.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("resize", this.onResize);
    this.viewport?.removeEventListener("resize", this.onResize);
    this.viewport?.removeEventListener("scroll", this.onResize);
    this.root.remove();
  }
}
