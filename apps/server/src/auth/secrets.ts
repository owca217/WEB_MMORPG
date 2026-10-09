import { createHash, randomBytes } from "node:crypto";

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function generateRecoveryCode(): string {
  return randomBytes(14)
    .toString("hex")
    .toUpperCase()
    .match(/.{4}/g)!
    .join("-");
}

export function hashOpaqueSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}
