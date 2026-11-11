import { createSign, generateKeyPairSync } from "node:crypto";
import { OAuth2Client } from "google-auth-library";
import { describe, expect, it, vi } from "vitest";
import { GoogleIdentityVerifier } from "../src/auth/GoogleIdentityVerifier";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const audience = "test.apps.googleusercontent.com";
function signedToken(overrides: Record<string, unknown> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: "https://accounts.google.com", aud: audience, sub: "123456789", nonce: "server-nonce", iat: now - 10, exp: now + 300, ...overrides })).toString("base64url");
  const message = `${header}.${payload}`;
  return `${message}.${createSign("RSA-SHA256").update(message).sign(keys.privateKey).toString("base64url")}`;
}
function verifier(): GoogleIdentityVerifier {
  const client = new OAuth2Client();
  // Replace certificate transport only; Google's real signature/issuer/audience/expiry verifier still runs.
  vi.spyOn(client, "getFederatedSignonCertsAsync").mockResolvedValue({
    certs: { test: keys.publicKey.export({ format: "pem", type: "spki" }).toString() },
    format: "PEM"
  } as Awaited<ReturnType<OAuth2Client["getFederatedSignonCertsAsync"]>>);
  return new GoogleIdentityVerifier(client);
}
describe("Google ID token validation", () => {
  it("returns only stable subject and signed nonce from a verified identity", async () => {
    await expect(verifier().verify(signedToken({ email: "private@example.org", name: "Private Name" }), audience)).resolves.toEqual({ subject: "123456789", nonce: "server-nonce" });
  });
  it.each([
    { aud: "other.apps.googleusercontent.com" },
    { iss: "https://attacker.invalid" },
    { iat: 100, exp: 200 },
    { exp: Math.floor(Date.now() / 1000) - 10 },
    { nonce: undefined }
  ])("rejects invalid claims without exposing token/profile data", async claims => {
    await expect(verifier().verify(signedToken(claims), audience)).rejects.toMatchObject({ code: "GOOGLE_INVALID_TOKEN", status: 401 });
  });
  it("rejects a forged signature", async () => {
    const parts = signedToken().split(".");
    const signature = parts[2]!;
    parts[2] = (signature[0] === "a" ? "b" : "a") + signature.slice(1);
    await expect(verifier().verify(parts.join("."), audience)).rejects.toMatchObject({ code: "GOOGLE_INVALID_TOKEN" });
  });
});
