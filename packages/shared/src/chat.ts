import type { LocationId, PlayerId } from "./ids";

export const CHAT_MAX_MESSAGE_LENGTH = 300;
export type ChatChannel = "nearby" | "global";

export interface ChatMessage {
  id: string;
  channel: ChatChannel;
  senderId: PlayerId;
  senderName: string;
  text: string;
  sentAt: number;
  locationId?: LocationId;
  worldPosition?: { x: number; y: number };
}

export interface ChatViewport {
  /** Width and height of the visible camera area in world units. */
  width: number;
  height: number;
}

export type ChatSendResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; code: string; message: string };

export type ChatHistoryResult =
  | { ok: true; messages: ChatMessage[] }
  | { ok: false; code: string; message: string };
