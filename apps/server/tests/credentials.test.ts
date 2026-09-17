import { describe, expect, it } from "vitest";
import {
  hashPassword,
  normalizeUsername,
  validatePassword,
  validateUsername,
  verifyPassword
} from "../src/auth/credentials";
import {
  generateRecoveryCode,
  generateSessionToken,
  hashOpaqueSecret
} from "../src/auth/secrets";

describe("account credentials", () => {
  it("normalizes usernames and rejects invalid characters", () => {
    expect(normalizeUsername("  Owczy_217 ")).toBe("owczy_217");
    expect(validateUsername("Owczy-217")).toEqual({ ok: true, normalized: "owczy-217" });
    expect(validateUsername("ow czy")).toMatchObject({ ok: false });
  });

  it("requires passwords between 10 and 256 characters", () => {
    expect(validatePassword("short")).toBe(false);
    expect(validatePassword("long enough password")).toBe(true);
    expect(validatePassword("x".repeat(257))).toBe(false);
  });

  it("hashes passwords with Argon2id", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery")).toBe(true);
    expect(await verifyPassword(hash, "wrong password")).toBe(false);
  });

  it("creates high-entropy opaque secrets and deterministic hashes", () => {
    const token = generateSessionToken();
    const code = generateRecoveryCode();
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(code).toMatch(/^[A-F0-9]{4}(?:-[A-F0-9]{4}){6}$/);
    expect(hashOpaqueSecret(token)).toHaveLength(64);
    expect(hashOpaqueSecret(token)).toBe(hashOpaqueSecret(token));
  });
});
