import { describe, expect, it } from "vitest";
import { AuthRateLimiter } from "../src/http/AuthRateLimiter";

describe("AuthRateLimiter", () => {
  it("allows five attempts per minute and rejects the sixth", () => {
    const limiter = new AuthRateLimiter({ limit: 5, windowMs: 60_000 });
    for (let i = 0; i < 5; i += 1) {
      expect(limiter.consume("127.0.0.1", 0)).toBe(true);
    }
    expect(limiter.consume("127.0.0.1", 0)).toBe(false);
    expect(limiter.consume("127.0.0.1", 60_001)).toBe(true);
  });
});
