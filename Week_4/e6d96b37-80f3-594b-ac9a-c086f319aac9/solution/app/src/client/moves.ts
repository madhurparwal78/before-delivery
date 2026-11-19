// "Moving something to a destination" (brief: Interactions): touch or pointer drag moves the
// real source under the finger, tap-then-tap stages the same move, and the keyboard picks up
// with Space and stages with Enter. Every staged move is only a draft.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { flushSync } from "react-dom";

const DRAG_SLOP = 8;

interface Drag {
  source: string;
  element: HTMLElement;
  pointer: number;
  x: number;
  y: number;
  moved: boolean;
}

export function useMoves(onStage: (source: string, destination: string) => void) {
  const [picked, setPicked] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const stage = useRef(onStage);
  stage.current = onStage;

  useEffect(() => {
    if (picked === null) return;
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setPicked(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [picked]);

  const finishDrag = useCallback((event: globalThis.PointerEvent) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointer) return;
    drag.current = null;
    window.removeEventListener("pointermove", moveDrag);
    window.removeEventListener("pointerup", finishDrag);
    window.removeEventListener("pointercancel", finishDrag);
    current.element.style.transform = "";
    current.element.classList.remove("dragging");
    if (!current.moved) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    if (event.type === "pointercancel") return;
    const target = document
      .elementsFromPoint(event.clientX, event.clientY)
      .find((el) => !current.element.contains(el) && el.closest("[data-destination]"))
      ?.closest<HTMLElement>("[data-destination]");
    const destination = target?.dataset.destination;
    // A native listener: commit the staged move inside this event so the next input already sees it.
    flushSync(() => {
      if (destination && destination !== current.source) stage.current(current.source, destination);
      setPicked(null);
    });
  }, []);

  const moveDrag = useCallback((event: globalThis.PointerEvent) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointer) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
    current.moved = true;
    current.element.classList.add("dragging");
    current.element.style.transform = `translate(${dx}px, ${dy}px)`;
  }, []);

  /** Props for a source; `alsoDestination` lets a filled slot be both. */
  const source = useCallback(
    (id: string, alsoDestination = false) => ({
      "aria-pressed": picked === id,
      "data-source": id,
      ...(alsoDestination ? { "data-destination": id } : {}),
      onClick: (event: MouseEvent<HTMLElement>) => {
        event.stopPropagation();
        if (suppressClick.current) return;
        const holder = alsoDestination ? event.currentTarget : event.currentTarget.parentElement?.closest<HTMLElement>("[data-destination]");
        if (picked !== null && picked !== id && holder?.dataset.destination) {
          stage.current(picked, holder.dataset.destination);
          setPicked(null);
          return;
        }
        setPicked((p) => (p === id ? null : id));
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === " ") {
          event.preventDefault();
          setPicked((p) => (p === id ? null : id));
        }
      },
      onKeyUp: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key === " ") event.preventDefault();
      },
      onPointerDown: (event: PointerEvent<HTMLElement>) => {
        if (event.button !== 0) return;
        drag.current = { source: id, element: event.currentTarget, pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        window.addEventListener("pointermove", moveDrag);
        window.addEventListener("pointerup", finishDrag);
        window.addEventListener("pointercancel", finishDrag);
      },
    }),
    [picked, moveDrag, finishDrag],
  );

  /** Props for a destination button or region. */
  const destination = useCallback(
    (id: string) => ({
      "data-destination": id,
      onClick: () => {
        if (picked === null) return;
        stage.current(picked, id);
        setPicked(null);
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (event.key !== "Enter" || picked === null) return;
        event.preventDefault();
        stage.current(picked, id);
        setPicked(null);
      },
    }),
    [picked],
  );

  return { picked, setPicked, source, destination };
}
