import { randomUUID } from "node:crypto";
import type { LoginResult, LocationId, PlayerId, UserRole } from "@web-mmorpg/shared";

export interface SessionRecord {
  playerId: PlayerId;
  nickname: string;
  locationId: LocationId;
  sessionToken: string;
  role: UserRole;
}

export class SessionStore {
  private readonly sessions = new Map<PlayerId, SessionRecord>();
  private readonly sessionTokens = new Map<string, PlayerId>();

  login(nicknameInput: string, adminToken?: string): LoginResult {
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
    const sessionToken = randomUUID();
    const locationId: LocationId = "forest-settlement-01";
    const configuredAdminToken = process.env.ADMIN_ACCESS_TOKEN;
    const role: UserRole =
      configuredAdminToken !== undefined &&
      configuredAdminToken.length > 0 &&
      adminToken === configuredAdminToken
        ? "ADMIN"
        : "PLAYER";

    const session: SessionRecord = {
      playerId,
      nickname,
      locationId,
      sessionToken,
      role
    };

    this.sessions.set(playerId, session);
    this.sessionTokens.set(sessionToken, playerId);

    return { ok: true, playerId, locationId, sessionToken, role };
  }

  get(playerId: PlayerId): SessionRecord | undefined {
    return this.sessions.get(playerId);
  }

  getByToken(sessionToken: string): SessionRecord | undefined {
    const playerId = this.sessionTokens.get(sessionToken);
    return playerId ? this.sessions.get(playerId) : undefined;
  }

  remove(playerId: PlayerId): void {
    const session = this.sessions.get(playerId);
    if (session) this.sessionTokens.delete(session.sessionToken);
    this.sessions.delete(playerId);
  }
}
