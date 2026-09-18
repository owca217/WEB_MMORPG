import { describe, expect, it } from "vitest";
import { appearanceVisuals } from "../src/appearance/appearanceVisuals";

describe("appearanceVisuals", () => {
  it("maps saved appearance IDs to stable creator/world visuals", () => {
    expect(appearanceVisuals({
      bodyType: "body-01",
      skinTone: "skin-02",
      face: "face-01",
      eyes: "eyes-01",
      hair: "hair-04",
      hairColor: "hair-color-03",
      facialHair: "facial-hair-none",
      marking: "scar-01",
      startingOutfit: "outfit-02"
    })).toEqual({
      bodyScale: 1,
      faceScaleX: 1,
      eyeSpacing: 8,
      eyeRadius: 2,
      skin: "#c98f65",
      hairColor: "#8b5a2b",
      hairStyle: "hair-04",
      facialHairStyle: "facial-hair-none",
      outfit: "#405a74",
      marking: "scar-01"
    });
  });
});
