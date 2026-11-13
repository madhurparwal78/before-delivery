import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { fmtData } from '../../../shared/geometry/index.ts';
import type { Point } from '../../../shared/types.ts';
import { useStoreSlice } from '../../store/hooks.tsx';
import type { SceneStore } from '../../store/sceneStore.ts';
import type { DrawingStore } from '../../store/drawingStore.ts';
import { Overlay } from './Overlay.tsx';
import { WorldGroup } from './Layers.tsx';
import { TouchGestures } from './touchGestures.ts';
import type { Finger } from './touchGestures.ts';
import type { CanvasPaneProps } from './types.ts';
import './canvas.css';

const NUDGE_UNITS = 1;
const NUDGE_UNITS_SHIFT = 10;
const ARROWS: Readonly<Record<string, Point>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

interface FrameProps {
  store: SceneStore;
  live: DrawingStore | undefined;
  onTap: ((world: Point) => void) | undefined;
  onLongPress: ((world: Point, screen: Point) => void) | undefined;
  onEntityActivate: ((id: string) => void) | undefined;
  children: ReactNode;
}

/** `region "Drawing"`: the root attributes, the sizing, and every pointer, wheel, key and touch event of the pane. */
function PaneFrame({ store, live, onTap, onLongPress, onEntityActivate, children }: FrameProps) {
  const root = useRef<HTMLDivElement>(null);
  const tapped = useEffectEvent((world: Point) => onTap?.(world));
  const longPressed = useEffectEvent((world: Point, screen: Point) => onLongPress?.(world, screen));
  const revision = useStoreSlice(store, (snapshot) => snapshot.revision);
  const view = useStoreSlice(store, (snapshot) => snapshot.view);
  const snap = useStoreSlice(store, (snapshot) => snapshot.hover.snap);
  const total = useStoreSlice(store, (snapshot) => snapshot.scene.entities.length);
  const pending = useStoreSlice(live ?? store, (snapshot) => ('pendingOps' in snapshot ? snapshot.pendingOps : 0));

  const paneOf = (clientX: number, clientY: number): Point => {
    const box = root.current?.getBoundingClientRect();
    return [clientX - (box?.left ?? 0), clientY - (box?.top ?? 0)];
  };

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const measure = (): void => store.setPaneSize(element.clientWidth, element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [store]);

  // The wheel and touch listeners are native so they can cancel the page's own scrolling and zooming.
  useEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const fingersOf = (touches: TouchList): Finger[] => Array.from(touches, (touch) => paneOf(touch.clientX, touch.clientY));
    const gestures = new TouchGestures({
      view: () => store.getSnapshot().view,
      moveView: (next) => store.moveView(next),
      tap: (world) => (store.getSnapshot().measuring ? store.finishMeasure(world) : tapped(world)),
      longPress: longPressed,
    });
    const wheel = (event: WheelEvent): void => {
      event.preventDefault();
      store.wheel(paneOf(event.clientX, event.clientY), event.deltaY);
    };
    const touchStart = (event: TouchEvent): void => {
      event.preventDefault();
      gestures.start(fingersOf(event.touches));
    };
    const touchMove = (event: TouchEvent): void => {
      event.preventDefault();
      gestures.move(fingersOf(event.touches));
    };
    const touchEnd = (event: TouchEvent): void => {
      event.preventDefault();
      const lifted = event.changedTouches[0];
      gestures.end(fingersOf(event.touches), lifted ? paneOf(lifted.clientX, lifted.clientY) : null);
    };
    const touchCancel = (): void => gestures.cancel();
    // Any key press ends a transient prompt message. It runs before the handler that may make the next one (capture phase).
    const anyKey = (): void => live?.commandKeyPress();
    const spaceDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== ' ' || isEditable(event.target)) return;
      store.setSpaceHeld(true);
      if (event.target === element) event.preventDefault();
    };
    const spaceUp = (event: globalThis.KeyboardEvent): void => {
      if (event.key === ' ') store.setSpaceHeld(false);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    element.addEventListener('touchstart', touchStart, { passive: false });
    element.addEventListener('touchmove', touchMove, { passive: false });
    element.addEventListener('touchend', touchEnd, { passive: false });
    element.addEventListener('touchcancel', touchCancel);
    document.addEventListener('keydown', anyKey, true);
    document.addEventListener('keydown', spaceDown);
    document.addEventListener('keyup', spaceUp);
    return () => {
      element.removeEventListener('wheel', wheel);
      element.removeEventListener('touchstart', touchStart);
      element.removeEventListener('touchmove', touchMove);
      element.removeEventListener('touchend', touchEnd);
      element.removeEventListener('touchcancel', touchCancel);
      document.removeEventListener('keydown', anyKey, true);
      document.removeEventListener('keydown', spaceDown);
      document.removeEventListener('keyup', spaceUp);
      gestures.cancel();
    };
  }, [store, live]);

  const pointer = (event: ReactPointerEvent): Point => paneOf(event.clientX, event.clientY);

  function keyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const arrow = ARROWS[event.key];
    if (!live || !arrow || event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return;
    if (store.getSnapshot().selection.size === 0) return;
    event.preventDefault();
    const step = event.shiftKey ? NUDGE_UNITS_SHIFT : NUDGE_UNITS;
    live.nudge(arrow[0] * step, arrow[1] * step);
  }

  return (
    <div
      ref={root}
      role="region"
      aria-label="Drawing"
      tabIndex={0}
      className="canvas-pane"
      data-revision={revision}
      data-pending-ops={pending}
      data-total-entities={total}
      data-snap-kind={snap?.kind ?? 'none'}
      data-snap-x={snap ? fmtData(snap.point[0]) : undefined}
      data-snap-y={snap ? fmtData(snap.point[1]) : undefined}
      data-zoom={fmtData(view.zoom)}
      data-pan-x={fmtData(view.panX)}
      data-pan-y={fmtData(view.panY)}
      onKeyDown={keyDown}
      onPointerDown={(event) => {
        if (event.pointerType === 'touch') return;
        event.currentTarget.setPointerCapture(event.pointerId);
        store.pointerDown(pointer(event), event.button, event.shiftKey);
      }}
      onPointerMove={(event) => {
        if (event.pointerType !== 'touch') store.pointerMove(pointer(event));
      }}
      onPointerUp={(event) => {
        if (event.pointerType !== 'touch') store.pointerUp(pointer(event), event.shiftKey);
      }}
      onPointerCancel={(event) => {
        if (event.pointerType !== 'touch') store.pointerUp(pointer(event), false);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'touch' && event.buttons === 0) store.pointerLeave();
      }}
      onClick={(event) => {
        const id = event.target instanceof Element ? event.target.closest('[data-entity-id]')?.getAttribute('data-entity-id') : null;
        if (id) onEntityActivate?.(id);
      }}
    >
      {children}
    </div>
  );
}

/**
 * `region "Drawing"`: the pane that fills its container with the drawing root attributes, one `<svg>` with the view group, grips, the
 * selection window, crosshairs, the snap marker, underlays, sheet layouts, compare layers, issue pins and markups. All pointer, wheel,
 * keyboard (arrow nudges) and touch handling of the drawing lives here and drives the store.
 */
export function CanvasPane({ store, live, compare = null, pins = [], markups = [], onTap, onLongPress, onEntityActivate, onSwipeChange }: CanvasPaneProps) {
  return (
    <PaneFrame store={store} live={live} onTap={onTap} onLongPress={onLongPress} onEntityActivate={compare ? onEntityActivate : undefined}>
      <svg className="canvas-svg" xmlns="http://www.w3.org/2000/svg">
        <WorldGroup store={store} live={live} compare={compare} onEntityActivate={onEntityActivate} />
        <Overlay store={store} live={live} compare={compare} pins={pins} markups={markups} onSwipeChange={onSwipeChange} />
      </svg>
    </PaneFrame>
  );
}
