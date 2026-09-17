import argon2 from "argon2";

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function validateUsername(
  input: string
): { ok: true; normalized: string } | { ok: false; code: string } {
  const normalized = normalizeUsername(input);

  if (!/^[a-z0-9_-]{3,32}$/.test(normalized)) {
    return { ok: false, code: "INVALID_USERNAME" };
  }

  return { ok: true, normalized };
}

export function validatePassword(password: string): boolean {
  return password.length >= 10 && password.length <= 256;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}
