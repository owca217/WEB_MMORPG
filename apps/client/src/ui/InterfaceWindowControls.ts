interface InterfaceWindowControlsOptions {
  root: HTMLElement;
  header: HTMLElement;
  onClose: () => void;
  minScale?: number;
  maxScale?: number;
  scaleStep?: number;
}

export class InterfaceWindowControls {
  private readonly root: HTMLElement;
  private readonly header: HTMLElement;
  private readonly settings: HTMLDivElement;
  private readonly moveCheckbox: HTMLInputElement;
  private readonly onDocumentPointerDown: (event: PointerEvent) => void;
  private scale = 1;
  private draggable = false;
  private dragPointerId: number | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private dragStartLeft = 0;
  private dragStartTop = 0;
  private readonly minScale: number;
  private readonly maxScale: number;
  private readonly scaleStep: number;

  constructor(options: InterfaceWindowControlsOptions) {
    this.root = options.root;
    this.header = options.header;
    this.minScale = options.minScale ?? 0.7;
    this.maxScale = options.maxScale ?? 1.4;
    this.scaleStep = options.scaleStep ?? 0.1;

    this.root.classList.add("ui-window");
    this.root.style.transformOrigin = "top left";
    this.header.classList.add("ui-window__drag-handle");

    const chrome = document.createElement("div");
    chrome.className = "ui-window__chrome";

    const settingsButton = document.createElement("button");
    settingsButton.type = "button";
    settingsButton.className = "ui-window__icon-button";
    settingsButton.dataset.windowSettings = "";
    settingsButton.setAttribute("aria-label", "Ustawienia okna");
    settingsButton.title = "Ustawienia okna";
    settingsButton.textContent = "⚙";

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "ui-window__icon-button ui-window__close";
    closeButton.dataset.windowClose = "";
    closeButton.setAttribute("aria-label", "Zamknij");
    closeButton.title = "Zamknij";
    closeButton.textContent = "×";

    chrome.append(settingsButton, closeButton);
    this.header.appendChild(chrome);

    this.settings = document.createElement("div");
    this.settings.className = "ui-window-settings";
    this.settings.hidden = true;
    this.settings.innerHTML = `
      <div class="ui-window-settings__label">Skalowanie okna</div>
      <div class="ui-window-settings__scale">
        <button type="button" data-scale-down aria-label="Pomniejsz okno">−</button>
        <button type="button" data-scale-reset aria-label="Przywróć domyślny rozmiar" title="100%">↻</button>
        <button type="button" data-scale-up aria-label="Powiększ okno">+</button>
      </div>
      <label class="ui-window-settings__move">
        <input type="checkbox" data-move-window>
        <span>Przenoszenie okna</span>
      </label>
    `;
    this.root.appendChild(this.settings);

    this.moveCheckbox = this.require<HTMLInputElement>("[data-move-window]");
    this.require<HTMLButtonElement>("[data-scale-down]").addEventListener(
      "click",
      () => this.changeScale(-this.scaleStep)
    );
    this.require<HTMLButtonElement>("[data-scale-reset]").addEventListener(
      "click",
      () => this.setScale(1)
    );
    this.require<HTMLButtonElement>("[data-scale-up]").addEventListener(
      "click",
      () => this.changeScale(this.scaleStep)
    );

    this.moveCheckbox.addEventListener("change", () => {
      this.draggable = this.moveCheckbox.checked;
      this.header.classList.toggle(
        "ui-window__drag-enabled",
        this.draggable
      );
    });

    settingsButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.settings.hidden = !this.settings.hidden;
    });

    closeButton.addEventListener("click", () => {
      this.settings.hidden = true;
      options.onClose();
    });

    this.header.addEventListener("pointerdown", (event) =>
      this.startDrag(event)
    );
    this.header.addEventListener("pointermove", (event) =>
      this.moveDrag(event)
    );
    this.header.addEventListener("pointerup", (event) =>
      this.endDrag(event)
    );
    this.header.addEventListener("pointercancel", (event) =>
      this.endDrag(event)
    );

    this.onDocumentPointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        this.settings.contains(target) ||
        settingsButton.contains(target)
      ) {
        return;
      }
      this.settings.hidden = true;
    };
    document.addEventListener("pointerdown", this.onDocumentPointerDown);
  }

  destroy(): void {
    document.removeEventListener(
      "pointerdown",
      this.onDocumentPointerDown
    );
  }

  private changeScale(delta: number): void {
    this.setScale(this.scale + delta);
  }

  private setScale(value: number): void {
    this.normalizePosition();
    this.scale = Math.min(
      this.maxScale,
      Math.max(this.minScale, Math.round(value * 10) / 10)
    );
    this.root.style.setProperty("scale", String(this.scale));
    this.keepInsideViewport();
  }

  private startDrag(event: PointerEvent): void {
    if (!this.draggable || event.button !== 0) return;

    const target = event.target;
    if (
      target instanceof Element &&
      target.closest(
        ".ui-window__chrome, .ui-window-settings, button, input, label"
      )
    ) {
      return;
    }

    event.preventDefault();
    this.normalizePosition();

    const rect = this.root.getBoundingClientRect();
    this.dragPointerId = event.pointerId;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragStartLeft = rect.left;
    this.dragStartTop = rect.top;
    this.header.classList.add("ui-window__dragging");
    this.header.setPointerCapture?.(event.pointerId);
  }

  private moveDrag(event: PointerEvent): void {
    if (this.dragPointerId !== event.pointerId) return;

    const left =
      this.dragStartLeft + (event.clientX - this.dragStartX);
    const top =
      this.dragStartTop + (event.clientY - this.dragStartY);
    this.setPosition(left, top);
  }

  private endDrag(event: PointerEvent): void {
    if (this.dragPointerId !== event.pointerId) return;

    this.dragPointerId = null;
    this.header.classList.remove("ui-window__dragging");
    if (this.header.hasPointerCapture?.(event.pointerId)) {
      this.header.releasePointerCapture?.(event.pointerId);
    }
  }

  private normalizePosition(): void {
    if (this.root.dataset.uiWindowPositioned === "true") return;

    const rect = this.root.getBoundingClientRect();
    this.root.style.left = `${rect.left}px`;
    this.root.style.top = `${rect.top}px`;
    this.root.style.right = "auto";
    this.root.style.bottom = "auto";
    this.root.style.transform = "none";
    this.root.dataset.uiWindowPositioned = "true";
  }

  private keepInsideViewport(): void {
    const rect = this.root.getBoundingClientRect();
    this.setPosition(rect.left, rect.top);
  }

  private setPosition(left: number, top: number): void {
    const rect = this.root.getBoundingClientRect();
    const margin = 8;
    const maxLeft = Math.max(
      margin,
      window.innerWidth - rect.width - margin
    );
    const maxTop = Math.max(
      margin,
      window.innerHeight - rect.height - margin
    );

    this.root.style.left = `${Math.min(
      maxLeft,
      Math.max(margin, left)
    )}px`;
    this.root.style.top = `${Math.min(
      maxTop,
      Math.max(margin, top)
    )}px`;
  }

  private require<T extends HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) {
      throw new Error(`Window control element missing: ${selector}`);
    }
    return element;
  }
}
