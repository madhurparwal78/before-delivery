import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/** Pointer travel below this many pixels is a click, not a drag. */
const DRAG_PX = 6;

export interface DragState {
  from: string;
  /** Pointer position in the board's drawing coordinates. */
  x: number;
  y: number;
  /** The terminal under the pointer, if any. */
  over: string | null;
}

function terminalAt(clientX: number, clientY: number): string | null {
  return document.elementFromPoint(clientX, clientY)?.closest("[data-terminal]")?.getAttribute("data-terminal") ?? null;
}

/**
 * Wiring by pointer: press a terminal (a list button or a dot on the board), drag, and release over another terminal.
 * A press and release in place is left to the terminal's own click.
 */
export function useTerminalDrag(board: RefObject<SVGSVGElement | null>, enabled: boolean, onWire: (from: string, to: string) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const cleanup = useRef<(() => void) | null>(null);
  const wire = useRef(onWire);
  useEffect(() => {
    wire.current = onWire;
  }, [onWire]);
  useEffect(() => () => cleanup.current?.(), []);

  const toBoard = useCallback((clientX: number, clientY: number) => {
    const svg = board.current;
    const matrix = svg?.getScreenCTM();
    if (!svg || !matrix) return { x: 0, y: 0 };
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }, [board]);

  const begin = useCallback((from: string, event: ReactPointerEvent) => {
    if (!enabled || event.button !== 0) return;
    cleanup.current?.();
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const move = (e: PointerEvent) => {
      moved = moved || Math.hypot(e.clientX - startX, e.clientY - startY) > DRAG_PX;
      if (moved) setDrag({ from, ...toBoard(e.clientX, e.clientY), over: terminalAt(e.clientX, e.clientY) });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      cleanup.current = null;
      setDrag(null);
    };
    const up = (e: PointerEvent) => {
      const over = moved ? terminalAt(e.clientX, e.clientY) : null;
      stop();
      if (over && over !== from) wire.current(from, over);
    };
    const cancel = () => stop();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    cleanup.current = stop;
  }, [enabled, toBoard]);

  return { drag, begin };
}
