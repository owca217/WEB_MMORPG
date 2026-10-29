import type { ChatMessage } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { ChatService } from "../src/chat/ChatService";
import { WorldService } from "../src/world/WorldService";

function setup() {
  const world = new WorldService();
  const fighting = new Set<string>();
  const chat = new ChatService(world, (playerId) => fighting.has(playerId));
  const add = (id: string, x = 800, y = 450, locationId = "forest-settlement-01") =>
    world.addPlayer({ id, nickname: `Name-${id}`, x, y, locationId }, 0);
  const send = (id: string, text = "Hello", channel = "nearby", now = 0): ChatMessage => {
    const result = chat.sendMessage(id, { channel, text }, now);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.code);
    return result.message;
  };
  return { world, fighting, chat, add, send };
}

describe("ChatService", () => {
  it("uses authoritative identity and position, normalizes text and keeps global positions private", () => {
    const { chat, add } = setup();
    add("speaker", 600, 350);
    const result = chat.sendMessage("speaker", {
      channel: "nearby", text: "  Hi\n\tthere  ", senderId: "fake", senderName: "Admin", x: 0, sentAt: -1
    }, 42);
    expect(result).toEqual({ ok: true, message: {
      id: expect.any(String), channel: "nearby", senderId: "speaker", senderName: "Name-speaker",
      text: "Hi there", sentAt: 42, locationId: "forest-settlement-01", worldPosition: { x: 600, y: 350 }
    } });
    expect(chat.sendMessage("speaker", { channel: "global", text: "<img src=x onerror=alert(1)>" }, 1042))
      .toEqual({ ok: true, message: {
        id: expect.any(String), channel: "global", senderId: "speaker", senderName: "Name-speaker",
        text: "<img src=x onerror=alert(1)>", sentAt: 1042
      } });
  });

  it("rejects malformed, empty and overlong messages before rate limiting valid messages", () => {
    const { chat, add } = setup();
    add("speaker");
    expect(chat.sendMessage("speaker", null, 0)).toMatchObject({ ok: false, code: "INVALID_CHAT_MESSAGE" });
    expect(chat.sendMessage("speaker", { channel: "admin", text: "Hi" }, 0)).toMatchObject({ ok: false, code: "INVALID_CHAT_CHANNEL" });
    expect(chat.sendMessage("speaker", { channel: "global", text: 42 }, 0)).toMatchObject({ ok: false, code: "INVALID_CHAT_MESSAGE" });
    expect(chat.sendMessage("speaker", { channel: "global", text: " \n " }, 0)).toMatchObject({ ok: false, code: "CHAT_MESSAGE_EMPTY" });
    expect(chat.sendMessage("speaker", { channel: "global", text: "a".repeat(301) }, 0)).toMatchObject({ ok: false, code: "CHAT_MESSAGE_TOO_LONG" });
    expect(chat.sendMessage("speaker", { channel: "global", text: "a".repeat(300) }, 0)).toMatchObject({ ok: true });
    expect(chat.sendMessage("speaker", { channel: "nearby", text: "Again" }, 999)).toMatchObject({ ok: false, code: "CHAT_RATE_LIMITED" });
    expect(chat.sendMessage("speaker", { channel: "nearby", text: "Again" }, 1000)).toMatchObject({ ok: true });
  });

  it("limits a character across channels to five messages per ten seconds", () => {
    const { chat, add, send } = setup();
    add("speaker");
    for (let index = 0; index < 5; index += 1) send("speaker", "Hi", index % 2 ? "global" : "nearby", index * 1000);
    expect(chat.sendMessage("speaker", { channel: "global", text: "Sixth" }, 5000)).toMatchObject({ ok: false, code: "CHAT_RATE_LIMITED" });
    expect(chat.sendMessage("speaker", { channel: "global", text: "Allowed" }, 10000)).toMatchObject({ ok: true });
  });

  it("keeps character flood limits across disconnect and re-registration", () => {
    const { chat, world, add, send } = setup();
    add("speaker");
    send("speaker", "Before disconnect", "global", 0);
    chat.removePlayer("speaker");
    world.removePlayer("speaker");
    add("speaker");
    expect(chat.sendMessage("speaker", { channel: "nearby", text: "After reconnect" }, 999))
      .toMatchObject({ ok: false, code: "CHAT_RATE_LIMITED" });
    expect(chat.sendMessage("speaker", { channel: "nearby", text: "After interval" }, 1000))
      .toMatchObject({ ok: true });
  });

  it("bounds flood-limit records and admits new senders after expired records are pruned", () => {
    const { chat, world, add, send } = setup();
    for (let index = 0; index < 4096; index += 1) {
      const id = `speaker-${index}`;
      add(id);
      send(id, "Hi", "nearby", 0);
      chat.removePlayer(id);
      world.removePlayer(id);
    }
    add("new-speaker");
    expect(chat.sendMessage("new-speaker", { channel: "global", text: "Full window" }, 500))
      .toMatchObject({ ok: false, code: "CHAT_RATE_LIMITED" });
    expect(chat.sendMessage("new-speaker", { channel: "global", text: "Expired window" }, 10000))
      .toMatchObject({ ok: true });
  });

  it("uses each recipient's visible viewport, with inclusive boundaries and no default leakage", () => {
    const { chat, add, send } = setup();
    add("speaker", 1000, 450);
    add("desktop", 800, 450);
    add("phone", 800, 450);
    add("unregistered", 1000, 450);
    add("other-world", 1000, 450, "other-world");
    chat.setViewport("desktop", { width: 1000, height: 600 });
    chat.setViewport("phone", { width: 400, height: 300 });
    chat.setViewport("other-world", { width: 1600, height: 900 });
    expect(chat.nearbyRecipients(send("speaker"))).toEqual(["speaker", "desktop", "phone"]);
    add("speaker", 1001, 450);
    expect(chat.nearbyRecipients(send("speaker", "Outside phone", "nearby", 1000))).toEqual(["speaker", "desktop"]);
    add("speaker", 800, 601);
    expect(chat.nearbyRecipients(send("speaker", "Below phone", "nearby", 2000))).toEqual(["speaker", "desktop"]);
  });

  it("clamps cameras at map edges, validates dimensions and limits oversized viewports to the map", () => {
    const { chat, add, send } = setup();
    add("speaker", 400, 300);
    add("edge", 10, 10);
    add("invalid", 10, 10);
    add("large", 1590, 890);
    chat.setViewport("edge", { width: 400, height: 300 });
    chat.setViewport("invalid", { width: NaN, height: 300 });
    chat.setViewport("invalid", { width: 400, height: Infinity });
    chat.setViewport("invalid", { width: -1, height: 300 });
    chat.setViewport("large", { width: 999999, height: 999999 });
    expect(chat.nearbyRecipients(send("speaker"))).toEqual(["speaker", "edge", "large"]);
    add("speaker", 401, 300);
    expect(chat.nearbyRecipients(send("speaker", "Outside edge", "nearby", 1000))).toEqual(["speaker", "large"]);
    chat.removePlayer("large");
    expect(chat.nearbyRecipients(send("speaker", "Cleared", "nearby", 2000))).toEqual(["speaker"]);
  });

  it("uses the larger forest bounds for nearby chat at its eastern and southern edges",()=>{
    const {chat,add,send}=setup();
    add("speaker",1800,1100,"eastern-forest-01");
    add("listener",1840,1100,"eastern-forest-01");
    add("settler",1500,800,"forest-settlement-01");
    chat.setViewport("listener",{width:400,height:300});
    chat.setViewport("settler",{width:1600,height:900});
    expect(chat.nearbyRecipients(send("speaker"))).toEqual(["speaker","listener"]);
  });

  it("excludes battle participants from nearby chat while preserving global chat", () => {
    const { chat, fighting, add, send } = setup();
    add("speaker"); add("fighter"); add("listener");
    chat.setViewport("fighter", { width: 1000, height: 600 });
    chat.setViewport("listener", { width: 1000, height: 600 });
    fighting.add("fighter");
    expect(chat.nearbyRecipients(send("speaker"))).toEqual(["speaker", "listener"]);
    expect(chat.sendMessage("fighter", { channel: "nearby", text: "Hi" }, 0)).toMatchObject({ ok: false, code: "NEARBY_CHAT_UNAVAILABLE" });
    expect(chat.sendMessage("fighter", { channel: "global", text: "Hi" }, 0)).toMatchObject({ ok: true });
  });

  it("retains only the latest 50 global messages and returns independent history snapshots", () => {
    const { chat, add, send } = setup();
    add("speaker");
    for (let index = 0; index < 55; index += 1) send("speaker", `Global ${index}`, "global", index * 10000);
    send("speaker", "Nearby only", "nearby", 550000);
    const history = chat.getHistory();
    expect(history).toHaveLength(50);
    expect(history[0]?.text).toBe("Global 5");
    expect(history.at(-1)?.text).toBe("Global 54");
    history[0]!.text = "Mutated";
    expect(chat.getHistory()[0]?.text).toBe("Global 5");
  });
});
