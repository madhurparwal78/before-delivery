import type { PointerEvent as ReactPointerEvent } from "react";

const DRAG_START_PX = 10;
let suppressNextClick = false;

/** A click that ends a drag or a long press must not also open the pin. */
export const armClickSuppression = (): void => {
  suppressNextClick = true;
};
export const consumeClickSuppression = (): boolean => {
  const was = suppressNextClick;
  suppressNextClick = false;
  return was;
};

const hitAt = (x: number, y: number, source: HTMLElement): Element | null =>
  document.elementsFromPoint(x, y).find((element) => element !== source && !source.contains(element)) ?? null;

interface DragOptions {
  source: HTMLElement;
  onTarget?: (hit: Element | null) => void;
  onDrop: (hit: Element | null) => void;
}

/** Pressing and dragging more than 10 pixels picks the element up; releasing reports what lies under the pointer. */
export function beginPointerDrag(event: ReactPointerEvent, { source, onTarget, onDrop }: DragOptions): void {
  const { clientX: startX, clientY: startY, pointerId } = event;
  let dragging = false;
  consumeClickSuppression();
  try {
    source.setPointerCapture(pointerId);
  } catch {
    // pointer capture is a convenience; dragging still works without it
  }
  const move = (e: PointerEvent): void => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) > DRAG_START_PX) {
      dragging = true;
      source.classList.add("dragging");
    }
    if (!dragging) return;
    source.style.setProperty("--drag-x", `${dx}px`);
    source.style.setProperty("--drag-y", `${dy}px`);
    onTarget?.(hitAt(e.clientX, e.clientY, source));
  };
  const finish = (e: PointerEvent, cancelled: boolean): void => {
    if (e.pointerId !== pointerId) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId);
    const hit = hitAt(e.clientX, e.clientY, source);
    source.classList.remove("dragging");
    source.style.removeProperty("--drag-x");
    source.style.removeProperty("--drag-y");
    onTarget?.(null);
    if (dragging) {
      armClickSuppression();
      if (!cancelled) onDrop(hit);
    }
  };
  const up = (e: PointerEvent): void => finish(e, false);
  const cancel = (e: PointerEvent): void => finish(e, true);
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
}

export interface DropTarget {
  sectionId: number | null;
  position: number;
}

/** A card means "that card's place in its container"; an empty section means position 1. */
export function resolveDrop(hit: Element | null): DropTarget | null {
  const card = hit?.closest<HTMLElement>("[data-pin-id]");
  if (card) {
    const feed = card.closest<HTMLElement>("[data-section-id]");
    if (feed) return { sectionId: feed.dataset["sectionId"] === "" ? null : Number(feed.dataset["sectionId"]), position: Number(card.dataset["order"]) + 1 };
  }
  const section = hit?.closest<HTMLElement>("[data-drop-section]");
  if (section) return { sectionId: Number(section.dataset["dropSection"]), position: 1 };
  return null;
}
