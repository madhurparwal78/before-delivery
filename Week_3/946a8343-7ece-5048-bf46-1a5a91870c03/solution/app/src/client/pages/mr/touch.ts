// Touch gestures on the diff (phones).
//   useDiffGestures(ref, { rowSelector, onSwipe, onHold })
//     swipe  a finger that moves more than 80 px sideways and less than 40 px up or down: onSwipe(1) when it moves left (next
//            file), onSwipe(-1) when it moves right (previous file)
//     hold   a finger that rests on a row for 500 ms (page timers) while moving less than 8 px: onHold(row). The lift that ends
//            a hold is cancelled so the browser sends no click to whatever the hold opened. Movement is read from pointer events:
//            the browser sends touchmove only once a finger has left its tap slop, which is wider than 8 px.
import { type RefObject } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

const SWIPE_DISTANCE_PX = 80;
const SWIPE_DRIFT_PX = 40;
const HOLD_MS = 500;
const HOLD_SLOP_PX = 8;

interface DiffGestures {
  rowSelector: string;
  onSwipe(direction: 1 | -1): void;
  onHold(row: HTMLElement): void;
}

interface Point {
  x: number;
  y: number;
}

export function useDiffGestures(target: RefObject<HTMLElement>, gestures: DiffGestures): void {
  const latest = useRef(gestures);
  latest.current = gestures;
  useLayoutEffect(() => {
    const element = target.current;
    if (!element) return;
    let begin: Point | null = null;
    let last: Point = { x: 0, y: 0 };
    let timer: number | null = null;
    let held = false;

    const cancelHold = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
    };
    const pointOf = (event: TouchEvent): Point | null => {
      const touch = event.touches.item(0) ?? event.changedTouches.item(0);
      return touch ? { x: touch.clientX, y: touch.clientY } : null;
    };

    const onStart = (event: TouchEvent) => {
      cancelHold();
      held = false;
      const point = event.touches.length === 1 ? pointOf(event) : null;
      begin = point;
      if (!point) return;
      last = point;
      const row = event.target instanceof Element ? event.target.closest<HTMLElement>(latest.current.rowSelector) : null;
      if (!row) return;
      timer = window.setTimeout(() => {
        timer = null;
        held = true;
        latest.current.onHold(row);
      }, HOLD_MS);
    };
    const onMove = (event: TouchEvent) => {
      const point = pointOf(event);
      if (!begin || !point) return;
      last = point;
      if (Math.hypot(point.x - begin.x, point.y - begin.y) >= HOLD_SLOP_PX) cancelHold();
    };
    const onEnd = (event: TouchEvent) => {
      cancelHold();
      const from = begin;
      begin = null;
      if (held) {
        event.preventDefault();
        return;
      }
      if (!from) return;
      const sideways = last.x - from.x;
      const vertical = last.y - from.y;
      if (Math.abs(sideways) > SWIPE_DISTANCE_PX && Math.abs(vertical) < SWIPE_DRIFT_PX) latest.current.onSwipe(sideways < 0 ? 1 : -1);
    };
    const onCancel = () => {
      cancelHold();
      begin = null;
    };
    let rest: Point | null = null;
    const onPointerDown = (event: PointerEvent) => {
      rest = event.pointerType === "touch" ? { x: event.clientX, y: event.clientY } : null;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (rest !== null && Math.hypot(event.clientX - rest.x, event.clientY - rest.y) >= HOLD_SLOP_PX) cancelHold();
    };
    const onPointerCancel = () => {
      rest = null;
      cancelHold();
    };
    const onMenu = (event: Event) => {
      if (held) event.preventDefault();
    };

    element.addEventListener("touchstart", onStart, { passive: true });
    element.addEventListener("touchmove", onMove, { passive: true });
    element.addEventListener("touchend", onEnd, { passive: false });
    element.addEventListener("touchcancel", onCancel, { passive: true });
    element.addEventListener("pointerdown", onPointerDown, { passive: true });
    element.addEventListener("pointermove", onPointerMove, { passive: true });
    element.addEventListener("pointercancel", onPointerCancel, { passive: true });
    element.addEventListener("contextmenu", onMenu);
    return () => {
      cancelHold();
      element.removeEventListener("touchstart", onStart);
      element.removeEventListener("touchmove", onMove);
      element.removeEventListener("touchend", onEnd);
      element.removeEventListener("touchcancel", onCancel);
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointercancel", onPointerCancel);
      element.removeEventListener("contextmenu", onMenu);
    };
  }, [target]);
}
