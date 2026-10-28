import { describe, expect, it } from "vitest";
import { BASE_CHARACTER_SKINS, getCharacterSkin, resolveCharacterSkin } from "../src";

describe("base character skins", () => {
  it("offers three distinct selectable appearances for each gender", () => {
    expect(BASE_CHARACTER_SKINS.filter((skin) => skin.gender === "male").map((skin) => skin.id)).toEqual([
      "male-traveler", "male-scout", "male-guard"
    ]);
    expect(BASE_CHARACTER_SKINS.filter((skin) => skin.gender === "female").map((skin) => skin.id)).toEqual([
      "female-traveler", "female-scout", "female-guard"
    ]);
    expect(getCharacterSkin("female-scout")).toMatchObject({ gender: "female" });
    expect(getCharacterSkin("missing-skin")).toBeUndefined();
    expect(getCharacterSkin(null)).toBeUndefined();
  });

  it("resolves selected skins and gives legacy appearances a gender-appropriate default", () => {
    expect(resolveCharacterSkin({ gender: "female", skinId: "female-guard" }).id).toBe("female-guard");
    expect(resolveCharacterSkin({ gender: "female", skinId: "old-skin" }).id).toBe("female-traveler");
    expect(resolveCharacterSkin({ gender: "female", hairStyle: "long" }).id).toBe("female-traveler");
    expect(resolveCharacterSkin({ bodyType: "default" }).id).toBe("male-traveler");
    expect(resolveCharacterSkin().id).toBe("male-traveler");
  });
});
