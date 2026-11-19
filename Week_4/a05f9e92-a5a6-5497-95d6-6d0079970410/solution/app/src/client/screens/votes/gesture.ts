import { useRef, type MouseEvent, type PointerEvent as ReactPointerEvent, type TouchEvent } from "react";
import { animate } from "../../lib/ui.js";

/** Pixels a card must travel sideways, past which a release counts as a decision. */
const SWIPE_DISTANCE = 96;
const LONG_PRESS_MS = 600;
/** Movement below this many pixels still counts as holding still. */
const HOLD_SLOP = 10;

type Direction = "left" | "right";

interface Touch {
  pointer: number;
  x: number;
  y: number;
  dx: number;
  dragging: boolean;
  timer: number | null;
}

interface CardGesture {
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(event: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(event: ReactPointerEvent<HTMLElement>): void;
  onTouchEnd(event: TouchEvent<HTMLElement>): void;
  onClickCapture(event: MouseEvent<HTMLElement>): void;
  onContextMenu(event: MouseEvent<HTMLElement>): void;
}

/**
 * Sideways drag and long press on one card. The card follows the finger through its own transform; a release past the
 * distance in an allowed direction calls `onSwipe`, a shorter one returns the card with a 180 ms animation.
 */
export function useCardGesture(options: { enabled: boolean; directions: Direction[]; onSwipe(direction: Direction): void; onLongPress(): void }): CardGesture {
  const touch = useRef<Touch | null>(null);
  const suppressClick = useRef(false);
  const latest = useRef(options);
  latest.current = options;

  const stopTimer = (): void => {
    if (touch.current?.timer != null) window.clearTimeout(touch.current.timer);
    if (touch.current) touch.current.timer = null;
  };

  const settle = (card: HTMLElement, from: number): void => {
    card.style.transform = "";
    card.removeAttribute("data-lean");
    if (from !== 0) animate(card, [{ transform: `translateX(${from}px)` }, { transform: "translateX(0)" }], 180);
  };

  return {
    onPointerDown(event) {
      if (!latest.current.enabled || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      stopTimer();
      suppressClick.current = false;
      const card = event.currentTarget;
      const mine: Touch = { pointer: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, dragging: false, timer: null };
      mine.timer = window.setTimeout(() => {
        mine.timer = null;
        if (touch.current !== mine) return;
        touch.current = null;
        suppressClick.current = true;
        card.focus();
        latest.current.onLongPress();
      }, LONG_PRESS_MS);
      touch.current = mine;
    },
    onPointerMove(event) {
      const mine = touch.current;
      if (!mine || mine.pointer !== event.pointerId) return;
      const dx = event.clientX - mine.x;
      const dy = event.clientY - mine.y;
      if (!mine.dragging) {
        if (Math.hypot(dx, dy) <= HOLD_SLOP) return;
        stopTimer();
        if (Math.abs(dy) > Math.abs(dx)) {
          touch.current = null;
          return;
        }
        mine.dragging = true;
        event.currentTarget.setPointerCapture(event.pointerId);
      }
      mine.dx = dx;
      const card = event.currentTarget;
      card.style.transform = `translateX(${dx}px)`;
      const lean: Direction = dx > 0 ? "right" : "left";
      if (Math.abs(dx) > SWIPE_DISTANCE && latest.current.directions.includes(lean)) card.dataset.lean = lean;
      else card.removeAttribute("data-lean");
    },
    onPointerUp(event) {
      const mine = touch.current;
      if (!mine || mine.pointer !== event.pointerId) return;
      stopTimer();
      touch.current = null;
      if (!mine.dragging) return;
      suppressClick.current = true;
      const direction: Direction = mine.dx > 0 ? "right" : "left";
      if (Math.abs(mine.dx) > SWIPE_DISTANCE && latest.current.directions.includes(direction)) {
        event.currentTarget.removeAttribute("data-lean");
        latest.current.onSwipe(direction);
        return;
      }
      settle(event.currentTarget, mine.dx);
    },
    onPointerCancel(event) {
      const mine = touch.current;
      if (!mine || mine.pointer !== event.pointerId) return;
      stopTimer();
      touch.current = null;
      if (mine.dragging) settle(event.currentTarget, mine.dx);
    },
    onTouchEnd(event) {
      if (suppressClick.current && event.cancelable) event.preventDefault();
    },
    onClickCapture(event) {
      if (!suppressClick.current) return;
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
    onContextMenu(event) {
      if (latest.current.enabled) event.preventDefault();
    },
  };
}

/** The brief's press feedback: a brief inset on a pressed button or card, 180 ms, none under reduced motion. */
export function pressFeedback(event: ReactPointerEvent<HTMLElement>): void {
  const target = (event.target as Element).closest<HTMLElement>("button, [data-press]");
  if (!target || (target instanceof HTMLButtonElement && target.disabled)) return;
  animate(target, [{ boxShadow: "inset 0 0 0 0 currentColor" }, { boxShadow: "inset 0 0 0 5px currentColor", offset: 0.35 }, { boxShadow: "inset 0 0 0 0 currentColor" }], 180);
}
