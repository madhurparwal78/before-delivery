const THRESHOLD = 8;

export interface DragHandlers {
  onStart?: () => void;
  onMove?: (x: number, y: number) => void;
  onDrop: (x: number, y: number) => void;
  onCancel?: () => void;
}

/**
 * A pointer or touch drag that starts after 8 px. The page never scrolls while
 * a touch drag is in flight.
 */
export function enableDrag(handle: HTMLElement, handlers: DragHandlers): void {
  const begin = (startX: number, startY: number, touch: boolean): void => {
    let started = false;

    const move = (x: number, y: number) => {
      if (!started) {
        if (Math.abs(x - startX) < THRESHOLD && Math.abs(y - startY) < THRESHOLD) return;
        started = true;
        handlers.onStart?.();
      }
      handlers.onMove?.(x, y);
    };

    const onMouseMove = (event: MouseEvent) => move(event.clientX, event.clientY);
    const onTouchMove = (event: TouchEvent) => {
      const point = event.touches[0];
      if (!point) return;
      if (started) event.preventDefault();
      move(point.clientX, point.clientY);
    };
    const finish = (x: number, y: number) => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      if (started) handlers.onDrop(x, y);
      else handlers.onCancel?.();
    };
    const onMouseUp = (event: MouseEvent) => finish(event.clientX, event.clientY);
    const onTouchEnd = (event: TouchEvent) => {
      const point = event.changedTouches[0];
      finish(point ? point.clientX : startX, point ? point.clientY : startY);
    };

    if (touch) {
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
    } else {
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    }
  };

  handle.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    begin(event.clientX, event.clientY, false);
  });
  handle.addEventListener(
    'touchstart',
    (event) => {
      const point = event.touches[0];
      if (!point) return;
      begin(point.clientX, point.clientY, true);
    },
    { passive: true },
  );
}

export function elementUnder<T extends Element>(x: number, y: number, selector: string): T | null {
  for (const node of document.elementsFromPoint(x, y)) {
    const match = node.closest(selector);
    if (match) return match as T;
  }
  return null;
}
