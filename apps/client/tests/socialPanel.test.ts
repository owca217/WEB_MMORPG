/* @vitest-environment jsdom */

import type { InventoryItem, InventorySnapshot, SocialAction, SocialActionResult, SocialPlayer, SocialSnapshot, TradeSnapshot } from "@web-mmorpg/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SocialPanel } from "../src/ui/SocialPanel";

const panels: SocialPanel[] = [];
const self: SocialPlayer = { id: "self", nickname: "Ja", online: true, inBattle: false };
const other: SocialPlayer = { id: "other", nickname: "Ala", online: true, inBattle: false };
const inventoryItem = (instanceId: string, extra: Partial<InventoryItem> = {}): InventoryItem => ({ instanceId, itemId: "herb", itemDefinitionId: "herb", name: "Zioło", quantity: 5, category: "consumable", description: "", rarity: "COMMON", upgradeLevel: 0, ...extra });
const inventory: InventorySnapshot = { items: [inventoryItem("herb")] };
const snapshot = (extra: Partial<SocialSnapshot> = {}): SocialSnapshot => ({ selfId: "self", onlinePlayers: [other], friends: [], incomingFriendRequests: [], outgoingFriendRequests: [], party: null, partyInvites: [], trade: null, ...extra });
const trade = (extra: Partial<TradeSnapshot> = {}): TradeSnapshot => ({ id: "trade", initiatorId: "other", status: "active", revision: 1, participants: [{ player: self, offer: [], confirmed: false }, { player: other, offer: [{ instanceId: "sword", name: "Miecz", quantity: 1 }], confirmed: true }], expiresAt: Date.now() + 60000, ...extra });
function element<T extends HTMLElement = HTMLElement>(selector: string): T { const result = document.querySelector<T>(selector); if (!result) throw new Error(`Missing ${selector}`); return result; }
function button(selector: string): HTMLButtonElement { return element<HTMLButtonElement>(selector); }
function tab(name: "party" | "friends" | "trade"): void { button(`[data-social-tab="${name}"]`).click(); }
function type(selector: string, value: string): void { const node = element<HTMLInputElement>(selector); node.value = value; node.dispatchEvent(new Event("input", { bubbles: true })); }
function panel(onAction: (action: SocialAction) => Promise<SocialActionResult> = vi.fn(async (): Promise<SocialActionResult> => ({ ok: true, social: snapshot() })), state = snapshot()): SocialPanel { const result = new SocialPanel({ onAction }); panels.push(result); result.update(state, inventory, "connected", false); button("[data-social-toggle]").click(); return result; }

beforeEach(() => document.body.replaceChildren());
afterEach(() => { for (const instance of panels.splice(0)) instance.destroy(); vi.restoreAllMocks(); });

it("requires explicit consent for incoming requests and renders nicknames as text", async () => {
  const actions: SocialAction[] = [];
  panel(async (action) => { actions.push(action); return { ok: true, social: snapshot() }; }, snapshot({ incomingFriendRequests: [{ ...other, nickname: '<img src=x onerror="alert(1)">' }], partyInvites: [{ id: "invite", leader: other, membersCount: 2, expiresAt: Date.now() + 60000 }], trade: trade({ status: "invited" }) }));
  expect(actions).toEqual([]);
  expect(element("[data-social-badge]").textContent).toBe("3");
  expect(element("[data-social-panel]").classList.contains("game-panel")).toBe(true);
  tab("friends");
  expect(element("[data-social-content]").textContent).toContain('<img src=x onerror="alert(1)">');
  expect(element("[data-social-content]").querySelector("img")).toBeNull();
  button('[data-social-action="respondFriend"][data-accept="true"]').click();
  await vi.waitFor(() => expect(actions).toEqual([{ type: "respondFriend", playerId: "other", accept: true }]));
  tab("trade");
  expect(actions).toHaveLength(1);
  button('[data-social-action="respondTrade"][data-accept="false"]').click();
  await vi.waitFor(() => expect(actions).toHaveLength(2));
  expect(actions[1]).toEqual({ type: "respondTrade", tradeId: "trade", accept: false });
});

