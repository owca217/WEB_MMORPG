import { readRightClickInteractions, setRightClickInteractions } from "./interactionPreferences";
import "./OptionsPanel.css";

interface OptionsPanelHandlers { onChange?: () => void }
let nextOptionsId = 0;

export class OptionsPanel {
  private readonly root = document.createElement("section");
  private readonly checkbox: HTMLInputElement;
  private returnFocus: HTMLElement | null = null;
  private destroyed = false;

  constructor(private readonly handlers: OptionsPanelHandlers = {}) {
    const id = `game-options-${++nextOptionsId}`;
    this.root.className = "game-panel options-panel";
    this.root.dataset.optionsPanel = "";
    this.root.hidden = true;
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "false");
    this.root.setAttribute("aria-labelledby", `${id}-title`);
    this.root.innerHTML = `
      <header class="game-panel__header"><h2 id="${id}-title">Opcje</h2><button type="button" data-close aria-label="Zamknij opcje">×</button></header>
      <label class="options-panel__preference"><input type="checkbox" data-right-click-interactions aria-describedby="${id}-description"><span>Interakcja prawym przyciskiem myszy</span></label>
      <p id="${id}-description" class="options-panel__description">Włącz, aby otwierać menu postaci i przeciwników prawym przyciskiem myszy. Po wyłączeniu używaj lewego przycisku. Sterowanie dotykiem pozostaje takie samo.</p>`;
    this.checkbox = this.root.querySelector<HTMLInputElement>("[data-right-click-interactions]")!;
    this.checkbox.checked = readRightClickInteractions();
    this.checkbox.addEventListener("change", () => {
      if (this.destroyed || this.root.hidden) return;
      setRightClickInteractions(this.checkbox.checked);
      this.handlers.onChange?.();
    });
    this.root.querySelector<HTMLButtonElement>("[data-close]")!.addEventListener("click", () => this.hide());
    this.root.addEventListener("keydown", event => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault(); event.stopPropagation(); this.hide();
    });
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend", "click"]) {
      this.root.addEventListener(type, event => event.stopPropagation());
    }
    document.body.append(this.root);
  }

  show(): void {
    if (this.destroyed) return;
    if (this.root.hidden) this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.checkbox.checked = readRightClickInteractions();
    this.root.hidden = false;
    this.checkbox.focus({ preventScroll: true });
  }

  hide(): void {
    if (this.destroyed || this.root.hidden) return;
    this.root.hidden = true;
    if (this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    this.returnFocus = null;
  }

  toggle(): void { if (this.root.hidden) this.show(); else this.hide(); }

  destroy(): void {
    if (this.destroyed) return;
    this.hide();
    this.destroyed = true;
    this.root.remove();
  }
}
