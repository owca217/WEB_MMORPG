interface RateEntry {
  startedAt: number;
  count: number;
}

export interface AuthRateLimiterConfig {
  limit: number;
  windowMs: number;
}

export class AuthRateLimiter {
  private readonly entries = new Map<string, RateEntry>();

  constructor(
    private readonly config: AuthRateLimiterConfig = {
      limit: 5,
      windowMs: 60_000
    }
  ) {}

  consume(key: string, now = Date.now()): boolean {
    const current = this.entries.get(key);

    if (!current || now - current.startedAt >= this.config.windowMs) {
      this.entries.set(key, { startedAt: now, count: 1 });
      return true;
    }

    if (current.count >= this.config.limit) return false;

    current.count += 1;
    return true;
  }
}
