import type { AppearanceSelection } from "@web-mmorpg/shared";
import { appearanceVisuals } from "./appearanceVisuals";

export class CharacterPreview {
  readonly element = document.createElement("div");

  private readonly face = document.createElement("div");
  private readonly leftEye = document.createElement("span");
  private readonly rightEye = document.createElement("span");
  private readonly hair = document.createElement("div");
  private readonly facialHair = document.createElement("div");
  private readonly marking = document.createElement("div");
  private readonly outfit = document.createElement("div");

  constructor() {
    this.element.className = "character-preview";

    const avatar = document.createElement("div");
    avatar.className = "character-preview__avatar";

    this.outfit.className = "character-preview__outfit";
    this.face.className = "character-preview__face";
    this.leftEye.className = "character-preview__eye character-preview__eye--left";
    this.rightEye.className = "character-preview__eye character-preview__eye--right";
    this.hair.className = "character-preview__hair";
    this.facialHair.className = "character-preview__facial-hair";
    this.marking.className = "character-preview__marking";

    this.face.append(
      this.leftEye,
      this.rightEye,
      this.hair,
      this.facialHair,
      this.marking
    );
    avatar.append(this.outfit, this.face);
    this.element.appendChild(avatar);
  }

  render(selection: AppearanceSelection): void {
    const visuals = appearanceVisuals(selection);
    this.element.style.setProperty("--avatar-skin", visuals.skin);
    this.element.style.setProperty("--avatar-hair", visuals.hairColor);
    this.element.style.setProperty("--avatar-outfit", visuals.outfit);
    this.element.style.setProperty("--avatar-scale", String(visuals.bodyScale));
    this.element.style.setProperty(
      "--avatar-face-scale-x",
      String(visuals.faceScaleX)
    );
    this.element.style.setProperty(
      "--avatar-eye-spacing",
      `${visuals.eyeSpacing}px`
    );
    this.element.style.setProperty(
      "--avatar-eye-radius",
      `${visuals.eyeRadius}px`
    );
    this.element.dataset.hairStyle = visuals.hairStyle;
    this.element.dataset.facialHairStyle = visuals.facialHairStyle;
    this.element.dataset.marking = visuals.marking;
  }

  destroy(): void {
    this.element.remove();
  }
}
