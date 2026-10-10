import { describe, expect, it } from "vitest";
import { getDeletionCountdown } from "../src/state/characterDeletionCountdown";

describe("character deletion countdown", () => {
  it("formats the remaining 24-hour window deterministically", () => {
    const now = Date.parse("2026-09-18T10:00:00.000Z");
    const target = "2026-09-19T12:03:04.000Z";

    expect(getDeletionCountdown(target, now)).toEqual({
      expired: false,
      days: 1,
      hours: 2,
      minutes: 3,
      seconds: 4,
      label: "1d 02:03:04"
    });
  });

  it("does not return negative time after expiry", () => {
    const now = Date.parse("2026-09-20T10:00:00.000Z");
    const target = "2026-09-19T10:00:00.000Z";

    expect(getDeletionCountdown(target, now)).toEqual({
      expired: true,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      label: "0d 00:00:00"
    });
  });
});
