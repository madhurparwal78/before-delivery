// Pointer, touch and wheel input of the drawing canvas (brief: Interactions > View and screen mapping, Touch).
import { useEffect, type RefObject } from 'react';
import { COPY } from '../../../shared/copy.ts';
import { expects } from '../commandLine/machine.ts';
import type { EditorStore } from '../store.ts';
import { WHEEL_STEP, scaleOf, toModel } from './camera.ts';
import { snapNow } from './snap.ts';

/** A click or tap selects within this many screen pixels. */
const PICK_PX = 5;
/** A click that moves further than this is not a click. */
const CLICK_SLOP_PX = 5;
/** A tap is shorter than this and moves less than TAP_SLOP_PX. */
const TAP_MS = 300;
const TAP_SLOP_PX = 8;
const WHEEL_NOTCH = 100;

interface Touch { x: number; y: number; startX: number; startY: number; startedAt: number; moved: boolean }

export function useCanvasInput(host: RefObject<HTMLDivElement | null>, store: EditorStore): void {
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const touches = new Map<number, Touch>();
    let pan: { id: number; x: number; y: number } | null = null;
    let press: { id: number; x: number; y: number; shift: boolean } | null = null;
    let spread = 0;

    const camera = () => (store.current.layout === 'Model' ? store.camera : store.paperCamera);
    const local = (event: PointerEvent | WheelEvent): [number, number] => {
      const box = element.getBoundingClientRect();
      return [event.clientX - box.left, event.clientY - box.top];
    };
    const fingers = (): [Touch, Touch] | null => {
      const [a, b] = [...touches.values()];
      return a && b ? [a, b] : null;
    };

    const select = (model: [number, number], tolerance: number, shift: boolean): void => {
      const state = store.current;
      const target = store.session.environment().pick(model, tolerance);
      if (!target) {
        if (!shift) store.select([]);
        return;
      }
      if (state.activeTrace && !target.inTrace) {
        store.pushHistory(COPY.baseObjectInTrace);
        return;
      }
      const now = state.selection;
      store.select(shift ? (now.includes(target.handle) ? now.filter((handle) => handle !== target.handle) : [...now, target.handle]) : [target.handle]);
    };

    const click = (x: number, y: number, shift: boolean, touch: boolean): void => {
      const state = store.current;
      if (!state.drawing || state.layout !== 'Model') return;
      const view = store.camera.get();
      const model = toModel(view, x, y);
      const tolerance = PICK_PX / scaleOf(view);
      store.hud.update({ pointer: { x, y, touch }, cleared: false, cycle: 0, ...(touch ? { readout: model } : {}) });
      switch (expects(state.machine)) {
        case 'point': {
          const snap = snapNow(store);
          if (snap) store.hud.update({ track: snap.point });
          store.session.pick(snap ? snap.point : store.session.constrained(model), tolerance);
          break;
        }
        case 'object': store.session.pick(model, tolerance); break;
        case 'idle': select(model, tolerance, shift); break;
        case 'none': break;
      }
    };

    const onDown = (event: PointerEvent): void => {
      const [x, y] = local(event);
      if (event.pointerType === 'touch') {
        touches.set(event.pointerId, { x, y, startX: x, startY: y, startedAt: performance.now(), moved: false });
        element.setPointerCapture(event.pointerId);
        const pair = fingers();
        if (pair) {
          spread = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
          for (const touch of touches.values()) touch.moved = true;
        }
      } else if (event.button === 1) {
        event.preventDefault();
        pan = { id: event.pointerId, x, y };
        element.setPointerCapture(event.pointerId);
      } else if (event.button === 0) {
        press = { id: event.pointerId, x, y, shift: event.shiftKey };
      }
    };

    const onMove = (event: PointerEvent): void => {
      const [x, y] = local(event);
      if (event.pointerType === 'touch') {
        const touch = touches.get(event.pointerId);
        if (!touch) return;
        const dx = x - touch.x;
        const dy = y - touch.y;
        touch.x = x;
        touch.y = y;
        const pair = fingers();
        if (pair) {
          const now = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
          if (spread > 0 && now > 0) camera().zoomBy(now / spread, [(pair[0].x + pair[1].x) / 2, (pair[0].y + pair[1].y) / 2]);
          spread = now;
          return;
        }
        if (!touch.moved && Math.hypot(x - touch.startX, y - touch.startY) >= TAP_SLOP_PX) touch.moved = true;
        if (touch.moved) camera().panBy(dx, dy);
        return;
      }
      store.hud.update({ pointer: { x, y, touch: false }, cleared: false, cycle: 0 });
      if (pan && pan.id === event.pointerId) {
        camera().panBy(x - pan.x, y - pan.y);
        pan = { id: pan.id, x, y };
      }
    };

    const onUp = (event: PointerEvent): void => {
      const [x, y] = local(event);
      if (event.pointerType === 'touch') {
        const touch = touches.get(event.pointerId);
        touches.delete(event.pointerId);
        if (touches.size < 2) spread = 0;
        if (touch && !touch.moved && touches.size === 0 && performance.now() - touch.startedAt < TAP_MS) click(x, y, false, true);
      } else if (event.button === 1 && pan?.id === event.pointerId) {
        pan = null;
      } else if (event.button === 0 && press?.id === event.pointerId) {
        const shift = press.shift || event.shiftKey;
        const moved = Math.hypot(x - press.x, y - press.y);
        press = null;
        if (moved <= CLICK_SLOP_PX) click(x, y, shift, false);
      }
    };

    const onCancel = (event: PointerEvent): void => {
      touches.delete(event.pointerId);
      if (pan?.id === event.pointerId) pan = null;
      if (press?.id === event.pointerId) press = null;
    };

    const onLeave = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') return;
      const pointer = store.hud.get().pointer;
      if (pointer) store.hud.update({ pointer: null, readout: toModel(store.camera.get(), pointer.x, pointer.y) });
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const [x, y] = local(event);
      camera().zoomBy(WHEEL_STEP ** (-event.deltaY / WHEEL_NOTCH), [x, y]);
    };

    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onCancel);
    element.addEventListener('pointerleave', onLeave);
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onCancel);
      element.removeEventListener('pointerleave', onLeave);
      element.removeEventListener('wheel', onWheel);
    };
  }, [host, store]);
}
