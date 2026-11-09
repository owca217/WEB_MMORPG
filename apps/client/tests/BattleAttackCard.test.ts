/* @vitest-environment jsdom */

import type { BattleAttackPreview } from "@web-mmorpg/shared";
import { beforeEach, expect, it, vi } from "vitest";
import { BattleAttackCard } from "../src/ui/BattleAttackCard";

const preview: BattleAttackPreview = {
  targetId: "wolf", type: "meleeAttack", apCost: 3, hitChance: 72, averageDamage: 18, available: true
};
const arena = { x: 12, y: 120, width: 500, height: 300 };

beforeEach(() => document.body.replaceChildren());

it("keeps the selected target, hit and damage preview beside the original attack action", () => {
  const onAttack = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const card = new BattleAttackCard(onAttack, host);
  card.show(preview, "Wilk", 0, 0, arena);
  const button = host.querySelector<HTMLButtonElement>("[data-confirm-attack]")!;
  expect(host.querySelector("[data-target-name]")?.textContent).toBe("Wilk");
  expect(host.querySelector("[data-hit-chance]")?.textContent).toContain("72%");
  expect(host.querySelector("[data-average-damage]")?.textContent).toContain("18");
  expect(button.textContent).toContain("3 AP");
  button.click();
  expect(onAttack).toHaveBeenCalledWith("wolf");
  card.destroy();
});

it("blocks unavailable attacks and clears the previous target when selection is removed", () => {
  const onAttack = vi.fn();
  const card = new BattleAttackCard(onAttack);
  card.show({ ...preview, available: false, reason: "Cel poza zasięgiem" }, "Wilk", 0, 0, arena);
  const button = document.querySelector<HTMLButtonElement>("[data-confirm-attack]")!;
  expect(button.disabled).toBe(true);
  expect(document.querySelector("[data-attack-reason]")?.textContent).toContain("poza zasięgiem");
  button.click();
  expect(onAttack).not.toHaveBeenCalled();
  card.hide();
  expect(button.hidden).toBe(true);
  expect(document.querySelector("[data-average-damage]")?.textContent).toBe("");
  expect(document.querySelector("[data-attack-reason]")?.textContent).toBe("");
  button.click();
  expect(onAttack).not.toHaveBeenCalled();
  card.destroy();
});
