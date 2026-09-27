export const CONTAINER_ITEM_DRAG_TYPE = "application/x-mmorpg-item-instance";
export const CONTAINER_SLOT_DRAG_TYPE = "application/x-mmorpg-container-slot";

const POINTER_DRAG_THRESHOLD = 6;
const DROP_TARGET_SELECTOR = "[data-container-slot], .inventory-list";

export interface ContainerPointerDragPayload {
  itemInstanceId: string;
  sourceSlot?: string;
}

interface ActivePointerDrag {
  source: HTMLElement;
  payload: ContainerPointerDragPayload;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
  ghost?: HTMLElement;
  target: Element | undefined;
  onDrop: (target: Element | null, payload: ContainerPointerDragPayload) => void;
  onMove: (event: PointerEvent) => void;
  onUp: (event: PointerEvent) => void;
  onCancel: (event: PointerEvent) => void;
}

let activePointerDrag: ActivePointerDrag | null = null;
let suppressClickUntil = 0;

export function bindContainerPointerDrag(
  source: HTMLElement,
  getPayload: () => ContainerPointerDragPayload | null,
  onDrop: (target: Element | null, payload: ContainerPointerDragPayload) => void
): () => void {
  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" || !event.isPrimary) return;

    const payload = getPayload();
    if (!payload) return;

    finishPointerDrag();

    const session: ActivePointerDrag = {
      source,
      payload,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      target: undefined,
      onDrop,
      onMove: () => undefined,
      onUp: () => undefined,
      onCancel: () => undefined
    };

    session.onMove = (moveEvent) => {
      if (moveEvent.pointerId !== session.pointerId) return;

      const distance = Math.hypot(
        moveEvent.clientX - session.startX,
        moveEvent.clientY - session.startY
      );
      if (!session.dragging) {
        if (distance < POINTER_DRAG_THRESHOLD) return;
        session.dragging = true;
        moveEvent.preventDefault();
        source.dataset.pointerDragging = "true";
        session.ghost = createGhost(source);
        document.body.appendChild(session.ghost);
      }

      moveEvent.preventDefault();
      positionGhost(session.ghost, moveEvent.clientX, moveEvent.clientY);
      setDropTarget(session, document.elementFromPoint(
        moveEvent.clientX,
        moveEvent.clientY
      ));
    };

    session.onUp = (upEvent) => {
      if (upEvent.pointerId !== session.pointerId) return;
      if (session.dragging) {
        upEvent.preventDefault();
        suppressClickUntil = Date.now() + 400;
        session.onDrop(session.target ?? null, session.payload);
      }
      finishPointerDrag();
    };

    session.onCancel = (cancelEvent) => {
      if (cancelEvent.pointerId !== session.pointerId) return;
      if (session.dragging) suppressClickUntil = Date.now() + 400;
      finishPointerDrag();
    };

    activePointerDrag = session;
    document.addEventListener("pointermove", session.onMove, { passive: false });
    document.addEventListener("pointerup", session.onUp, { passive: false });
    document.addEventListener("pointercancel", session.onCancel, { passive: false });
  };

  source.addEventListener("pointerdown", onPointerDown);
  return () => source.removeEventListener("pointerdown", onPointerDown);
}

export function consumeSuppressedContainerClick(): boolean {
  if (Date.now() >= suppressClickUntil) return false;
  suppressClickUntil = 0;
  return true;
}

export function cancelContainerPointerDrag(): void {
  finishPointerDrag();
}

function createGhost(source: HTMLElement): HTMLElement {
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.classList.add("container-drag-ghost");
  ghost.setAttribute("aria-hidden", "true");
  ghost.removeAttribute("id");
  return ghost;
}

function positionGhost(
  ghost: HTMLElement | undefined,
  clientX: number,
  clientY: number
): void {
  if (!ghost) return;
  ghost.style.left = `${clientX + 12}px`;
  ghost.style.top = `${clientY + 12}px`;
}

function setDropTarget(
  session: ActivePointerDrag,
  element: Element | null
): void {
  const target = element?.closest(DROP_TARGET_SELECTOR) ?? undefined;
  if (target === session.target) return;

  if (session.target instanceof HTMLElement) {
    delete session.target.dataset.dropTarget;
  }
  session.target = target;
  if (target instanceof HTMLElement) target.dataset.dropTarget = "true";
}

function finishPointerDrag(): void {
  const session = activePointerDrag;
  if (!session) return;

  document.removeEventListener("pointermove", session.onMove);
  document.removeEventListener("pointerup", session.onUp);
  document.removeEventListener("pointercancel", session.onCancel);
  if (session.target instanceof HTMLElement) {
    delete session.target.dataset.dropTarget;
  }
  session.ghost?.remove();
  delete session.source.dataset.pointerDragging;
  activePointerDrag = null;
}
