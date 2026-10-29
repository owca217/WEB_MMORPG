import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { SocketAuthResult } from "@web-mmorpg/shared";
import { Server, type Socket } from "socket.io";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GameSocket, type ConnectionState } from "../src/net/GameSocket";
import { chatStateStore } from "../src/state/ChatStateStore";
import { socialStateStore } from "../src/state/SocialStateStore";

const authenticated: SocketAuthResult = {
  ok: true, characterId: "character-1", locationId: "forest-settlement-01"
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let http: HttpServer | undefined;
let server: Server | undefined;
let client: GameSocket | undefined;

async function startServer(
  authenticate: (token: string, ack: (result: SocketAuthResult) => void, socket: Socket) => void
) {
  http = createServer();
  server = new Server(http);
  server.on("connection", (socket) => {
    socket.on("authenticate", ({ sessionToken }, ack) => authenticate(sessionToken, ack, socket));
  });
  await new Promise<void>((resolve) => http!.listen(0, "127.0.0.1", resolve));
  vi.stubEnv("VITE_GAME_SERVER_URL", `http://127.0.0.1:${(http.address() as AddressInfo).port}`);
  client = new GameSocket();
  return client;
}

afterEach(async () => {
  client?.disconnect();
  vi.useRealTimers();
  await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve());
  if (http?.listening) await new Promise<void>((resolve) => http!.close(() => resolve()));
  vi.unstubAllEnvs();
  client = undefined;
  server = undefined;
  http = undefined;
});

