/* @vitest-environment jsdom */

import type { ChatChannel, ChatMessage, ChatSendResult } from "@web-mmorpg/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChatWidget } from "../src/ui/ChatWidget";

const widgets: ChatWidget[] = [];

function message(id: string, channel: ChatChannel = "nearby", text = `Wiadomość ${id}`): ChatMessage {
  return { id, channel, senderId: "player-1", senderName: "Ala", text, sentAt: Date.UTC(2026, 9, 29, 12, 30) };
}

function widget(onSend = vi.fn<(channel: ChatChannel, text: string) => Promise<ChatSendResult>>()): ChatWidget {
  const result = new ChatWidget({ onSend });
  widgets.push(result);
  result.update([], "connected", true);
  return result;
}

function element<T extends HTMLElement = HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing chat element: ${selector}`);
  return result;
}

function button(selector: string): HTMLButtonElement { return element<HTMLButtonElement>(selector); }
function input(): HTMLTextAreaElement { return element<HTMLTextAreaElement>("[data-chat-input]"); }
function open(): void { button("[data-chat-toggle]").click(); }
function tab(channel: ChatChannel): void { button(`[data-chat-tab="${channel}"]`).click(); }
function type(text: string): void { input().value = text; input().dispatchEvent(new Event("input", { bubbles: true })); }
function send(): void { button("[data-chat-send]").click(); }

beforeEach(() => {
  document.body.replaceChildren();
  vi.stubGlobal("innerWidth", 1280);
  vi.stubGlobal("innerHeight", 720);
});
afterEach(() => { for (const instance of widgets.splice(0)) instance.destroy(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  { name: "portrait world menu", width: 390, height: 844, nearby: true },
  { name: "landscape battle launcher", width: 844, height: 390, nearby: false }
])("opens mobile chat without entering typing mode from the $name", ({ width, height, nearby }) => {
  vi.stubGlobal("innerWidth", width);
  vi.stubGlobal("innerHeight", height);
  const instance = new ChatWidget({ onSend: vi.fn() });
  widgets.push(instance);
  instance.update([], "connected", nearby);
  const invoker = nearby ? document.createElement("button") : button("[data-chat-toggle]");
  if (nearby) document.body.append(invoker);
  invoker.focus();
  if (nearby) instance.toggle(); else open();

  expect(document.activeElement).toBe(button(`[data-chat-tab="${nearby ? "nearby" : "global"}"]`));
  expect(instance.isTyping).toBe(false);
  // Explicitly focusing the composer (as a browser does on a tap) still starts editing.
  input().focus();
  expect(instance.isTyping).toBe(true);
  type("Szkic na telefonie");
  const back = new Event("game-ui-back", { cancelable: true });
  document.dispatchEvent(back);
  expect(back.defaultPrevented).toBe(true);
  expect(instance.isTyping).toBe(false);
  expect(document.activeElement).toBe(invoker);
  instance.toggle();
  expect(instance.isTyping).toBe(false);
  expect(input().value).toBe("Szkic na telefonie");
});

it("avoids opening the keyboard for a coarse primary pointer even with a desktop-sized viewport", () => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: query === "(pointer: coarse)" })));
  const instance = widget();
  open();
  expect(document.activeElement).toBe(button('[data-chat-tab="nearby"]'));
  expect(instance.isTyping).toBe(false);
});

it("opens an accessible two-channel panel, renders text safely and keeps separate drafts", () => {
  const instance = widget();
  instance.update([message("local", "nearby", '<img src=x onerror="alert(1)">'), { ...message("world", "global"), senderName: "<b>Ola</b>" }], "connected", true);
  open();

  expect(element("[data-chat-panel]").classList.contains("game-panel")).toBe(true);
  expect(button('[data-chat-tab="nearby"]').getAttribute("aria-selected")).toBe("true");
  expect(element("[data-chat-messages]").textContent).toContain('<img src=x onerror="alert(1)">');
  expect(element("[data-chat-messages]").querySelector("img")).toBeNull();
  expect(instance.isTyping).toBe(true);
  type("Blisko");
  tab("global");
  expect(input().value).toBe("");
  expect(element("[data-chat-messages]").textContent).toContain("<b>Ola</b>");
  expect(element("[data-chat-messages]").querySelector("b")).toBeNull();
  type("Wszędzie");
  tab("nearby");
  expect(input().value).toBe("Blisko");
  tab("global");
  expect(input().value).toBe("Wszędzie");
  input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(element("[data-chat-panel]").classList.contains("is-hidden")).toBe(true);
  expect(document.activeElement).toBe(button("[data-chat-toggle]"));
  expect(instance.isTyping).toBe(false);
});

it("starts on the general channel during battle and keeps nearby history available", () => {
  const instance = new ChatWidget({ onSend: vi.fn() });
  widgets.push(instance);
  instance.update([message("nearby-history")], "connected", false);
  open();

  expect(button('[data-chat-tab="global"]').textContent).toContain("Ogólny");
  expect(button('[data-chat-tab="global"]').getAttribute("aria-selected")).toBe("true");
  expect(input().disabled).toBe(false);
  expect(instance.isTyping).toBe(true);
  tab("nearby");
  expect(element("[data-chat-messages]").textContent).toContain("Wiadomość nearby-history");
  expect(input().disabled).toBe(true);
  expect(element("[data-chat-description]").textContent).toContain("walki");
});

it("blocks duplicate sends, waits for the parent message update and preserves a draft edited during an ACK", async () => {
  let resolve!: (result: ChatSendResult) => void;
  const onSend = vi.fn(() => new Promise<ChatSendResult>((done) => { resolve = done; }));
  const instance = widget(onSend);
  open();
  type("  Cześć  ");
  send();
  send();
  input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  expect(onSend).toHaveBeenCalledExactlyOnceWith("nearby", "Cześć");
  expect(button("[data-chat-send]").disabled).toBe(true);
  expect(document.querySelectorAll("[data-chat-message-id]")).toHaveLength(0);
  type("Następna wiadomość");
  const accepted = message("accepted", "nearby", "Cześć");
  instance.update([accepted], "connected", true);
  resolve({ ok: true, message: accepted });
  await vi.waitFor(() => expect(button("[data-chat-send]").disabled).toBe(false));
  expect(input().value).toBe("Następna wiadomość");
  expect(document.querySelectorAll("[data-chat-message-id]")).toHaveLength(1);

  send();
  resolve({ ok: true, message: message("second") });
  await vi.waitFor(() => expect(input().value).toBe(""));
  expect(document.querySelectorAll("[data-chat-message-id]")).toHaveLength(1);
});

it("preserves rejected drafts, permits retrying and prevents invalid or unavailable sends", async () => {
  const onSend = vi.fn<(channel: ChatChannel, text: string) => Promise<ChatSendResult>>()
    .mockResolvedValueOnce({ ok: false, code: "RATE_LIMITED", message: "Poczekaj chwilę." })
    .mockRejectedValueOnce(new Error("offline"));
  const instance = widget(onSend);
  open();
  type("Próba");
  send();
  await vi.waitFor(() => expect(element("[data-chat-feedback]").textContent).toContain("Poczekaj chwilę."));
  expect(input().value).toBe("Próba");
  expect(button("[data-chat-send]").disabled).toBe(false);
  send();
  await vi.waitFor(() => expect(element("[data-chat-feedback]").dataset.state).toBe("error"));
  expect(input().value).toBe("Próba");
  instance.update([], "disconnected", true);
  expect(button("[data-chat-send]").disabled).toBe(true);
  expect(element("[data-chat-connection]").textContent).toBeTruthy();
  instance.update([], "connected", false);
  expect(input().disabled).toBe(true);
  expect(element("[data-chat-description]").textContent).toContain("walki");
  tab("global");
  expect(input().disabled).toBe(false);
  type("x".repeat(301));
  expect(input().maxLength).toBe(300);
  expect(button("[data-chat-send]").disabled).toBe(true);
  type("   ");
  expect(button("[data-chat-send]").disabled).toBe(true);
  expect(onSend).toHaveBeenCalledTimes(2);
});

it("counts only new unread IDs per channel and supports keyboard tabs without swallowing typed arrows", () => {
  const instance = new ChatWidget({ onSend: vi.fn() });
  widgets.push(instance);
  const initial = [message("nearby-old"), message("global-old", "global")];
  instance.update(initial, "connected", true);
  expect(element('[data-chat-unread-total]').hidden).toBe(true);
  const updated = [...initial, message("nearby-new"), message("global-new", "global")];
  instance.update(updated, "connected", true);
  instance.update(updated, "connected", true);
  expect(element('[data-chat-unread-total]').textContent).toBe("2");
  expect(element('[data-chat-unread="nearby"]').textContent).toBe("1");
  expect(element('[data-chat-unread="global"]').textContent).toBe("1");
  open();
  expect(element('[data-chat-unread="nearby"]').hidden).toBe(true);
  const localTab = button('[data-chat-tab="nearby"]');
  localTab.focus();
  localTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  expect(button('[data-chat-tab="global"]').getAttribute("aria-selected")).toBe("true");
  expect(document.activeElement).toBe(button('[data-chat-tab="global"]'));
  expect(element('[data-chat-unread-total]').hidden).toBe(true);
  input().focus();
  input().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  expect(button('[data-chat-tab="global"]').getAttribute("aria-selected")).toBe("true");
});

it("counts the first live message after an empty initial update while the panel is closed", () => {
  const instance = widget();
  instance.update([message("first-live")], "connected", true);
  expect(element('[data-chat-unread="nearby"]').textContent).toBe("1");
  expect(element('[data-chat-unread="nearby"]').hidden).toBe(false);
  expect(element("[data-chat-unread-total]").textContent).toBe("1");
  instance.update([message("first-live"), message("first-global-live", "global")], "connected", true);
  expect(element('[data-chat-unread="global"]').textContent).toBe("1");
  expect(element('[data-chat-unread="global"]').hidden).toBe(false);
  expect(element("[data-chat-unread-total]").textContent).toBe("2");
});

it("sends on Enter while leaving Shift+Enter and IME composition available", async () => {
  const onSend = vi.fn<(channel: ChatChannel, text: string) => Promise<ChatSendResult>>()
    .mockResolvedValue({ ok: true, message: message("sent") });
  widget(onSend);
  open();
  type("Witaj");
  input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
  input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
  expect(onSend).not.toHaveBeenCalled();
  input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.waitFor(() => expect(onSend).toHaveBeenCalledExactlyOnceWith("nearby", "Witaj"));
});

it("keeps a reader's scroll position and follows new messages when already at the bottom or sending", () => {
  const onSend = vi.fn(() => new Promise<ChatSendResult>(() => undefined));
  const instance = widget(onSend);
  const initial = [message("first")];
  instance.update(initial, "connected", true);
  open();
  const transcript = element("[data-chat-messages]");
  let height = 1000;
  Object.defineProperty(transcript, "scrollHeight", { configurable: true, get: () => height });
  Object.defineProperty(transcript, "clientHeight", { configurable: true, value: 200 });
  transcript.scrollTop = 100;
  instance.update([...initial, message("second")], "connected", true);
  expect(transcript.scrollTop).toBe(100);
  transcript.scrollTop = 800;
  height = 1200;
  instance.update([...initial, message("second"), message("third")], "connected", true);
  // At the bottom before adding a message, a real browser measures the old height first.
  transcript.scrollTop = 1000;
  instance.update([...initial, message("second"), message("third"), message("fourth")], "connected", true);
  expect(transcript.scrollTop).toBe(height);
  transcript.scrollTop = 100;
  type("Wiadomość od czytającego");
  send();
  instance.update([...initial, message("own")], "connected", true);
  expect(transcript.scrollTop).toBe(height);
});

it("tracks the visual viewport and removes its listeners and pending ACK effects on destruction", async () => {
  const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
  const viewport = Object.assign(new EventTarget(), { height: 310, offsetTop: 20 });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  const removeViewportListener = vi.spyOn(viewport, "removeEventListener");
  let resolve!: (result: ChatSendResult) => void;
  try {
    const instance = widget(vi.fn(() => new Promise<ChatSendResult>((done) => { resolve = done; })));
    open();
    const root = element("[data-chat-widget]");
    expect(root.style.getPropertyValue("--chat-viewport-height")).toBe("310px");
    expect(root.style.getPropertyValue("--chat-viewport-top")).toBe("20px");
    expect(root.dataset.compact).toBe("true");
    viewport.height = 230;
    viewport.dispatchEvent(new Event("resize"));
    expect(root.style.getPropertyValue("--chat-viewport-height")).toBe("230px");
    viewport.height = 540;
    viewport.dispatchEvent(new Event("resize"));
    expect(root.dataset.compact).toBe("false");
    type("Późna odpowiedź");
    send();
    instance.destroy();
    resolve({ ok: true, message: message("late") });
    await Promise.resolve();
    await Promise.resolve();
    expect(root.isConnected).toBe(false);
    expect(inputFrom(root).value).toBe("Późna odpowiedź");
    expect(instance.isTyping).toBe(false);
    expect(removeViewportListener).toHaveBeenCalledWith("resize", expect.any(Function));
    expect(removeViewportListener).toHaveBeenCalledWith("scroll", expect.any(Function));
  } finally {
    if (original) Object.defineProperty(window, "visualViewport", original);
    else Reflect.deleteProperty(window, "visualViewport");
  }
});

function inputFrom(root: HTMLElement): HTMLTextAreaElement {
  return root.querySelector<HTMLTextAreaElement>("[data-chat-input]")!;
}
