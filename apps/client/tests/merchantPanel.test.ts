/* @vitest-environment jsdom */
import type { MerchantPurchase, MerchantResult, MerchantSnapshot } from "@web-mmorpg/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MerchantPanel } from "../src/ui/ShopPanel";

const panels: MerchantPanel[] = [];
const shop = (gold = 100): MerchantSnapshot => ({
  npcId: "merchant-miro", npcName: "Miro", gold,
  offers: [
    { itemId: "bandage", name: "Bandaż", description: "Opatrunek", categoryId: "consumable", unitPrice: 5, healHp: 30, maxQuantity: 20 },
    { itemId: "bag", name: "Szmaciany worek", description: "Na drobiazgi", categoryId: "container", unitPrice: 30, capacity: 8, maxQuantity: 1 }
  ]
});
const ok = (gold = 95): MerchantResult => ({ ok: true, shop: shop(gold), inventory: { items: [] } });
function el<T extends HTMLElement = HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing ${selector}`);
  return result;
}
const buy = (id = "bandage") => el<HTMLButtonElement>(`[data-merchant-buy="${id}"]`);
const qty = (id = "bandage") => el<HTMLInputElement>(`[data-merchant-quantity="${id}"]`);
function input(value: string, id = "bandage") { const field = qty(id); field.value = value; field.dispatchEvent(new Event("input", { bubbles: true })); }
function setup(onPurchase: (payload: MerchantPurchase) => Promise<MerchantResult> = async () => ok(), extra = {}) {
  const panel = new MerchantPanel({ onPurchase, ...extra }); panels.push(panel); panel.show(shop()); return panel;
}
beforeEach(() => document.body.replaceChildren());
afterEach(() => { panels.splice(0).forEach(panel => panel.destroy()); vi.restoreAllMocks(); });

it("renders catalog text safely and validates quantity, cost and available gold", () => {
  const panel = setup();
  panel.show({ ...shop(12), npcName: "<img src=x>", offers: [{ ...shop().offers[0]!, name: "<b>Bandaż</b>", quality:"GOOD" }, shop().offers[1]!] });
  expect(el("[data-merchant-title]").textContent).toContain("<img src=x>");
  expect(el("[data-merchant-offers]").querySelector("b")).toBeNull();
  expect(el("[data-merchant-offers]").textContent).toContain("30 HP");
  expect(el("[data-merchant-offers]").textContent).toContain("8 miejsc");
  expect(el("[data-merchant-offers]").textContent).toContain("Jakość: Dobra");
  expect(el("[data-merchant-offers]").textContent).toContain("Jakość: Normalna");
  expect(buy("bag").disabled).toBe(true);
  expect(buy().disabled).toBe(false);
  input("3");
  expect(el('[data-merchant-total="bandage"]').textContent).toContain("15");
  expect(buy().disabled).toBe(true);
  for (const value of ["0", "1.5", "-1", "21", ""]) { input(value); expect(buy().disabled).toBe(true); }
  input("2"); expect(buy().disabled).toBe(false);
});

it("sends one purchase while pending and applies the authoritative balance after success", async () => {
  let resolve!: (value: MerchantResult) => void;
  const purchases: MerchantPurchase[] = [];
  const onPurchased = vi.fn();
  setup(payload => { purchases.push(payload); return new Promise(done => { resolve = done; }); }, { onPurchased });
  input("2"); buy().click(); buy().click();
  expect(purchases).toHaveLength(1);
  expect(purchases[0]).toMatchObject({ npcId: "merchant-miro", itemId: "bandage", quantity: 2 });
  expect(purchases[0]!.requestId).toMatch(/^[a-f0-9-]{36}$/i);
  expect(qty().disabled).toBe(true);
  expect(buy("bag").disabled).toBe(true);
  expect(onPurchased).not.toHaveBeenCalled();
  resolve(ok(90));
  await vi.waitFor(() => expect(el("[data-merchant-gold]").textContent).toContain("90"));
  expect(onPurchased).toHaveBeenCalledWith(ok(90));
  expect(buy().disabled).toBe(false);
});

it("retries an uncertain purchase with the same request id and locks other orders", async () => {
  const purchases: MerchantPurchase[] = [];
  setup(async payload => {
    purchases.push(payload);
    return purchases.length === 1 ? { ok: false, code: "MERCHANT_REQUEST_UNCERTAIN", message: "Brak potwierdzenia." } : ok(95);
  });
  buy().click();
  await vi.waitFor(() => expect(el<HTMLButtonElement>("[data-merchant-retry]").hidden).toBe(false));
  expect(buy().disabled).toBe(true);
  expect(qty().disabled).toBe(true);
  el<HTMLButtonElement>("[data-merchant-retry]").click();
  await vi.waitFor(() => expect(purchases).toHaveLength(2));
  expect(purchases[1]).toEqual(purchases[0]);
  await vi.waitFor(() => expect(buy().disabled).toBe(false));
  expect(el<HTMLButtonElement>("[data-merchant-retry]").hidden).toBe(true);
});

it("ignores responses after closing and allows a fresh purchase after reopening", async () => {
  let resolve!: (value: MerchantResult) => void;
  const onPurchased = vi.fn();
  const panel = setup(() => new Promise(done => { resolve = done; }), { onPurchased });
  buy().click(); panel.hide(); panel.show(shop(100));
  resolve(ok(95));
  await Promise.resolve(); await Promise.resolve();
  expect(onPurchased).not.toHaveBeenCalled();
  expect(el("[data-merchant-gold]").textContent).toContain("100");
  expect(buy().disabled).toBe(false);
  buy().click(); panel.destroy(); resolve(ok(90));
  await Promise.resolve(); await Promise.resolve();
  expect(onPurchased).not.toHaveBeenCalled();
  expect(document.querySelector("[data-merchant-panel]")).toBeNull();
});

it("preserves focused quantity on wallet updates and reports typing until hidden", () => {
  const onTypingChange = vi.fn();
  const panel = setup(undefined, { onTypingChange });
  const field = qty(); field.focus(); input("4");
  expect(panel.isTyping).toBe(true);
  panel.updateGold(12);
  expect(document.activeElement).toBe(field);
  expect(field.value).toBe("4");
  expect(buy().disabled).toBe(true);
  expect(onTypingChange).toHaveBeenCalled();
  field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(panel.isTyping).toBe(false);
  expect(el("[data-merchant-panel]").classList.contains("is-hidden")).toBe(true);
});
