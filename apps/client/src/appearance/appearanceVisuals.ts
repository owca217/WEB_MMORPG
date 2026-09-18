import type { AppearanceSelection } from "@web-mmorpg/shared";

const skin = {
  "skin-01": "#f0c7a5",
  "skin-02": "#c98f65",
  "skin-03": "#9b6548",
  "skin-04": "#684331"
} as const;

const hair = {
  "hair-color-01": "#2a211d",
  "hair-color-02": "#6a4329",
  "hair-color-03": "#8b5a2b",
  "hair-color-04": "#d1b06f"
} as const;

const outfit = {
  "outfit-01": "#56634f",
  "outfit-02": "#405a74",
  "outfit-03": "#694957"
} as const;

const faceScaleX = {
  "face-01": 1,
  "face-02": 0.9,
  "face-03": 1.08,
  "face-04": 0.96
} as const;

const eyes = {
  "eyes-01": { spacing: 8, radius: 2 },
  "eyes-02": { spacing: 10, radius: 2 },
  "eyes-03": { spacing: 8, radius: 3 }
} as const;

export interface AppearanceVisuals {
  bodyScale: number;
  faceScaleX: number;
  eyeSpacing: number;
  eyeRadius: number;
  skin: string;
  hairColor: string;
  hairStyle: string;
  facialHairStyle: string;
  outfit: string;
  marking: string;
}

export function appearanceVisuals(
  selection: AppearanceSelection
): AppearanceVisuals {
  const eye = eyes[selection.eyes as keyof typeof eyes] ?? eyes["eyes-01"];

  return {
    bodyScale: selection.bodyType === "body-02" ? 1.08 : 1,
    faceScaleX:
      faceScaleX[selection.face as keyof typeof faceScaleX] ?? 1,
    eyeSpacing: eye.spacing,
    eyeRadius: eye.radius,
    skin:
      skin[selection.skinTone as keyof typeof skin] ?? skin["skin-01"],
    hairColor:
      hair[selection.hairColor as keyof typeof hair] ??
      hair["hair-color-01"],
    hairStyle: selection.hair,
    facialHairStyle: selection.facialHair,
    outfit:
      outfit[selection.startingOutfit as keyof typeof outfit] ??
      outfit["outfit-01"],
    marking: selection.marking
  };
}
