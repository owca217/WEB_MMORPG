import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { ChatMessage, ChatSendResult, PlayerStateSnapshot } from "@web-mmorpg/shared";
import { io as createClient, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthService } from "../src/auth/AuthService";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { AccountRepository } from "../src/persistence/AccountRepository";
import { createGameServer } from "../src/server/createGameServer";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl && !new URL(databaseUrl).pathname.endsWith("_test")) {
  throw new Error("Socket chat tests require a disposable database whose name ends with _test.");
}
const describeDatabase = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? createPool(databaseUrl) : null;
const clients: Socket[] = [];
let closeServer: (() => Promise<void>) | undefined;

beforeAll(async () => {
  if (!pool) return;
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await runMigrations(pool);
  await seedItemMetadata(pool);
});

beforeEach(async () => {
  if (pool) await pool.query("TRUNCATE item_instances, account_sessions, characters, accounts CASCADE");
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await closeServer?.();
  closeServer = undefined;
  vi.restoreAllMocks();
});
afterAll(async () => { await pool?.end(); });

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 1500);
    socket.once(event, (value: T) => { clearTimeout(timeout); resolve(value); });
  });
}

async function setup() {
  if (!pool) throw new Error("DATABASE_URL_REQUIRED");
  const lifecycle = new CharacterLifecycleService(pool);
  const auth = new AuthService(pool, new AccountRepository(pool), lifecycle);
  const server = createServer();
  const game = createGameServer(server, { pool, authService: auth, characterLifecycle: lifecycle });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  closeServer = async () => {
    await new Promise<void>((resolve) => game.io.close(() => resolve()));
    if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };
  const connect = async () => {
    const socket = createClient(`http://127.0.0.1:${port}`, { transports: ["websocket"], forceNew: true });
    clients.push(socket);
    await once(socket, "connect");
    return socket;
  };
  const identity = async (name: string, x = 800, y = 450, locationId = "forest-settlement-01") => {
    await auth.register(name, "correct-horse-battery-staple");
    const account = await new AccountRepository(pool).findByNormalizedUsername(name);
    const character = await lifecycle.createCharacter(account!.id, { nickname: `Hero${name}`, appearance: {} });
    await lifecycle.saveGameplayState(character.id, {
      locationId, x, y, level: 1, experience: 0, hp: 100, maxHp: 100, maxAp: 5,
      initiative: 10, severelyInjured: false, injuries: []
    });
    const { token } = await auth.login(name, "correct-horse-battery-staple");
    const socket = await connect();
    const state = once<PlayerStateSnapshot>(socket, "playerState");
    expect(await socket.timeout(1500).emitWithAck("authenticate", { sessionToken: token })).toMatchObject({ ok: true, characterId: character.id });
    await state;
    const messages: ChatMessage[] = [];
    socket.on("chatMessage", (message) => messages.push(message));
    return { socket, messages, token, characterId: character.id, accountId: account!.id };
  };
  const flush = async () => {
    await Promise.all(clients.filter((client) => client.connected).map((client) => client.timeout(1500).emitWithAck("requestChatHistory")));
  };
  return { game, connect, identity, flush, lifecycle };
}

