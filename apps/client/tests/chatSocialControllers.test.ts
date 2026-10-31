/* @vitest-environment jsdom */

import type { ChatMessage, SocialSnapshot } from "@web-mmorpg/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { gameSocket } from "../src/net/GameSocket";
import { chatStateStore } from "../src/state/ChatStateStore";
import { socialStateStore } from "../src/state/SocialStateStore";
import { ChatController } from "../src/ui/ChatController";
import { SocialController } from "../src/ui/SocialController";

const controllers: Array<{ destroy(): void }> = [];
const message: ChatMessage = { id: "new", channel: "nearby", senderId: "other", senderName: "Ala", text: "Cześć", sentAt: 1 };
const social: SocialSnapshot = { selfId: "self", onlinePlayers: [], friends: [], incomingFriendRequests: [{ id: "other", nickname: "Ala", online: true, inBattle: false }], outgoingFriendRequests: [], party: null, partyInvites: [], trade: null };

function launcher(): HTMLButtonElement {
  const button = document.createElement("button");
  document.body.append(button);
  button.focus();
  return button;
}

function panel(selector: string): HTMLElement { return document.querySelector<HTMLElement>(selector)!; }

beforeEach(() => {
  document.body.replaceChildren();
  chatStateStore.reset();
  socialStateStore.reset();
  vi.spyOn(gameSocket, "onChatMessage").mockImplementation(() => () => undefined);
  vi.spyOn(gameSocket, "onConnectionState").mockImplementation((handler) => { handler("connected"); return () => undefined; });
  vi.spyOn(gameSocket, "requestChatHistory").mockResolvedValue({ ok: true, messages: [] });
  vi.spyOn(gameSocket, "requestSocialState").mockResolvedValue({ ok: true, social });
  vi.spyOn(gameSocket, "requestPlayerState").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  vi.restoreAllMocks();
});

it("opens chat from the world menu, keeps drafts and unread status, and returns focus on Back", () => {
  const statuses: Array<{ opened: boolean; unread: number }> = [];
  const controller = new ChatController({ nearbyAvailable: true, onStatusChange: (status) => statuses.push(status) });
  controllers.push(controller);
  chatStateStore.add(message);
  const invoker = launcher();
  controller.toggle();
  expect(panel("[data-chat-panel]").classList.contains("is-hidden")).toBe(false);
  expect(statuses).toContainEqual({ opened: false, unread: 1 });
  expect(statuses.at(-1)).toEqual({ opened: true, unread: 0 });
  const input = panel("[data-chat-input]") as HTMLTextAreaElement;
  input.value = "Szkic";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const back = new Event("game-ui-back", { cancelable: true });
  document.dispatchEvent(back);
  expect(back.defaultPrevented).toBe(true);
  expect(panel("[data-chat-panel]").classList.contains("is-hidden")).toBe(true);
  expect(document.activeElement).toBe(invoker);
  expect(controller.isTyping).toBe(false);
  controller.toggle();
  expect(input.value).toBe("Szkic");
  controller.toggle();
  expect(panel("[data-chat-panel]").classList.contains("is-hidden")).toBe(true);
  controller.destroy();
  const afterDestroy = new Event("game-ui-back", { cancelable: true });
  document.dispatchEvent(afterDestroy);
  expect(afterDestroy.defaultPrevented).toBe(false);
});

it("opens social from the world menu and keeps invitation access and a nickname draft after Escape", () => {
  const statuses: Array<{ opened: boolean; notifications: number }> = [];
  const controller = new SocialController({ inBattle: false, onInventoryChanged: () => undefined, onStatusChange: (status) => statuses.push(status) });
  controllers.push(controller);
  socialStateStore.set(social);
  const invoker = launcher();
  controller.toggle();
  expect(panel("[data-social-panel]").classList.contains("is-hidden")).toBe(false);
  expect(statuses.at(-1)).toEqual({ opened: true, notifications: 1 });
  const input = panel("[data-friend-nickname]") as HTMLInputElement;
  input.value = "Ola";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const currentInput = panel("[data-friend-nickname]") as HTMLInputElement;
  currentInput.focus();
  expect(controller.isTyping).toBe(true);
  currentInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(panel("[data-social-panel]").classList.contains("is-hidden")).toBe(true);
  expect(document.activeElement).toBe(invoker);
  expect(statuses.at(-1)).toEqual({ opened: false, notifications: 1 });
  controller.toggle();
  expect((panel("[data-friend-nickname]") as HTMLInputElement).value).toBe("Ola");
  const back = new Event("game-ui-back", { cancelable: true });
  document.dispatchEvent(back);
  expect(back.defaultPrevented).toBe(true);
  expect(panel("[data-social-panel]").classList.contains("is-hidden")).toBe(true);
});
