import { describe, expect, it } from "vitest";
import {
  PROFESSION_CATEGORIES,
  renderProfessionsMarkup
} from "../src/ui/ProfessionsPanel";
import { WORLD_WINDOW_MENU_ITEMS } from "../src/ui/windowMenuItems";

describe("professions panel content", () => {
  it("organizes weapon, offensive and defensive specializations into collapsible categories", () => {
    expect(PROFESSION_CATEGORIES.map((category) => category.id)).toEqual([
      "weapons",
      "offensive",
      "defensive"
    ]);

    const markup = renderProfessionsMarkup();

    expect(markup.match(/<details/g)).toHaveLength(3);
    expect(markup.match(/<summary/g)).toHaveLength(3);
    expect(markup.match(/<details[^>]* open>/g)).toHaveLength(1);
    expect(markup).toContain('data-profession-category="weapons"');
    expect(markup).toContain('data-profession-category="offensive"');
    expect(markup).toContain('data-profession-category="defensive"');
    expect(markup).toContain("Miecze");
    expect(markup).toContain("Trafienia krytyczne");
    expect(markup).toContain("Odporności");
  });

  it("renders accessible progress information for every specialization", () => {
    const specializationCount = PROFESSION_CATEGORIES.reduce(
      (count, category) => count + category.professions.length,
      0
    );
    const markup = renderProfessionsMarkup();

    expect(markup.match(/role="progressbar"/g)).toHaveLength(specializationCount);
    expect(markup.match(/aria-valuenow="\d+"/g)).toHaveLength(specializationCount);
    expect(markup).toContain("Poziom 1");
  });

  it("exposes the professions window through the world menu", () => {
    expect(WORLD_WINDOW_MENU_ITEMS).toContainEqual({
      key: "professions",
      label: "Profesje"
    });
  });
});
