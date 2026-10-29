import type { BattleAttackPreview } from "@web-mmorpg/shared";
import type { LayoutRect } from "../scenes/battleLayout";
import "./BattleAttackCard.css";

export class BattleAttackCard {
  private readonly root = document.createElement("div");
  private preview: BattleAttackPreview | null = null;
  private readonly button: HTMLButtonElement;
  constructor(onAttack: (targetId: string) => void) {
    this.root.className = "battle-attack-card";
    this.root.dataset.attackPreview = "";
    this.root.hidden = true;
    this.root.setAttribute("aria-label", "Podgląd ataku");
    this.root.innerHTML = `<strong data-target-name></strong>
      <button type="button" data-confirm-attack></button>
      <span data-hit-chance></span><span data-average-damage></span><small data-attack-reason role="status"></small>`;
    this.button = this.root.querySelector<HTMLButtonElement>("button")!;
    this.button.addEventListener("click", () => {
      if (this.preview?.available) onAttack(this.preview.targetId);
    });
    document.body.appendChild(this.root);
  }
  show(preview: BattleAttackPreview, name: string, x: number, y: number, arena: LayoutRect): void {
    this.preview = preview;
    this.root.hidden = false;
    this.root.querySelector<HTMLElement>("[data-target-name]")!.textContent = name;
    this.button.textContent = `${preview.type === "meleeAttack" ? "Atak wręcz" : "Atak dystansowy"} · ${preview.apCost} AP`;
    this.button.disabled = !preview.available;
    this.root.querySelector<HTMLElement>("[data-hit-chance]")!.textContent = `${preview.hitChance}% szans na trafienie`;
    this.root.querySelector<HTMLElement>("[data-average-damage]")!.textContent = `Średnie obrażenia: ${preview.averageDamage}`;
    this.root.querySelector<HTMLElement>("[data-attack-reason]")!.textContent = preview.reason ?? "";
    const width = this.root.offsetWidth || Math.min(216, arena.width);
    const height = this.root.offsetHeight || 156;
    const left = Math.max(arena.x, Math.min(x - width / 2, arena.x + arena.width - width));
    const above = y - height - 28;
    const top = above >= arena.y ? above : Math.min(y + 26, arena.y + arena.height - height);
    this.root.style.maxWidth = `${arena.width}px`;
    this.root.style.left = `${left}px`;
    this.root.style.top = `${Math.max(arena.y, top)}px`;
  }
  hide(): void { this.preview = null; this.root.hidden = true; }
  destroy(): void { this.root.remove(); this.preview = null; }
}
