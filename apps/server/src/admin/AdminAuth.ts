import { AuthError, type AuthService } from "../auth/AuthService";

export interface AdminSession {
  accountId: string;
  sessionId: string;
  role: "ADMIN";
}

export class AdminAuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    public readonly code: "ADMIN_AUTH_REQUIRED" | "ADMIN_FORBIDDEN"
  ) {
    super(code);
    this.name = "AdminAuthError";
  }
}

export async function requireAdminSession(
  authService: AuthService,
  authorizationHeader: string | undefined
): Promise<AdminSession> {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    throw new AdminAuthError(401, "ADMIN_AUTH_REQUIRED");
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new AdminAuthError(401, "ADMIN_AUTH_REQUIRED");
  }

  try {
    const validated = await authService.validateToken(token);
    if (!validated) {
      throw new AdminAuthError(401, "ADMIN_AUTH_REQUIRED");
    }
    if (validated.account.role !== "ADMIN") {
      throw new AdminAuthError(403, "ADMIN_FORBIDDEN");
    }
    return {
      accountId: validated.account.id,
      sessionId: validated.session.id,
      role: "ADMIN"
    };
  } catch (error) {
    if (error instanceof AdminAuthError) throw error;
    if (error instanceof AuthError && error.status === 403) {
      throw new AdminAuthError(403, "ADMIN_FORBIDDEN");
    }
    throw error;
  }
}
