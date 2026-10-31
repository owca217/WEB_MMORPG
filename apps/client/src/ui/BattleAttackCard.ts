import type { BattleAttackPreview } from "@web-mmorpg/shared";
import type { LayoutRect } from "../scenes/battleLayout";
import "./BattleAttackCard.css";

export class BattleAttackCard {
  private readonly root = document.createElement("div");
  private preview: BattleAttackPreview | null = null;
  private readonly button: HTMLButtonElement;
  constructor(onAttack: (targetId: string) => void, host: HTMLElement = document.body) {
    this.root.className = "battle-attack-card";
    this.root.dataset.attackPreview = "";
    this.root.setAttribute("aria-label", "Podgląd ataku");
    this.root.setAttribute("role", "group");
    this.root.innerHTML = `<strong data-target-name></strong>
      <button type="button" data-confirm-attack></button>
      <span data-hit-chance></span><span data-average-damage></span><small data-attack-reason role="status"></small>`;
    this.button = this.root.querySelector<HTMLButtonElement>("button")!;
    this.button.addEventListener("click", () => {
      if (this.preview?.available) onAttack(this.preview.targetId);
    });
    host.appendChild(this.root);
    this.hide();
  }
  show(preview: BattleAttackPreview, name: string, _x: number, _y: number, _arena: LayoutRect): void {
    this.preview = preview;
    this.root.dataset.empty = "false";
    this.root.querySelector<HTMLElement>("[data-target-name]")!.textContent = name;
    this.button.textContent = `${preview.type === "meleeAttack" ? "Atak wręcz" : "Atak dystansowy"} · ${preview.apCost} AP`;
    this.button.disabled = !preview.available;
    this.button.hidden = false;
    this.root.querySelector<HTMLElement>("[data-hit-chance]")!.textContent = `${preview.hitChance}% szans na trafienie`;
    this.root.querySelector<HTMLElement>("[data-average-damage]")!.textContent = `Średnie obrażenia: ${preview.averageDamage}`;
    this.root.querySelector<HTMLElement>("[data-attack-reason]")!.textContent = preview.reason ?? "";
  }
  hide(): void {
    this.preview = null;
    this.root.dataset.empty = "true";
    this.root.querySelector<HTMLElement>("[data-target-name]")!.textContent = "Wybierz cel na planszy";
    this.root.querySelector<HTMLElement>("[data-hit-chance]")!.textContent = "Dotknij przeciwnika, aby zaplanować atak.";
    this.root.querySelector<HTMLElement>("[data-average-damage]")!.textContent = "";
    this.root.querySelector<HTMLElement>("[data-attack-reason]")!.textContent = "";
    this.button.hidden = true;
    this.button.disabled = true;
  }
  destroy(): void { this.root.remove(); this.preview = null; }
}
