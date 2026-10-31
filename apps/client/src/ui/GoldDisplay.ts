import "./GoldDisplay.css";

let nextGoldDisplayId = 0;

/** Read-only currency cell; its local tooltip never becomes a game window. */
export class GoldDisplay {
  readonly element: HTMLElement;
  private readonly button: HTMLButtonElement;
  private readonly value: HTMLElement;
  private readonly tooltip: HTMLElement;
  private available = false;
  private opened = false;
  private pinned = false;
  private hovered = false;
  private focused = false;
  private dismissed = false;
  private destroyed = false;

  private readonly onEnter = (): void => { this.hovered=true; this.dismissed=false; this.reconcile(); };
  private readonly onLeave = (): void => { this.hovered=false; this.reconcile(); };
  private readonly onFocus = (): void => { this.focused=true; this.dismissed=false; this.reconcile(); };
  private readonly onBlur = (): void => { this.focused=false; this.reconcile(); };
  private readonly onClick = (): void => {
    if (!this.available || this.destroyed) return;
    const open=!this.pinned;
    this.pinned=open;
    this.dismissed=!open;
    this.setOpen(open);
  };
  private readonly onOutside = (event: Event): void => {
    if (this.opened && event.target instanceof Node && !this.element.contains(event.target)) this.dismiss();
  };
  private readonly onEscape = (event: KeyboardEvent): void => {
    if (!this.opened || event.key !== "Escape") return;
    this.dismiss();event.preventDefault();event.stopPropagation();
  };

  constructor() {
    this.element=document.createElement("div");this.element.className="gold-display";
    this.button=document.createElement("button");this.button.type="button";this.button.className="gold-display__button";
    const label=document.createElement("span");label.className="gold-display__label";label.textContent="Złoto";
    this.value=document.createElement("b");this.value.className="gold-display__value";this.value.dataset.gold="";
    this.tooltip=document.createElement("span");this.tooltip.className="gold-display__tooltip";
    this.tooltip.id=`gold-tooltip-${++nextGoldDisplayId}`;this.tooltip.setAttribute("role","tooltip");
    this.button.setAttribute("aria-describedby",this.tooltip.id);
    this.button.append(label,this.value);this.element.append(this.button,this.tooltip);
    this.element.addEventListener("mouseenter",this.onEnter);this.element.addEventListener("mouseleave",this.onLeave);
    this.element.addEventListener("focusin",this.onFocus);this.element.addEventListener("focusout",this.onBlur);
    this.button.addEventListener("click",this.onClick);
    document.addEventListener("pointerdown",this.onOutside,true);document.addEventListener("click",this.onOutside,true);
    document.addEventListener("keydown",this.onEscape,true);
    this.update(undefined);
  }

  update(amount: number | undefined): void {
    if (this.destroyed) return;
    const amountInteger=amount === undefined || !Number.isFinite(amount) ? undefined : Math.max(0,Math.trunc(amount));
    this.available=amountInteger !== undefined;this.button.disabled=!this.available;
    if (amountInteger === undefined) {
      this.value.textContent="—";this.tooltip.textContent="Dokładna ilość złota jest niedostępna.";
      this.button.setAttribute("aria-label","Złoto: ilość niedostępna");
      this.hovered=false;this.focused=false;this.dismiss();return;
    }
    const exact=`Dokładnie: ${String(amountInteger).replace(/\B(?=(\d{3})+(?!\d))/g," ")} złota`;
    this.value.textContent=amountInteger >= 1_000_000 ? `${Math.floor(amountInteger/1_000_000)}kk`
      : amountInteger >= 1_000 ? `${Math.floor(amountInteger/1_000)}k` : String(amountInteger);
    this.tooltip.textContent=exact;this.button.setAttribute("aria-label",`Złoto. ${exact}`);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.dismiss();this.destroyed=true;
    document.removeEventListener("pointerdown",this.onOutside,true);document.removeEventListener("click",this.onOutside,true);
    document.removeEventListener("keydown",this.onEscape,true);
    this.element.removeEventListener("mouseenter",this.onEnter);this.element.removeEventListener("mouseleave",this.onLeave);
    this.element.removeEventListener("focusin",this.onFocus);this.element.removeEventListener("focusout",this.onBlur);
    this.button.removeEventListener("click",this.onClick);this.element.remove();
  }

  private reconcile(): void {
    if (!this.available || this.dismissed || this.destroyed) return;
    this.setOpen(this.pinned || this.hovered || this.focused);
  }
  private dismiss(): void {
    this.pinned=false;this.dismissed=true;this.setOpen(false);
  }
  private setOpen(open: boolean): void {
    this.opened=open;this.tooltip.hidden=!open;this.button.setAttribute("aria-expanded",String(open));
  }
}