describeDatabase("authenticated chat Socket.IO flow", () => {
  it("requires authentication, broadcasts global across locations and ignores spoofed identity and coordinates", async () => {
    const { connect, identity, flush } = await setup();
    const unauthenticated = await connect();
    const leaked: ChatMessage[] = [];
    unauthenticated.on("chatMessage", (message) => leaked.push(message));
    expect(await unauthenticated.timeout(1000).emitWithAck("sendChatMessage", { channel: "global", text: "Hello" }))
      .toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
    expect(await unauthenticated.timeout(1000).emitWithAck("requestChatHistory"))
      .toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
    const first = await identity("first");
    const second = await identity("second", 10, 10, "another-world");
    const before = Date.now();
    const result: ChatSendResult = await first.socket.timeout(1000).emitWithAck("sendChatMessage", {
      channel: "global", text: "  Hello\n<img src=x onerror=alert(1)>  ",
      senderId: second.characterId, senderName: "Administrator", sentAt: -1, locationId: "fake", worldPosition: { x: 0, y: 0 }
    });
    expect(result).toMatchObject({ ok: true, message: {
      senderId: first.characterId, senderName: "Herofirst", text: "Hello <img src=x onerror=alert(1)>"
    } });
    if (!result.ok) throw new Error(result.code);
    expect(result.message.sentAt).toBeGreaterThanOrEqual(before);
    expect(result.message).not.toHaveProperty("worldPosition");
    expect(result.message).not.toHaveProperty("locationId");
    await flush();
    expect(first.messages).toEqual([result.message]);
    expect(second.messages).toEqual([result.message]);
    expect(leaked).toEqual([]);
    expect(await second.socket.timeout(1000).emitWithAck("requestChatHistory")).toEqual({ ok: true, messages: [result.message] });
    expect(await first.socket.timeout(1000).emitWithAck("sendChatMessage", { channel: "nearby", text: "Too fast" }))
      .toMatchObject({ ok: false, code: "CHAT_RATE_LIMITED" });
    expect(await second.socket.timeout(1000).emitWithAck("sendChatMessage", { channel: "global", text: "x".repeat(301) }))
      .toMatchObject({ ok: false, code: "CHAT_MESSAGE_TOO_LONG" });
    const local = await second.socket.timeout(1000).emitWithAck("sendChatMessage", { channel: "nearby", text: "Only here" });
    expect(local).toMatchObject({ ok: true, message: { locationId: "another-world", worldPosition: { x: 10, y: 10 } } });
    await flush();
    expect(first.messages).toEqual([result.message]);
    expect(second.messages).toHaveLength(2);
    expect(await first.socket.timeout(1000).emitWithAck("requestChatHistory")).toEqual({ ok: true, messages: [result.message] });
  }, 20000);

  it("routes nearby by recipient phone/desktop viewport boundaries, map edges and registered dimensions", async () => {
    const { identity, game, flush } = await setup();
    const speaker = await identity("speaker", 1000, 450);
    const desktop = await identity("desktop");
    const phone = await identity("phone");
    const noViewport = await identity("missing", 1000, 450);
    const edge = await identity("edge", 10, 10);
    desktop.socket.emit("updateChatViewport", { width: 1000, height: 600, x: 0, y: 0 });
    phone.socket.emit("updateChatViewport", { width: 400, height: 300, x: 1400, y: 800 });
    edge.socket.emit("updateChatViewport", { width: 400, height: 300 });
    await flush();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const send = async (text: string) => {
      expect(await speaker.socket.timeout(1000).emitWithAck("sendChatMessage", { channel: "nearby", text })).toMatchObject({ ok: true });
      now += 1000;
      await flush();
    };
    await send("At phone edge");
    expect(desktop.messages).toHaveLength(1);
    expect(phone.messages).toHaveLength(1);
    expect(noViewport.messages).toEqual([]);
    expect(edge.messages).toEqual([]);
    game.services.world.addPlayer({ id: speaker.characterId, nickname: "Herospeaker", x: 1001, y: 450 });
    await send("Outside phone");
    expect(desktop.messages).toHaveLength(2);
    expect(phone.messages).toHaveLength(1);
    game.services.world.addPlayer({ id: speaker.characterId, nickname: "Herospeaker", x: 400, y: 300 });
    await send("At map edge viewport");
    expect(edge.messages).toHaveLength(1);
    game.services.world.addPlayer({ id: speaker.characterId, nickname: "Herospeaker", x: 401, y: 300 });
    await send("Outside map edge viewport");
    expect(edge.messages).toHaveLength(1);
    expect(speaker.messages).toHaveLength(4);
    expect(noViewport.messages).toEqual([]);
  }, 20000);

  it("keeps global available in battle and excludes battle participants from nearby delivery", async () => {
    const { identity, flush } = await setup();
    const fighter = await identity("fighter", 1320, 455);
    const listener = await identity("listener", 1300, 455);
    fighter.socket.emit("updateChatViewport", { width: 1000, height: 600 });
    listener.socket.emit("updateChatViewport", { width: 1000, height: 600 });
    const started = once(fighter.socket, "battleStarted");
    fighter.socket.emit("startEncounter", { encounterId: "wolf-pack-01" });
    await started;
    expect(await fighter.socket.timeout(1000).emitWithAck("sendChatMessage", { channel: "nearby", text: "Near" }))
      .toMatchObject({ ok: false, code: "NEARBY_CHAT_UNAVAILABLE" });
    expect(await listener.socket.timeout(1000).emitWithAck("sendChatMessage", { channel: "nearby", text: "Near listener" }))
      .toMatchObject({ ok: true });
    await flush();
    expect(fighter.messages).toEqual([]);
    expect(listener.messages).toHaveLength(1);
    const sent = await fighter.socket.timeout(1000).emitWithAck("sendChatMessage", { channel: "global", text: "From battle" });
    expect(sent).toMatchObject({ ok: true });
    await flush();
    expect(fighter.messages).toEqual([sent.message]);
    expect(listener.messages.at(-1)).toEqual(sent.message);
    expect(await fighter.socket.timeout(1000).emitWithAck("requestChatHistory")).toEqual({ ok: true, messages: [sent.message] });
  }, 20000);

  it("clears viewport and room membership when authentication releases or replaces a character", async () => {
    const { identity, connect, flush, lifecycle, game } = await setup();
    const sender = await identity("sender");
    const old = await identity("returning");
    old.socket.emit("updateChatViewport", { width: 1600, height: 900 });
    await flush();
    const replacement = await connect();
    const disconnected = once(old.socket, "disconnect");
    expect(await replacement.timeout(1500).emitWithAck("authenticate", { sessionToken: old.token })).toMatchObject({ ok: true });
    await disconnected;
    const messages: ChatMessage[] = [];
    replacement.on("chatMessage", (message) => messages.push(message));
    expect(await sender.socket.timeout(1000).emitWithAck("sendChatMessage", { channel: "nearby", text: "Requires new viewport" })).toMatchObject({ ok: true });
    await flush();
    expect(messages).toEqual([]);
    const current = await lifecycle.getCharacter(old.accountId);
    vi.spyOn(lifecycle, "getCharacter").mockResolvedValueOnce({ ...current!, deletionEffectiveAt: new Date("2099-01-01T00:00:00.000Z") });
    expect(await replacement.timeout(1500).emitWithAck("authenticate", { sessionToken: old.token })).toMatchObject({ ok: false, code: "CHARACTER_REQUIRED" });
    expect(await replacement.timeout(1000).emitWithAck("requestChatHistory")).toMatchObject({ ok: false, code: "AUTHENTICATION_REQUIRED" });
    expect(game.services.world.getPlayer(old.characterId)).toBeUndefined();
    const global = await identity("globalvoice");
    expect(await global.socket.timeout(1000).emitWithAck("sendChatMessage", { channel: "global", text: "Only authenticated listeners" })).toMatchObject({ ok: true });
    await flush();
    expect(messages).toEqual([]);
    expect(old.messages).toEqual([]);
  }, 20000);
});
