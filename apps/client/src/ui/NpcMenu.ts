import type { NpcSnapshot } from "@web-mmorpg/shared";
import "./EncounterMenu.css";

interface NpcMenuHandlers {
  onSelect: (npcId: string, action: "talk" | "shop") => void;
}
interface MenuAnchor { x: number; y: number }

/** Choosing an NPC action is separate from opening this scene-owned menu. */
export class NpcMenu {
  private readonly root: HTMLDivElement;
  private readonly label: HTMLElement;
  private readonly shopButton: HTMLButtonElement;
  private readonly actions: HTMLElement;
  private npcId: string | null = null;
  private merchant = false;
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

  constructor(private readonly handlers: NpcMenuHandlers) {
    this.root = document.createElement("div");
    this.root.className = "game-panel encounter-menu npc-menu";
    this.root.dataset.npcMenu = "";
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-label", "Wybierz działanie NPC");
    this.root.innerHTML = `
      <div class="encounter-menu__header"><strong data-npc-label></strong><button type="button" data-close aria-label="Zamknij menu NPC">×</button></div>
      <div class="encounter-menu__actions" data-npc-actions><button type="button" data-npc-action="talk">Rozmowa</button><button type="button" data-npc-action="shop" hidden>Sklep</button></div>`;
    this.label = this.root.querySelector<HTMLElement>("[data-npc-label]")!;
    this.shopButton = this.root.querySelector<HTMLButtonElement>('[data-npc-action="shop"]')!;
    this.actions = this.root.querySelector<HTMLElement>("[data-npc-actions]")!;
    this.root.querySelector<HTMLButtonElement>("[data-close]")!.addEventListener("click", () => this.hide());
    for (const action of ["talk", "shop"] as const) {
      this.root.querySelector<HTMLButtonElement>(`[data-npc-action="${action}"]`)!.addEventListener("click", () => {
        const id = this.npcId;
        if (this.destroyed || this.root.hidden || !id || (action === "shop" && !this.merchant)) return;
        this.hide();
        this.handlers.onSelect(id, action);
      });
    }
    this.root.addEventListener("pointerdown", event => event.stopPropagation());
    this.root.addEventListener("pointerup", event => event.stopPropagation());
    document.body.appendChild(this.root);
    document.addEventListener("pointerdown", this.onOutside, true);
    document.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.onResize);
    this.viewport = window.visualViewport;
    this.viewport?.addEventListener("resize", this.onResize);
    this.viewport?.addEventListener("scroll", this.onResize);
  }

  show(npc: Pick<NpcSnapshot, "id" | "name" | "kind">, anchor: MenuAnchor): void {
    if (this.destroyed) return;
    this.npcId = npc.id;
    this.merchant = npc.kind === "merchant";
    this.label.textContent = npc.name;
    this.shopButton.hidden = !this.merchant;
    this.actions.style.gridTemplateColumns = this.merchant ? "1fr 1fr" : "1fr";
    this.root.hidden = false;
    this.reposition(anchor);
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
    this.npcId = null;
    this.merchant = false;
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
