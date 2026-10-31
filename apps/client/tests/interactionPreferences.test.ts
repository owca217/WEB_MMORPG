/* @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isPrimaryMovementPointer, readRightClickInteractions, setRightClickInteractions, shouldInteractWithPointer } from "../src/ui/interactionPreferences";

beforeEach(() => { localStorage.clear(); setRightClickInteractions(true); });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); setRightClickInteractions(true); });

it("defaults desktop interaction to the secondary button while reserving only primary clicks for movement", () => {
  localStorage.clear();expect(readRightClickInteractions()).toBe(true);
  expect(shouldInteractWithPointer({button:0})).toBe(false);
  expect(shouldInteractWithPointer({button:2})).toBe(true);
  expect(shouldInteractWithPointer({button:1})).toBe(false);
  expect(isPrimaryMovementPointer({button:0})).toBe(true);
  expect(isPrimaryMovementPointer({button:2})).toBe(false);
  expect(isPrimaryMovementPointer({button:1})).toBe(false);
});

it("persists opt-out and restores primary entity clicks without ever enabling secondary movement", () => {
  setRightClickInteractions(false);expect(readRightClickInteractions()).toBe(false);
  expect(shouldInteractWithPointer({button:0})).toBe(true);expect(shouldInteractWithPointer({button:2})).toBe(true);
  expect(isPrimaryMovementPointer({button:2})).toBe(false);
  setRightClickInteractions(true);expect(shouldInteractWithPointer({button:0})).toBe(false);
});

it("retains touch and pen taps across desktop preferences and reads underlying pointer events", () => {
  expect(shouldInteractWithPointer({wasTouch:true,button:0})).toBe(true);
  expect(shouldInteractWithPointer({event:{pointerType:"touch",button:0}})).toBe(true);
  expect(shouldInteractWithPointer({}, {pointerType:"pen",button:0})).toBe(true);
  expect(isPrimaryMovementPointer({wasTouch:true,button:0})).toBe(true);
  expect(isPrimaryMovementPointer({event:{button:2}})).toBe(false);
  expect(isPrimaryMovementPointer({rightButtonDown:()=>true})).toBe(false);
  expect(shouldInteractWithPointer({rightButtonReleased:()=>true})).toBe(true);
  expect(isPrimaryMovementPointer({rightButtonReleased:()=>true}, {button:0})).toBe(true);
  setRightClickInteractions(false);expect(shouldInteractWithPointer({wasTouch:true,button:0})).toBe(true);
});

it("keeps the setting usable when browser storage is blocked", () => {
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("blocked");});
  expect(()=>setRightClickInteractions(false)).not.toThrow();
  expect(readRightClickInteractions()).toBe(false);expect(shouldInteractWithPointer({button:0})).toBe(true);
});
