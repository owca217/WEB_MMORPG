import { randomUUID } from "node:crypto";
import type { LoginResult, LocationId, PlayerId } from "@web-mmorpg/shared";

export interface SessionRecord {
  playerId: PlayerId;
  nickname: string;
  locationId: LocationId;
}

export class SessionStore {
  private readonly sessions = new Map<PlayerId, SessionRecord>();

  login(nicknameInput: string): LoginResult {
    const nickname = nicknameInput.trim();

    if (nickname.length < 3 || nickname.length > 20) {
      return {
        ok: false,
        code: "INVALID_NICKNAME",
        message: "Nickname must be 3-20 characters."
      };
    }

    const duplicate = [...this.sessions.values()].some(
      (session) => session.nickname.toLowerCase() === nickname.toLowerCase()
    );

    if (duplicate) {
      return {
        ok: false,
        code: "NICKNAME_IN_USE",
        message: "Nickname is already active."
      };
    }

    const playerId = randomUUID();
    const locationId: LocationId = "forest-settlement-01";

    this.sessions.set(playerId, { playerId, nickname, locationId });

    return { ok: true, playerId, locationId };
  }

  get(playerId: PlayerId): SessionRecord | undefined {
    return this.sessions.get(playerId);
  }

  remove(playerId: PlayerId): void {
    this.sessions.delete(playerId);
  }
}