it("sends nickname requests once, preserves failed drafts and awaits authoritative parent updates", async () => {
  let resolve!: (result: SocialActionResult) => void;
  const actions: SocialAction[] = [];
  const instance = panel((action) => { actions.push(action); return new Promise((done) => { resolve = done; }); });
  tab("friends");
  type("[data-friend-nickname]", "  Ala  ");
  button('[data-social-action="requestFriend"]').click();
  button('[data-social-action="requestFriend"]').click();
  expect(actions).toEqual([{ type: "requestFriend", nickname: "Ala" }]);
  expect(button('[data-social-action="requestFriend"]').disabled).toBe(true);
  resolve({ ok: false, code: "NOT_FOUND", message: "Nie znaleziono postaci." });
  await vi.waitFor(() => expect(element("[data-social-feedback]").textContent).toContain("Nie znaleziono"));
  expect(element<HTMLInputElement>("[data-friend-nickname]").value).toBe("  Ala  ");
  button('[data-social-action="requestFriend"]').click();
  resolve({ ok: true, social: snapshot({ outgoingFriendRequests: [other] }) });
  await vi.waitFor(() => expect(button('[data-social-action="requestFriend"]').disabled).toBe(false));
  expect(element("[data-social-content]").textContent).not.toContain("Wysłane zaproszenia");
  instance.update(snapshot({ outgoingFriendRequests: [other] }), inventory, "connected", false);
  expect(element("[data-social-content]").textContent).toContain("Wysłane zaproszenia");
});

it("shows party leadership and limits invitations by connection, battle and capacity", () => {
  const member: SocialPlayer = { id: "member", nickname: "Ola", online: false, inBattle: false };
  const instance = panel(undefined, snapshot({ party: { id: "party", leaderId: "self", members: [self, member], experienceBonusPercent: 10 } }));
  expect(element("[data-social-content]").textContent).toContain("do +10% XP");
  expect(button('[data-social-action="kickParty"]').disabled).toBe(false);
  expect(button('[data-social-action="inviteParty"]').disabled).toBe(false);
  instance.update(snapshot({ party: { id: "party", leaderId: "member", members: [self, member], experienceBonusPercent: 10 } }), inventory, "connected", false);
  expect(document.querySelector('[data-social-action="kickParty"]')).toBeNull();
  expect(button('[data-social-action="inviteParty"]').disabled).toBe(true);
  instance.update(snapshot(), inventory, "connected", true);
  expect(button('[data-social-action="inviteParty"]').disabled).toBe(true);
  tab("trade");
  expect(button('[data-social-action="requestTrade"]').disabled).toBe(true);
});

it("allows cleaning up unavailable friends and cancelling sent requests while refusing acceptance", async () => {
  const actions: SocialAction[] = [];
  const unavailable = { ...other, unavailable: true };
  panel(async (action) => { actions.push(action); return { ok: true, social: snapshot() }; }, snapshot({
    incomingFriendRequests: [{ ...unavailable, id: "incoming" }],
    outgoingFriendRequests: [{ ...unavailable, id: "outgoing" }],
    friends: [{ ...unavailable, id: "accepted" }]
  }));
  tab("friends");
  expect(element("[data-social-content]").textContent).toContain("Konto nieaktywne");
  const accept = button('[data-social-action="respondFriend"][data-accept="true"]');
  expect(accept.disabled).toBe(true);
  accept.click();
  expect(actions).toEqual([]);
  expect(button('[data-social-action="inviteParty"]').disabled).toBe(true);
  expect(button('[data-social-action="requestTrade"]').disabled).toBe(true);
  button('[data-social-action="respondFriend"][data-accept="false"]').click();
  await vi.waitFor(() => expect(button('[data-social-action="respondFriend"][data-accept="false"]').disabled).toBe(false));
  const removeFriend = [...document.querySelectorAll<HTMLButtonElement>('[data-social-action="removeFriend"]')].find((button) => button.textContent === "Usuń");
  expect(removeFriend?.disabled).toBe(false);
  removeFriend?.click();
  await vi.waitFor(() => expect(button('[data-social-action="respondFriend"][data-accept="false"]').disabled).toBe(false));
  const cancel = [...document.querySelectorAll<HTMLButtonElement>('[data-social-action="removeFriend"]')].find((button) => button.textContent === "Anuluj zaproszenie");
  expect(cancel?.disabled).toBe(false);
  cancel?.click();
  expect(actions).toEqual([{ type: "respondFriend", playerId: "incoming", accept: false }, { type: "removeFriend", playerId: "accepted" }, { type: "removeFriend", playerId: "outgoing" }]);
});

