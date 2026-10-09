import type { AccountRole } from "@web-mmorpg/shared";
import { AuthError, type AuthService } from "./AuthService";

export interface AuthContext {
  accountId: string;
  sessionId: string;
  role: AccountRole;
  characterId?: string;
}

export function bearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader?.startsWith("Bearer ")) return null;
  const token = authorizationHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export async function requireAuthContext(
  authService: AuthService,
  authorizationHeader: string | undefined
): Promise<AuthContext> {
  const token = bearerToken(authorizationHeader);
  if (!token) {
    throw new AuthError("UNAUTHORIZED", 401, "Authentication is required.");
  }

  const validated = await authService.validateToken(token);
  if (!validated) {
    throw new AuthError("UNAUTHORIZED", 401, "Authentication is required.");
  }

  const character = validated.view.character;
  return {
    accountId: validated.account.id,
    sessionId: validated.session.id,
    role: validated.account.role,
    ...(character.state === "none" ? {} : { characterId: character.characterId })
  };
}
