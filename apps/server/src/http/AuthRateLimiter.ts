export class AuthRateLimiter {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit = 8,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now
  ) {}

  consume(key: string): boolean {
    const now = this.now();
    const existing = this.attempts.get(key);
    if (!existing || existing.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (existing.count >= this.limit) return false;
    existing.count += 1;
    return true;
  }
}
