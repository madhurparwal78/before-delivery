// Reorder lists (brief: Interactions, D02 and H02): Space picks up, arrows move one place with focus
// following, Enter drops, Escape restores; touch dragging an item up or down reorders it.
// Every changed place is announced; the order stays a draft until its review is confirmed.

import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import { reorderCopy } from "../shared/feedback";

interface Options {
  order: string[];
  setOrder: (order: string[]) => void;
  label: (key: string) => string;
  announce: (text: string) => void;
  /** Called instead of reordering when the list may no longer change. */
  refuse?: () => boolean;
}

/** A drag consumes its touch moves, so the browser never turns them into a fling that swallows the next tap. */
const consumeTouch = (event: TouchEvent) => event.preventDefault();

export function useReorder({ order, setOrder, label, announce, refuse }: Options) {
  const [held, setHeld] = useState<string | null>(null);
  const before = useRef<string[]>(order);
  const refs = useRef(new Map<string, HTMLElement>());
  const focusAfter = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (focusAfter.current) refs.current.get(focusAfter.current)?.focus();
    focusAfter.current = null;
  });

  const place = useCallback(
    (key: string, index: number) => {
      const next = order.filter((k) => k !== key);
      next.splice(index, 0, key);
      if (next.join() === order.join()) return;
      setOrder(next);
      announce(reorderCopy(label(key), index + 1, next.length));
    },
    [order, setOrder, label, announce],
  );

  const item = useCallback(
    (key: string) => ({
      ref: (el: HTMLElement | null) => {
        if (el) {
          el.addEventListener("touchmove", consumeTouch, { passive: false });
          refs.current.set(key, el);
        } else refs.current.delete(key);
      },
      "aria-pressed": held === key,
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === " ") {
          event.preventDefault();
          if (held === key) setHeld(null);
          else if (!refuse?.()) {
            before.current = order;
            setHeld(key);
          }
        } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && held === key) {
          event.preventDefault();
          const index = order.indexOf(key) + (event.key === "ArrowUp" ? -1 : 1);
          if (index < 0 || index >= order.length) return;
          focusAfter.current = key;
          place(key, index);
        } else if (event.key === "Enter" && held === key) {
          event.preventDefault();
          setHeld(null);
        } else if (event.key === "Escape" && held === key) {
          event.preventDefault();
          setOrder(before.current);
          focusAfter.current = key;
          setHeld(null);
        }
      },
      onKeyUp: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === " ") event.preventDefault();
      },
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        const startY = event.clientY;
        const element = event.currentTarget;
        const pointer = event.pointerId;
        let moved = false;
        const move = (e: globalThis.PointerEvent) => {
          if (e.pointerId !== pointer) return;
          if (!moved && Math.abs(e.clientY - startY) < 8) return;
          moved = true;
          element.classList.add("dragging");
          element.style.transform = `translateY(${e.clientY - startY}px)`;
        };
        const up = (e: globalThis.PointerEvent) => {
          if (e.pointerId !== pointer) return;
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          window.removeEventListener("pointercancel", up);
          element.classList.remove("dragging");
          element.style.transform = "";
          if (!moved || e.type === "pointercancel" || refuse?.()) return;
          const others = order.filter((k) => k !== key);
          const index = others.filter((k) => {
            const box = refs.current.get(k)?.getBoundingClientRect();
            return box ? e.clientY > box.top + box.height / 2 : false;
          }).length;
          flushSync(() => place(key, index)); // native listener: commit the reorder inside this event
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);
      },
    }),
    [held, order, place, refuse, setOrder],
  );

  return { held, item };
}
