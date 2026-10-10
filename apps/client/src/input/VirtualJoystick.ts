import type { DirectionIntent } from "./WorldInput";
import { normalizeAnalogIntent } from "./WorldInput";

export class VirtualJoystick {
  private readonly root = document.createElement("div");
  private readonly thumb = document.createElement("div");
  private intent: DirectionIntent = { dx: 0, dy: 0 };
  private activePointerId: number | null = null;

  constructor(private readonly radius = 56) {
    this.root.className = "virtual-joystick";
    this.thumb.className = "virtual-joystick__thumb";
    this.root.appendChild(this.thumb);
    document.body.appendChild(this.root);

    this.root.addEventListener("pointerdown", this.handlePointerDown);
    this.root.addEventListener("pointermove", this.handlePointerMove);
    this.root.addEventListener("pointerup", this.handlePointerEnd);
    this.root.addEventListener("pointercancel", this.handlePointerEnd);
  }

  getIntent(): DirectionIntent {
    return this.intent;
  }

  destroy(): void {
    this.root.removeEventListener("pointerdown", this.handlePointerDown);
    this.root.removeEventListener("pointermove", this.handlePointerMove);
    this.root.removeEventListener("pointerup", this.handlePointerEnd);
    this.root.removeEventListener("pointercancel", this.handlePointerEnd);
    this.root.remove();
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.activePointerId !== null) return;
    this.activePointerId = event.pointerId;
    this.root.setPointerCapture(event.pointerId);
    this.updateFromPointer(event);
    event.preventDefault();
    event.stopPropagation();
  };

  private readonly handlePointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    this.updateFromPointer(event);
    event.preventDefault();
  };

  private readonly handlePointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.activePointerId) return;
    if (this.root.hasPointerCapture(event.pointerId)) {
      this.root.releasePointerCapture(event.pointerId);
    }
    this.activePointerId = null;
    this.intent = { dx: 0, dy: 0 };
    this.thumb.style.transform = "translate(0px, 0px)";
    event.preventDefault();
  };

  private updateFromPointer(event: PointerEvent): void {
    const rect = this.root.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const offset = {
      x: event.clientX - centerX,
      y: event.clientY - centerY
    };

    this.intent = normalizeAnalogIntent(offset, this.radius);

    const magnitude = Math.hypot(offset.x, offset.y);
    const clampedMagnitude = Math.min(magnitude, this.radius);
    const scale = magnitude > 0 ? clampedMagnitude / magnitude : 0;
    const thumbX = offset.x * scale;
    const thumbY = offset.y * scale;
    this.thumb.style.transform = `translate(${thumbX}px, ${thumbY}px)`;
  }
}
