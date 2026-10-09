import type { SessionRecord, SessionStore } from "../session/SessionStore";

export class AdminAuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    public readonly code: "ADMIN_AUTH_REQUIRED" | "ADMIN_FORBIDDEN"
  ) {
    super(code);
    this.name = "AdminAuthError";
  }
}

export function requireAdminSession(
  sessions: SessionStore,
  authorizationHeader: string | undefined
): SessionRecord {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new AdminAuthError(401, "ADMIN_AUTH_REQUIRED");
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new AdminAuthError(401, "ADMIN_AUTH_REQUIRED");
  }

  const session = sessions.getByToken(token);
  if (!session) {
    throw new AdminAuthError(401, "ADMIN_AUTH_REQUIRED");
  }

  if (session.role !== "ADMIN") {
    throw new AdminAuthError(403, "ADMIN_FORBIDDEN");
  }

  return session;
}
