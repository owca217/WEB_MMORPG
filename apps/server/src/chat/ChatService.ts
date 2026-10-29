import { randomUUID } from "node:crypto";
import { CHAT_MAX_MESSAGE_LENGTH, type ChatMessage, type ChatSendResult, type ChatViewport } from "@web-mmorpg/shared";
import type { WorldService } from "../world/WorldService";
import { FOREST_SETTLEMENT_01, getWorldFixture } from "../world/worldFixtures";

const HISTORY_LIMIT = 50;
const MIN_MESSAGE_INTERVAL = 1000;
const RATE_WINDOW = 10000;
const MAX_MESSAGES_PER_WINDOW = 5;
const MAX_TRACKED_SENDERS = 4096;

const reject = (code: string, message: string): ChatSendResult => ({ ok: false, code, message });

export class ChatService {
  private readonly viewports = new Map<string, ChatViewport>();
  private readonly sentTimes = new Map<string, number[]>();
  private readonly history: ChatMessage[] = [];

  constructor(
    private readonly world: WorldService,
    private readonly hasBattle: (playerId: string) => boolean
  ) {}

  sendMessage(playerId: string, payload: unknown, now = Date.now()): ChatSendResult {
    const player = this.world.getPlayer(playerId);
    const locationId = this.world.getPlayerLocationId(playerId);
    if (!player || !locationId) return reject("AUTHENTICATION_REQUIRED", "Zaloguj się, aby korzystać z czatu.");
    if (!payload || typeof payload !== "object") return reject("INVALID_CHAT_MESSAGE", "Nieprawidłowa wiadomość.");
    const { channel, text: rawText } = payload as Record<string, unknown>;
    if (channel !== "nearby" && channel !== "global") return reject("INVALID_CHAT_CHANNEL", "Wybierz kanał czatu.");
    if (typeof rawText !== "string") return reject("INVALID_CHAT_MESSAGE", "Nieprawidłowa wiadomość.");
    const text = rawText.trim().replace(/\s+/gu, " ");
    if (text.length === 0) return reject("CHAT_MESSAGE_EMPTY", "Wpisz wiadomość.");
    if (text.length > CHAT_MAX_MESSAGE_LENGTH) return reject("CHAT_MESSAGE_TOO_LONG", `Wiadomość może mieć maksymalnie ${CHAT_MAX_MESSAGE_LENGTH} znaków.`);
    if (channel === "nearby" && this.hasBattle(playerId)) return reject("NEARBY_CHAT_UNAVAILABLE", "Czat w pobliżu jest niedostępny podczas walki. Użyj czatu globalnego.");

    if (!this.sentTimes.has(playerId)) {
      for (const [senderId, timestamps] of this.sentTimes) {
        if (now - timestamps[timestamps.length - 1]! >= RATE_WINDOW) this.sentTimes.delete(senderId);
      }
      // Preserve live rate limits instead of evicting them when new senders arrive.
      if (this.sentTimes.size >= MAX_TRACKED_SENDERS) {
        return reject("CHAT_RATE_LIMITED", "Czat jest chwilowo przeciążony. Spróbuj ponownie za chwilę.");
      }
    }
    const recent = (this.sentTimes.get(playerId) ?? []).filter((sentAt) => now - sentAt < RATE_WINDOW);
    const lastSentAt = recent.at(-1);
    if ((lastSentAt !== undefined && now - lastSentAt < MIN_MESSAGE_INTERVAL) || recent.length >= MAX_MESSAGES_PER_WINDOW) {
      return reject("CHAT_RATE_LIMITED", "Wysyłasz wiadomości zbyt szybko. Poczekaj chwilę.");
    }
    recent.push(now);
    this.sentTimes.set(playerId, recent);

    const message: ChatMessage = {
      id: randomUUID(), channel, senderId: playerId, senderName: player.nickname, text, sentAt: now,
      ...(channel === "nearby" ? { locationId, worldPosition: { x: player.x, y: player.y } } : {})
    };
    if (channel === "global") {
      this.history.push(structuredClone(message));
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
    }
    return { ok: true, message };
  }

  setViewport(playerId: string, viewport: unknown): void {
    if (!viewport || typeof viewport !== "object") return;
    const { width, height } = viewport as Record<string, unknown>;
    if (typeof width !== "number" || typeof height !== "number" ||
      !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    this.viewports.set(playerId, { width, height });
  }

  removePlayer(playerId: string): void {
    this.viewports.delete(playerId);
  }

  nearbyRecipients(message: ChatMessage): string[] {
    if (message.channel !== "nearby" || !message.locationId || !message.worldPosition || this.hasBattle(message.senderId)) return [];
    const position = message.worldPosition;
    const fixture=getWorldFixture(message.locationId)??FOREST_SETTLEMENT_01;
    return this.world.snapshot(message.locationId).players.filter((recipient) => {
      if (this.hasBattle(recipient.id)) return false;
      if (recipient.id === message.senderId) return true;
      const viewport = this.viewports.get(recipient.id);
      if (!viewport) return false;
      const width=Math.min(viewport.width,fixture.width),height=Math.min(viewport.height,fixture.height);
      const left = Math.max(0, Math.min(fixture.width - width, recipient.x - width / 2));
      const top = Math.max(0, Math.min(fixture.height - height, recipient.y - height / 2));
      return position.x >= left && position.x <= left + width &&
        position.y >= top && position.y <= top + height;
    }).map((recipient) => recipient.id);
  }

  getHistory(): ChatMessage[] { return structuredClone(this.history); }
}
