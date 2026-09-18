export function normalizeNickname(input: string): string {
  return input.trim().toLowerCase();
}

export function validateNickname(
  input: string
):
  | { ok: true; normalized: string; display: string }
  | { ok: false; code: string } {
  const display = input.trim();
  const normalized = normalizeNickname(display);

  if (
    display.length < 3
    || display.length > 20
    || !/^[\p{L}\p{N}_-]+$/u.test(display)
  ) {
    return { ok: false, code: "INVALID_NICKNAME" };
  }

  return { ok: true, normalized, display };
}