it("reviews both offers and saves a local draft before allowing confirmation of its server revision", async () => {
  let resolve!: (result: SocialActionResult) => void;
  const actions: SocialAction[] = [];
  const initial = snapshot({ trade: trade() });
  initial.trade!.participants[1].offer[0]!.quality="PERFECT";
  const instance = panel((action) => { actions.push(action); return new Promise((done) => { resolve = done; }); }, initial);
  instance.update(initial,{items:[inventoryItem("herb",{quality:"GOOD"})]},"connected",false);
  tab("trade");
  expect(element("[data-social-content]").textContent).toContain("Miecz ×1");
  expect(element("[data-social-content]").textContent).toContain("Jakość: Doskonała");
  expect(element("[data-trade-item]").textContent).toContain("Jakość: Dobra");
  expect(element("[data-social-content]").textContent).toContain("Zatwierdzono");
  type("[data-trade-quantity]", "2");
  button("[data-trade-add]").click();
  expect(actions).toEqual([]);
  expect(button("[data-trade-confirm]").disabled).toBe(true);
  button("[data-trade-save]").click();
  expect(actions).toEqual([{ type: "setTradeOffer", tradeId: "trade", revision: 1, items: [{ instanceId: "herb", quantity: 2 }] }]);
  expect(button("[data-trade-confirm]").disabled).toBe(true);
  resolve({ ok: false, code: "INVALID", message: "Przedmiot niedostępny." });
  await vi.waitFor(() => expect(element("[data-social-feedback]").textContent).toContain("Przedmiot niedostępny"));
  expect(element("[data-trade-draft]").textContent).toContain("Zioło ×2");
  expect(button("[data-trade-confirm]").disabled).toBe(true);
  const next = snapshot({ trade: trade({ revision: 2, participants: [{ player: self, offer: [{ instanceId: "herb", name: "Zioło", quantity: 2 }], confirmed: false }, { player: other, offer: [{ instanceId: "sword", name: "Miecz", quantity: 1 }], confirmed: false }] }) });
  instance.update(next, inventory, "connected", false);
  expect(button("[data-trade-confirm]").disabled).toBe(false);
  button("[data-trade-confirm]").click();
  expect(actions.at(-1)).toEqual({ type: "confirmTrade", tradeId: "trade", revision: 2 });
  expect(button("[data-trade-confirm]").disabled).toBe(true);
  expect(actions).toHaveLength(2);
});

it("excludes equipped, contained, bound and nonempty-container items and never offers automatic confirmation", () => {
  const instance = panel(undefined, snapshot({ trade: trade() }));
  instance.update(snapshot({ trade: trade() }), { items: [inventoryItem("herb"), inventoryItem("equipped", { category: "container", containerCapacity: 8 }), inventoryItem("inside", { containerInstanceId: "bag" }), inventoryItem("bag", { category: "container", containerCapacity: 8 }), inventoryItem("bound", { boundToPlayerId: "self" }), inventoryItem("empty", { name: "Pusty plecak", category: "container", containerCapacity: 8 })], containerSlots: ["equipped", null, null, null] }, "connected", false);
  tab("trade");
  const choices = [...element<HTMLSelectElement>("[data-trade-item]").options].map((option) => option.value);
  expect(choices).toEqual(["herb", "empty"]);
  instance.update(snapshot({ trade: trade({ status: "completed" }) }), inventory, "connected", false);
  expect(element("[data-social-content]").textContent).toContain("Wymiana zakończona");
  expect(element("[data-social-content]").textContent).toContain("Miecz ×1");
  expect(document.querySelector("[data-trade-confirm]")).toBeNull();
});

it("tracks keyboard viewport, closes by Escape and ignores pending ACK after destruction", async () => {
  const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
  const viewport = Object.assign(new EventTarget(), { height: 300, offsetTop: 25 });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  const remove = vi.spyOn(viewport, "removeEventListener");
  let resolve!: (result: SocialActionResult) => void;
  try {
    const instance = panel(() => new Promise((done) => { resolve = done; }));
    const root = element("[data-social-widget]");
    expect(root.style.getPropertyValue("--social-viewport-height")).toBe("300px");
    expect(root.style.getPropertyValue("--social-viewport-top")).toBe("25px");
    tab("friends");
    element<HTMLInputElement>("[data-friend-nickname]").focus();
    expect(instance.isTyping).toBe(true);
    type("[data-friend-nickname]", "Ala");
    element("[data-social-panel]").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(instance.isTyping).toBe(false);
    expect(document.activeElement).toBe(button("[data-social-toggle]"));
    button("[data-social-toggle]").click();
    button('[data-social-action="requestFriend"]').click();
    instance.destroy();
    resolve({ ok: false, code: "LATE", message: "Późny błąd" });
    await Promise.resolve();
    await Promise.resolve();
    expect(root.isConnected).toBe(false);
    expect(root.textContent).not.toContain("Późny błąd");
    expect(remove).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
  } finally { if (original) Object.defineProperty(window, "visualViewport", original); else Reflect.deleteProperty(window, "visualViewport"); }
});
