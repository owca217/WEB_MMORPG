import type { AppearanceSelection } from "@web-mmorpg/shared";
import { SPRITE_HEIGHT, SPRITE_WIDTH } from "./characterSprites";
import { drawWalkFrame, drawWalkOutfit, loadWalkSheets } from "./walkSprites";

export class CharacterPreview {
  readonly element = document.createElement("div");
  private readonly canvas = document.createElement("canvas");
  private readonly status = document.createElement("p");
  private selection: AppearanceSelection | undefined;
  private sheets: HTMLImageElement[] | undefined;
  private readonly outfitCanvas = document.createElement("canvas");
  private showOutfit = true;
  private destroyed = false;

  constructor() {
    this.element.className = "character-preview";
    this.canvas.width = SPRITE_WIDTH; this.canvas.height = SPRITE_HEIGHT;
    this.canvas.getContext("2d", { willReadFrequently: true });
    this.outfitCanvas.width = SPRITE_WIDTH; this.outfitCanvas.height = SPRITE_HEIGHT;
    this.canvas.className = "character-preview__sprite";
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Podgląd wybranej postaci");
    this.status.setAttribute("role", "status");
    this.status.textContent = "Wczytywanie postaci…";
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox"; checkbox.checked = true;
    checkbox.addEventListener("change", () => {
      this.showOutfit = checkbox.checked;
      if (this.selection) this.render(this.selection);
    });
    label.append(checkbox, " Pokaż ubiór startowy");
    this.element.append(this.canvas, this.status, label);
    void loadWalkSheets().then(sheets => {
      if (this.destroyed) return;
      this.sheets = sheets; this.status.textContent = "";
      if (this.selection) this.render(this.selection);
    }).catch(() => {
      if (!this.destroyed) this.status.textContent = "Nie udało się wczytać grafiki. Odśwież stronę.";
    });
  }

  render(selection: AppearanceSelection): void {
    this.selection = { ...selection };
    if (!this.sheets || this.destroyed) return;
    const ctx = this.canvas.getContext("2d");
    if (ctx) {
      drawWalkFrame(ctx, this.sheets, selection, "south", 1);
      if (this.showOutfit) {
        drawWalkOutfit(this.outfitCanvas.getContext("2d")!, this.canvas, selection, "south");
        ctx.drawImage(this.outfitCanvas, 0, 0);
      }
    }
  }

  destroy(): void { this.destroyed = true; this.element.remove(); }
}
