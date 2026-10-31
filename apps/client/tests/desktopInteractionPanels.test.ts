/* @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OptionsPanel } from "../src/ui/OptionsPanel";
import { PlayerContextMenu } from "../src/ui/PlayerContextMenu";
import { readRightClickInteractions, setRightClickInteractions } from "../src/ui/interactionPreferences";
import { closeForegroundGamePanel } from "../src/ui/gameWindows";

const surfaces: Array<{ destroy(): void }> = [];
beforeEach(() => { setRightClickInteractions(true); });
afterEach(() => {
  for (const surface of surfaces.splice(0)) surface.destroy();
  document.body.replaceChildren();
  document.documentElement.style.cssText = "";
  vi.restoreAllMocks();
});

it("opens options on the saved mouse preference, persists a change and focuses the control", () => {
  setRightClickInteractions(false);
  const onChange = vi.fn(), panel = new OptionsPanel({ onChange }); surfaces.push(panel);
  panel.show();
  const checkbox = document.querySelector<HTMLInputElement>('[data-options-panel] input[type="checkbox"]')!;
  expect(checkbox.checked).toBe(false); expect(document.activeElement).toBe(checkbox);
  checkbox.checked = true; checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  expect(readRightClickInteractions()).toBe(true); expect(onChange).toHaveBeenCalledOnce();
  const second = new OptionsPanel({}); surfaces.push(second); second.show();
  expect(document.querySelectorAll<HTMLInputElement>('[data-options-panel] input[type="checkbox"]')[1]!.checked).toBe(true);
});

it("closes options through Escape or the native foreground callback and restores its launcher", () => {
  const launcher = document.createElement("button"); document.body.append(launcher); launcher.focus();
  const panel = new OptionsPanel({}); surfaces.push(panel); panel.show();
  const root = document.querySelector<HTMLElement>('[data-options-panel]')!;
  document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(root.hidden).toBe(true); expect(document.activeElement).toBe(launcher);
  panel.show(); expect(closeForegroundGamePanel()).toBe(true); expect(root.hidden).toBe(true);
  panel.destroy(); panel.show(); expect(document.querySelector('[data-options-panel]')).toBeNull();
});

it("targets the currently selected player by exact ID, closes before acting and renders names safely", () => {
  const onParty = vi.fn(() => expect(document.querySelector<HTMLElement>('[data-player-menu]')!.hidden).toBe(true));
  const onTrade = vi.fn(), menu = new PlayerContextMenu({ onParty, onTrade }); surfaces.push(menu);
  const nickname = '<img src=x onerror=alert(1)>';
  menu.show({ id: "first-player", nickname }, { x: 200, y: 150 });
  const root = document.querySelector<HTMLElement>('[data-player-menu]')!;
  expect(root.getAttribute("role")).toBe("menu"); expect(root.querySelector("img")).toBeNull();
  expect(root.textContent).toContain(nickname);
  const party = root.querySelector<HTMLButtonElement>('[data-player-action="party"]')!;
  party.click(); party.click(); expect(onParty).toHaveBeenCalledExactlyOnceWith("first-player");
  menu.show({ id: "second-player", nickname: "Drugi" }, { x: 200, y: 150 });
  const trade = root.querySelector<HTMLButtonElement>('[data-player-action="trade"]')!;
  trade.click(); expect(onTrade).toHaveBeenCalledExactlyOnceWith("second-player");
  menu.destroy(); trade.click(); expect(onTrade).toHaveBeenCalledTimes(1);
});

it("clamps player actions inside safe viewport edges and reclamps on resize", () => {
  const menu = new PlayerContextMenu({ onParty: vi.fn(), onTrade: vi.fn() }); surfaces.push(menu);
  document.documentElement.style.setProperty("--safe-area-left", "20px");
  document.documentElement.style.setProperty("--safe-area-right", "16px");
  document.documentElement.style.setProperty("--safe-area-top", "8px");
  document.documentElement.style.setProperty("--safe-area-bottom", "10px");
  menu.show({ id: "player", nickname: "Gracz" }, { x: 10000, y: 10000 });
  const root = document.querySelector<HTMLElement>('[data-player-menu]')!;
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ width: 208, height: 180 } as DOMRect);
  menu.reposition({ x: 10000, y: 10000 });
  expect(parseFloat(root.style.left) + 208).toBeLessThanOrEqual(window.innerWidth - 28);
  expect(parseFloat(root.style.top) + 180).toBeLessThanOrEqual(window.innerHeight - 22);
  menu.reposition({ x: -1000, y: -1000 });
  expect(parseFloat(root.style.left)).toBeGreaterThanOrEqual(32);
  expect(parseFloat(root.style.top)).toBeGreaterThanOrEqual(20);
  root.style.left = "99999px"; window.dispatchEvent(new Event("resize"));
  expect(parseFloat(root.style.left)).toBe(32);
});

it("lets an outside primary click keep its focus path while explicit dismissal restores the invoker", () => {
  const launcher = document.createElement("button"), canvas = document.createElement("canvas");
  document.body.append(launcher, canvas); launcher.focus();
  const menu = new PlayerContextMenu({ onParty: vi.fn(), onTrade: vi.fn() }); surfaces.push(menu);
  const player = { id: "player", nickname: "Gracz" }, anchor = { x: 200, y: 150 };
  menu.show(player, anchor);
  const restore = vi.spyOn(launcher, "focus");
  canvas.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  expect(document.querySelector<HTMLElement>('[data-player-menu]')!.hidden).toBe(true);
  expect(restore).not.toHaveBeenCalled();
  launcher.focus(); restore.mockClear(); menu.show(player, anchor);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(restore).toHaveBeenCalledOnce(); expect(document.activeElement).toBe(launcher);
});

it("keeps menu pointer/context events off the world and closes outside or on Escape without actions", () => {
  const onParty = vi.fn(), onTrade = vi.fn(), worldPointer = vi.fn();
  const menu = new PlayerContextMenu({ onParty, onTrade }); surfaces.push(menu);
  const player = { id: "player", nickname: "Gracz" }, anchor = { x: 200, y: 150 };
  menu.show(player, anchor);
  const root = document.querySelector<HTMLElement>('[data-player-menu]')!;
  document.body.addEventListener("pointerdown", worldPointer); document.body.addEventListener("pointerup", worldPointer);
  root.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  root.dispatchEvent(new Event("pointerup", { bubbles: true }));
  const context = new Event("contextmenu", { bubbles: true, cancelable: true }); root.dispatchEvent(context);
  expect(worldPointer).not.toHaveBeenCalled(); expect(context.defaultPrevented).toBe(true); expect(root.hidden).toBe(false);
  document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })); expect(root.hidden).toBe(true);
  menu.show(player, anchor);
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  expect(root.hidden).toBe(true); expect(onParty).not.toHaveBeenCalled(); expect(onTrade).not.toHaveBeenCalled();
  document.body.removeEventListener("pointerdown", worldPointer); document.body.removeEventListener("pointerup", worldPointer);
});
