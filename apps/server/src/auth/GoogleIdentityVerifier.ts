import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { AuthError } from "./AuthService";

export interface GoogleIdentity { subject: string; nonce: string }
export interface GoogleTokenVerifier {
  verify(idToken: string, audience: string): Promise<GoogleIdentity>;
}

/** Google rotates its signing keys; the official client handles certificate caching and validation. */
export class GoogleIdentityVerifier implements GoogleTokenVerifier {
  constructor(private readonly client = new OAuth2Client()) {}

  async verify(idToken: string, audience: string): Promise<GoogleIdentity> {
    try {
      if (!idToken || idToken.length > 16_384) throw new Error("Invalid token length");
      const ticket = await this.client.verifyIdToken({ idToken, audience });
      const payload = ticket.getPayload() as (TokenPayload & { nonce?: unknown }) | undefined;
      if (!payload?.sub || payload.sub.length > 255 || !payload.exp || payload.exp * 1000 <= Date.now() || typeof payload.nonce !== "string" || !payload.nonce || payload.nonce.length > 512) {
        throw new Error("Missing identity or nonce");
      }
      return { subject: payload.sub, nonce: payload.nonce };
    } catch {
      throw new AuthError("GOOGLE_INVALID_TOKEN", 401, "Nie udało się potwierdzić konta Google. Spróbuj ponownie.");
    }
  }
}
