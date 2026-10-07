import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bagSlotClickAction,
  containerSlotIcon
} from "../src/ui/bagSlotInteraction";
import { TimedNotice } from "../src/ui/TimedNotice";

describe("bag slot interaction", () => {
  it("shows the requested notice instead of opening inventory for an empty slot", () => {
    expect(bagSlotClickAction(null, null)).toEqual({
      type: "empty",
      message: "ten slot jest pusty."
    });
  });

  it("opens the equipped bag stored in the clicked slot", () => {
    expect(bagSlotClickAction("bag-40", "bag")).toEqual({
      type: "open-bag",
      containerInstanceId: "bag-40"
    });
  });

  it("treats a non-bag item as an empty bag slot", () => {
    expect(bagSlotClickAction("sword-1", "weapon")).toMatchObject({
      type: "empty",
      message: "ten slot jest pusty."
    });
  });

  it("uses a grey backpack icon for empty slots", () => {
    expect(containerSlotIcon(null)).toContain('stroke="#a0a0a0"');
    expect(containerSlotIcon(null)).toContain("<svg");
  });

  it("keeps the equipped bag icon when a bag is present", () => {
    expect(containerSlotIcon("bag")).toBe("🎒");
  });
});

describe("timed notice", () => {
  afterEach(() => vi.useRealTimers());

  it("shows a message for three seconds and then hides it", () => {
    vi.useFakeTimers();
    const target = { textContent: "", hidden: true };
    const notice = new TimedNotice(target);

    notice.show("ten slot jest pusty.");
    expect(target).toMatchObject({ textContent: "ten slot jest pusty.", hidden: false });

    vi.advanceTimersByTime(2999);
    expect(target.hidden).toBe(false);

    vi.advanceTimersByTime(1);
    expect(target.hidden).toBe(true);
  });

  it("restarts the timeout when another message is shown", () => {
    vi.useFakeTimers();
    const target = { textContent: "", hidden: true };
    const notice = new TimedNotice(target);

    notice.show("pierwszy");
    vi.advanceTimersByTime(2000);
    notice.show("drugi");
    vi.advanceTimersByTime(2000);

    expect(target).toMatchObject({ textContent: "drugi", hidden: false });
    vi.advanceTimersByTime(1000);
    expect(target.hidden).toBe(true);
  });

  it("cancels the pending timeout when the HUD is destroyed", () => {
    vi.useFakeTimers();
    const target = { textContent: "", hidden: true };
    const notice = new TimedNotice(target);

    notice.show("ten slot jest pusty.");
    notice.destroy();
    vi.advanceTimersByTime(3000);

    expect(target).toMatchObject({ textContent: "", hidden: true });
  });
});