describe("GameSocket authentication lifecycle", () => {
  it("requests a merchant shop, forwards receipt IDs and rejects purchase ACKs from a replaced session",async()=>{
    const shop={npcId:"merchant-miro",npcName:"Miro",gold:100,offers:[]};
    const pending=deferred<(result:unknown)=>void>();
    const game=await startServer((_token,ack,socket)=>{
      socket.on("requestMerchantShop",(payload,reply)=>{expect(payload).toEqual({npcId:shop.npcId});reply({ok:true,shop});});
      socket.on("purchaseMerchantItem",(payload,reply)=>{expect(payload.requestId).toBe("purchase-1");pending.resolve(reply);});
      ack(authenticated);
    });
    await game.authenticate("merchant-token");
    expect(await game.requestMerchantShop(shop.npcId)).toEqual({ok:true,shop});
    const purchase=game.purchaseMerchantItem({npcId:shop.npcId,requestId:"purchase-1",itemId:"rag-bag",quantity:1});
    const reply=await pending.promise;await game.authenticate("replacement-token");reply({ok:true,shop});
    expect(await purchase).toMatchObject({ok:false,code:"SESSION_REPLACED"});
  });
  it("applies authenticated social acknowledgements and ignores stale or foreign state pushes",async()=>{
    const initial={revision:2,selfId:"character-1",onlinePlayers:[],friends:[],incomingFriendRequests:[],outgoingFriendRequests:[],party:null,partyInvites:[],trade:null};
    const game=await startServer((_token,ack,socket)=>{
      socket.on("requestSocialState",reply=>reply({ok:true,social:initial}));
      socket.on("socialAction",(payload,reply)=>{
        expect(payload).toEqual({type:"requestFriend",nickname:"Alicja"});
        reply({ok:true,social:{...initial,revision:3}});
      });ack(authenticated);
    });
    await game.authenticate("social-token");await game.requestSocialState();
    expect(socialStateStore.get()?.revision).toBe(2);
    await game.socialAction({type:"requestFriend",nickname:"Alicja"});
    server!.emit("socialState",{...initial,revision:1});server!.emit("socialState",{...initial,selfId:"another-account",revision:99});
    await game.requestSocialState();
    expect(socialStateStore.get()?.selfId).toBe("character-1");expect(socialStateStore.get()?.revision).toBe(3);
    game.disconnect();expect(socialStateStore.get()).toBeNull();
  });
  it("ignores queued chat pushes while switching authenticated accounts", async () => {
    const game=await startServer((token,ack,socket)=>{
      if(token==="replacement-chat-account") socket.emit("chatMessage",{id:"old-push",channel:"nearby",senderId:"old",senderName:"Old",text:"Old vicinity",sentAt:1});
      ack(authenticated);
    });
    await game.authenticate("original-chat-account");
    const onMessage=vi.fn(); const stop=game.onChatMessage(onMessage);
    await game.authenticate("replacement-chat-account");
    expect(chatStateStore.get()).toEqual([]);
    expect(onMessage).not.toHaveBeenCalled(); stop();
  });
  it("merges global history, live chat and send acknowledgements once and clears transcript on logout", async () => {
    const oldMessage={id:"history",channel:"global",senderId:"other",senderName:"Other",text:"Witaj",sentAt:1};
    const sentMessage={...oldMessage,id:"live",senderId:"character-1",text:"Test",sentAt:2};
    const game=await startServer((_token,ack,socket)=>{
      socket.on("requestChatHistory",reply=>reply({ok:true,messages:[oldMessage]}));
      socket.on("sendChatMessage",(payload,reply)=>{
        expect(payload).toEqual({channel:"global",text:"Test"});
        socket.emit("chatMessage",sentMessage); reply({ok:true,message:sentMessage});
      });
      ack(authenticated);
    });
    await game.authenticate("chat-token");
    await game.requestChatHistory();
    const onMessage=vi.fn(); const stop=game.onChatMessage(onMessage);
    expect(await game.sendChatMessage("global","Test")).toMatchObject({ok:true});
    expect(chatStateStore.get().map(message=>message.id)).toEqual(["history","live"]);
    expect(onMessage).toHaveBeenCalledTimes(1);
    stop(); game.disconnect(); expect(chatStateStore.get()).toEqual([]);
  });

  it("discards history acknowledgements from a replaced authentication", async () => {
    const reply=deferred<(value:unknown)=>void>();
    const game=await startServer((_token,ack,socket)=>{
      socket.removeAllListeners("requestChatHistory");
      socket.on("requestChatHistory",ackHistory=>reply.resolve(ackHistory));
      ack(authenticated);
    });
    await game.authenticate("old-chat-account");
    const history=game.requestChatHistory(); const finish=await reply.promise;
    await game.authenticate("new-chat-account");
    finish({ok:true,messages:[{id:"private-old",channel:"global",senderId:"old",senderName:"Old",text:"Old",sentAt:1}]});
    expect(await history).toMatchObject({ok:false,code:"SESSION_REPLACED"});
    expect(chatStateStore.get()).toEqual([]);
  });
  it("sends only a container slot and instance ID and returns the server's assignment or rejection", async () => {
    const payloads: unknown[] = [];
    const game = await startServer((_token, ack, socket) => {
      socket.on("setContainerSlot", (payload, reply) => {
        payloads.push(payload);
        reply(payload.itemInstanceId === "foreign-item"
          ? { ok: false, code: "CONTAINER_ITEM_NOT_OWNED", message: "Nie posiadasz tego pojemnika." }
          : { ok: true, inventory: { items: [], containerSlots: [null, payload.itemInstanceId, null, null] } });
      });
      ack(authenticated);
    });
    await game.authenticate("session-token");
    expect(await game.setContainerSlot(1, "chest-2")).toEqual({
      ok: true, inventory: { items: [], containerSlots: [null, "chest-2", null, null] }
    });
    expect(await game.setContainerSlot(1, "foreign-item")).toMatchObject({ ok: false, code: "CONTAINER_ITEM_NOT_OWNED" });
    expect(payloads).toEqual([
      { slotIndex: 1, itemInstanceId: "chest-2" }, { slotIndex: 1, itemInstanceId: "foreign-item" }
    ]);
  });

  it("returns a usable rejection when a container acknowledgement times out", async () => {
    const game = await startServer((_token, ack) => ack(authenticated));
    await game.authenticate("session-token");
    vi.spyOn(game.connect(), "emitWithAck").mockRejectedValueOnce(new Error("Ack timeout"));
    expect(await game.setContainerSlot(0, null)).toMatchObject({ ok: false, code: "CONTAINER_SLOT_UPDATE_FAILED" });
  });

  it("authenticates an initial connection once without publishing a reconnect", async () => {
    const tokens: string[] = [];
    const game = await startServer((token, ack) => {
      tokens.push(token);
      ack(authenticated);
    });
    const reauthenticated = vi.fn();
    game.onReauthenticated(reauthenticated);

    expect(await game.authenticate("session-token")).toEqual(authenticated);
    expect(tokens).toEqual(["session-token"]);
    expect(reauthenticated).not.toHaveBeenCalled();
  });

  it("restores gameplay authentication before reporting a reconnected transport as connected", async () => {
    const reconnectAuth = deferred<{ token: string; ack: (result: SocketAuthResult) => void }>();
    let firstSocket!: Socket;
    let attempts = 0;
    const game = await startServer((token, ack, socket) => {
      attempts += 1;
      if (attempts === 1) {
        firstSocket = socket;
        ack(authenticated);
      } else {
        reconnectAuth.resolve({ token, ack });
        socket.on("requestWorldState", () => socket.emit("worldState", { marker: "fresh-world" }));
        socket.on("requestPlayerState", () => socket.emit("playerState", { marker: "fresh-player" }));
      }
    });
    const states: ConnectionState[] = [];
    const restored = deferred<SocketAuthResult>();
    game.onConnectionState((state) => states.push(state));
    game.onReauthenticated(restored.resolve);
    const world = deferred<unknown>();
    const player = deferred<unknown>();
    game.onWorldState(world.resolve);
    game.onPlayerState(player.resolve);
    await game.authenticate("session-token");
    states.length = 0;
    firstSocket.conn.close();

    const pending = await reconnectAuth.promise;
    expect(pending.token).toBe("session-token");
    expect(states.at(-1)).toBe("connecting");
    expect(states).not.toContain("connected");
    pending.ack(authenticated);

    expect(await restored.promise).toEqual(authenticated);
    expect(states.at(-1)).toBe("connected");
    expect(await world.promise).toEqual({ marker: "fresh-world" });
    expect(await player.promise).toEqual({ marker: "fresh-player" });
  });

  it("publishes rejected reconnect authentication and stops the transport", async () => {
    let firstSocket!: Socket;
    let attempts = 0;
    const rejected: SocketAuthResult = { ok: false, code: "INVALID_SESSION", message: "Expired" };
    const game = await startServer((_token, ack, socket) => {
      attempts += 1;
      if (attempts === 1) {
        firstSocket = socket;
        ack(authenticated);
      } else ack(rejected);
    });
    const restored = deferred<SocketAuthResult>();
    let state: ConnectionState = "connecting";
    game.onReauthenticated(restored.resolve);
    game.onConnectionState((next) => { state = next; });
    await game.authenticate("session-token");
    firstSocket.conn.close();

    expect(await restored.promise).toEqual(rejected);
    expect(state).toBe("disconnected");
    expect(game.connect().connected).toBe(false);
  });

  it("bounds an unanswered authentication request instead of leaving boot waiting forever", async () => {
    const received = deferred<void>();
    const game = await startServer(() => received.resolve());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await new Promise<void>((resolve) => game.connect().once("connect", resolve));
    const result = game.authenticate("session-token");
    await received.promise;
    await vi.advanceTimersByTimeAsync(15_000);

    expect(await result).toMatchObject({ ok: false, code: "AUTHENTICATION_FAILED" });
  });

  it("ignores authentication left pending on a deliberately discarded socket", async () => {
    const pending = deferred<void>();
    let attempts = 0;
    const game = await startServer((_token, ack) => {
      attempts += 1;
      if (attempts === 1) pending.resolve();
      else ack(authenticated);
    });
    const stale = game.authenticate("old-token");
    await pending.promise;
    game.disconnect();
    const states: ConnectionState[] = [];
    const restored = vi.fn();
    game.onConnectionState((state) => states.push(state));
    game.onReauthenticated(restored);

    expect(await game.authenticate("new-token")).toEqual(authenticated);
    expect(await stale).toMatchObject({ ok: false, code: "AUTHENTICATION_FAILED" });
    expect(states.at(-1)).toBe("connected");
    expect(restored).not.toHaveBeenCalled();
  });
});
