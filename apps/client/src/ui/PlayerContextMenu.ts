import "./EncounterMenu.css";

interface PlayerMenuHandlers {
  onParty: (playerId: string) => void;
  onTrade: (playerId: string) => void;
}
interface MenuAnchor { x: number; y: number }
let nextPlayerMenuId = 0;

/** Selection is scene-owned; social actions retain the selected player's exact ID. */
export class PlayerContextMenu {
  private readonly root = document.createElement("div");
  private readonly label: HTMLElement;
  private readonly viewport: VisualViewport | null;
  private playerId: string | null = null;
  private anchor: MenuAnchor = { x: 0, y: 0 };
  private returnFocus: HTMLElement | null = null;
  private destroyed = false;
  private readonly onOutside = (event: Event): void => {
    if (event.target instanceof Node && !this.root.contains(event.target)) this.hide(false);
  };
  private readonly onKey = (event: KeyboardEvent): void => {
    if (this.root.hidden || event.defaultPrevented) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); this.hide(); }
    else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && event.target instanceof Node && this.root.contains(event.target)) {
      const items = [...this.root.querySelectorAll<HTMLButtonElement>("[data-player-action]")];
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      items[(current + direction + items.length) % items.length]?.focus();
      event.preventDefault(); event.stopPropagation();
    }
  };
  private readonly onResize = (): void => this.reposition(this.anchor);

  constructor(private readonly handlers: PlayerMenuHandlers) {
    const id = `game-player-menu-${++nextPlayerMenuId}`;
    this.root.className = "game-panel encounter-menu player-context-menu";
    this.root.dataset.playerMenu = "";
    this.root.hidden = true;
    this.root.setAttribute("role", "menu");
    this.root.setAttribute("aria-labelledby", `${id}-title`);
    this.root.innerHTML = `
      <div class="encounter-menu__header"><strong id="${id}-title" data-player-label></strong><button type="button" data-close aria-label="Zamknij menu gracza">×</button></div>
      <div class="encounter-menu__actions"><button type="button" role="menuitem" data-player-action="party">Zaproś do drużyny</button><button type="button" role="menuitem" data-player-action="trade">Zaproponuj handel</button></div>`;
    this.label = this.root.querySelector<HTMLElement>("[data-player-label]")!;
    this.root.querySelector<HTMLElement>(".encounter-menu__actions")!.style.gridTemplateColumns = "1fr";
    this.root.querySelector<HTMLButtonElement>("[data-close]")!.addEventListener("click", () => this.hide());
    for (const action of ["party", "trade"] as const) {
      this.root.querySelector<HTMLButtonElement>(`[data-player-action="${action}"]`)!.addEventListener("click", () => {
        const id = this.playerId;
        if (this.destroyed || this.root.hidden || !id) return;
        this.hide();
        if (action === "party") this.handlers.onParty(id);
        else this.handlers.onTrade(id);
      });
    }
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click"]) {
      this.root.addEventListener(type, event => event.stopPropagation());
    }
    this.root.addEventListener("contextmenu", event => { event.preventDefault(); event.stopPropagation(); });
    document.body.append(this.root);
    document.addEventListener("pointerdown", this.onOutside, true);
    document.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.onResize);
    this.viewport = window.visualViewport;
    this.viewport?.addEventListener("resize", this.onResize);
    this.viewport?.addEventListener("scroll", this.onResize);
  }

  show(player: { id: string; nickname: string }, anchor: MenuAnchor): void {
    if (this.destroyed) return;
    if (this.root.hidden) this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.playerId = player.id;
    this.label.textContent = player.nickname;
    this.root.hidden = false;
    this.reposition(anchor);
    this.root.querySelector<HTMLButtonElement>("[data-player-action]")!.focus({ preventScroll: true });
  }

  reposition(anchor: MenuAnchor): void {
    if (this.destroyed || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return;
    this.anchor = { ...anchor };
    if (this.root.hidden) return;
    const margin = 12, styles = getComputedStyle(document.documentElement);
    const safe = (edge: string) => Math.max(0, Number.parseFloat(styles.getPropertyValue(`--safe-area-${edge}`)) || 0);
    const left = (this.viewport?.offsetLeft ?? 0) + margin + safe("left");
    const top = (this.viewport?.offsetTop ?? 0) + margin + safe("top");
    const right = (this.viewport?.offsetLeft ?? 0) + (this.viewport?.width ?? window.innerWidth) - margin - safe("right");
    const bottom = (this.viewport?.offsetTop ?? 0) + (this.viewport?.height ?? window.innerHeight) - margin - safe("bottom");
    const availableWidth = Math.max(0, right - left), availableHeight = Math.max(0, bottom - top);
    this.root.style.maxWidth = `${availableWidth}px`;
    this.root.style.maxHeight = `${availableHeight}px`;
    const rect = this.root.getBoundingClientRect();
    const width = Math.min(rect.width || 208, availableWidth), height = Math.min(rect.height || 180, availableHeight);
    const preferredLeft = anchor.x + 18 + width <= right ? anchor.x + 18 : anchor.x - width - 18;
    this.root.style.left = `${Math.max(left, Math.min(preferredLeft, right - width))}px`;
    this.root.style.top = `${Math.max(top, Math.min(anchor.y - 44, bottom - height))}px`;
  }

  hide(restoreFocus = true): void {
    if (this.destroyed || this.root.hidden) return;
    this.root.hidden = true;
    this.playerId = null;
    if (restoreFocus && this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    this.returnFocus = null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.hide(); this.destroyed = true;
    document.removeEventListener("pointerdown", this.onOutside, true);
    document.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("resize", this.onResize);
    this.viewport?.removeEventListener("resize", this.onResize);
    this.viewport?.removeEventListener("scroll", this.onResize);
    this.root.remove();
  }
}
