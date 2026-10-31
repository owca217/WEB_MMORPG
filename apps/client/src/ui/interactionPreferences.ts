export interface WorldPointerEvent {
  button?: number;
  pointerType?: string;
}

/** Structural subset shared by Phaser pointers and DOM-oriented interaction tests. */
export interface WorldInteractionPointer {
  wasTouch?: boolean;
  button?: number;
  event?: object;
  rightButtonDown?: () => boolean;
  rightButtonReleased?: () => boolean;
}

const PREFERENCE_KEY = "web-mmorpg:desktop-right-click-interactions";
let memoryPreference = true;
let memoryOnly = false;

export function readRightClickInteractions(): boolean {
  if (memoryOnly) return memoryPreference;
  try {
    const storage = globalThis.localStorage;
    return storage ? storage.getItem(PREFERENCE_KEY) !== "false" : memoryPreference;
  } catch { return memoryPreference; }
}

export function setRightClickInteractions(enabled: boolean): void {
  memoryPreference = enabled;
  try {
    const storage = globalThis.localStorage;
    memoryOnly = !storage;
    storage?.setItem(PREFERENCE_KEY, String(enabled));
  } catch { memoryOnly = true; }
}

function pointerButton(pointer?: WorldInteractionPointer, event?: WorldPointerEvent): number {
  const underlying = pointer?.event as WorldPointerEvent | undefined;
  return event?.button ?? underlying?.button ?? pointer?.button
    ?? (pointer?.rightButtonDown?.() || pointer?.rightButtonReleased?.() ? 2 : 0);
}

export function isPrimaryMovementPointer(pointer?: WorldInteractionPointer, event?: WorldPointerEvent): boolean {
  return pointerButton(pointer, event) === 0;
}

export function shouldInteractWithPointer(pointer?: WorldInteractionPointer, event?: WorldPointerEvent): boolean {
  const button = pointerButton(pointer, event);
  if (button === 2) return true;
  if (button !== 0) return false;
  const underlying = pointer?.event as WorldPointerEvent | undefined;
  const pointerType = event?.pointerType ?? underlying?.pointerType;
  return pointer?.wasTouch === true || pointerType === "touch" || pointerType === "pen" || !readRightClickInteractions();
}
