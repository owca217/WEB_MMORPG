import type { AppearanceSelection } from "@web-mmorpg/shared";
import { loadCharacterAtlas, SPRITE_HEIGHT, SPRITE_WIDTH } from "./characterSprites";
import { drawCharacterSprite } from "./drawCharacterSprite";

export class CharacterPreview {
  readonly element = document.createElement("div");
  private readonly canvas = document.createElement("canvas");
  private readonly status = document.createElement("p");
  private selection: AppearanceSelection | undefined;
  private atlas: HTMLImageElement | undefined;
  private showOutfit = true;
  private destroyed = false;

  constructor() {
    this.element.className = "character-preview";
    this.canvas.width = SPRITE_WIDTH; this.canvas.height = SPRITE_HEIGHT;
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
    void loadCharacterAtlas().then(atlas => {
      if (this.destroyed) return;
      this.atlas = atlas; this.status.textContent = "";
      if (this.selection) this.render(this.selection);
    }).catch(() => {
      if (!this.destroyed) this.status.textContent = "Nie udało się wczytać grafiki. Odśwież stronę.";
    });
  }

  render(selection: AppearanceSelection): void {
    this.selection = { ...selection };
    if (!this.atlas || this.destroyed) return;
    const ctx = this.canvas.getContext("2d");
    if (ctx) drawCharacterSprite(ctx, this.atlas, selection, this.showOutfit);
  }

  destroy(): void { this.destroyed = true; this.element.remove(); }
}
