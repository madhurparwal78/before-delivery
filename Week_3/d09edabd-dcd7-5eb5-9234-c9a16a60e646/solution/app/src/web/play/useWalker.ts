import { useEffect, useRef, useState, type RefObject } from 'react';
import { post } from '../api';
import { usePhone } from '../ui/hooks';
import { eyePose, startStance, type Stance } from '../three/poses';
import type { RoomView } from '../three/roomView';
import type { PlayNode, PlayView } from '../../shared/types';
import { nodesInReach, pushPlacements, walkStep, type Intent, type Pushed } from './walk';

const LOOK_DEG_PER_PX = 0.25;
const MAX_PITCH_DEG = 70;
const STICK_RADIUS_PX = 48;
const STICK_DEAD_PX = 6;
const MAX_FRAME_MS = 100;
const REPORT_MS = 2000;

const IDLE: Intent = { forward: 0, strafe: 0 };

const KEY_INTENT: Record<string, Intent> = {
  w: { forward: 1, strafe: 0 },
  arrowup: { forward: 1, strafe: 0 },
  s: { forward: -1, strafe: 0 },
  arrowdown: { forward: -1, strafe: 0 },
  a: { forward: 0, strafe: -1 },
  arrowleft: { forward: 0, strafe: -1 },
  d: { forward: 0, strafe: 1 },
  arrowright: { forward: 0, strafe: 1 },
};

interface Drag {
  id: number;
  /** On a phone the left half of the stage walks; everywhere else a drag looks. */
  walking: boolean;
  fromX: number;
  fromY: number;
}

interface Walker extends Stance {
  pitchDeg: number;
}

interface Options {
  token: string;
  view: RoomView | null;
  room: PlayView['room'];
  nodes: PlayNode[];
  /** The session runs, the tester has joined and no sheet is open. */
  enabled: boolean;
  onApproach: (nodeId: string) => void;
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));
const wrapDegrees = (deg: number): number => ((deg % 360) + 360) % 360;
const stick = (pixels: number): number => (Math.abs(pixels) < STICK_DEAD_PX ? 0 : clamp(pixels / STICK_RADIUS_PX, -1, 1));
const typing = (target: EventTarget | null): boolean => target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]') !== null;

/**
 * The tester's body: W A S D and the arrow keys walk, a drag looks (on a phone the left half of the stage walks
 * instead), and walking into a box or cylinder pushes it. Frames run only while something moves. Returns where
 * pushed placements now stand, which is local to this tester.
 */
export function useWalker(stage: RefObject<HTMLElement | null>, options: Options): Pushed {
  const phone = usePhone();
  const latest = useRef({ ...options, phone });
  latest.current = { ...options, phone };

  const start = startStance(options.room, options.room.placements);
  const walker = useRef<Walker>({ ...start, pitchDeg: 0 });
  const pushedAt = useRef<Pushed>({});
  const inReach = useRef<ReadonlySet<string>>(new Set());
  const [pushed, setPushed] = useState<Pushed>(pushedAt.current);

  useEffect(() => {
    walker.current = { xMm: start.xMm, zMm: start.zMm, headingDeg: start.headingDeg, pitchDeg: 0 };
    options.view?.setPose(eyePose(start.xMm, start.zMm, start.headingDeg));
  }, [options.view, start.xMm, start.zMm, start.headingDeg]);

  useEffect(() => {
    const element = stage.current;
    if (!options.enabled || !element) return;
    const keys = new Set<string>();
    let pushing: Intent = IDLE;
    let drag: Drag | null = null;
    let frame = 0;
    let reporter = 0;
    let last = 0;
    let unreported = false;

    const show = (): void => {
      const { xMm, zMm, headingDeg, pitchDeg } = walker.current;
      latest.current.view?.setPose(eyePose(xMm, zMm, headingDeg, pitchDeg));
    };

    const intent = (): Intent => {
      let forward = pushing.forward;
      let strafe = pushing.strafe;
      for (const key of keys) {
        forward += KEY_INTENT[key]!.forward;
        strafe += KEY_INTENT[key]!.strafe;
      }
      return { forward: clamp(forward, -1, 1), strafe: clamp(strafe, -1, 1) };
    };

    /** The position goes to the server every 2 seconds while the tester moves, and once more when they stop. */
    const report = (): void => {
      if (!unreported) return;
      unreported = false;
      const { xMm, zMm, headingDeg } = walker.current;
      post(`/api/play/${latest.current.token}/position`, { xMm: Math.round(xMm), zMm: Math.round(zMm), headingDeg: Math.round(headingDeg) % 360 }).catch(() => {
        // A report that did not arrive is replaced by the next one.
      });
    };

    const tick = (): void => {
      const now = performance.now();
      const elapsed = Math.min(MAX_FRAME_MS, now - last);
      last = now;
      frame = requestAnimationFrame(tick);
      const want = intent();
      if (want.forward === 0 && want.strafe === 0) return;
      const { room, nodes, onApproach } = latest.current;
      const result = pushPlacements(walkStep(walker.current, want, elapsed, room), room.placements, pushedAt.current, room);
      walker.current = { ...walker.current, ...result.walker };
      if (result.pushed !== pushedAt.current) {
        pushedAt.current = result.pushed;
        setPushed(result.pushed);
      }
      unreported = true;
      show();
      const near = nodesInReach(walker.current, nodes, room.placements, pushedAt.current);
      for (const id of near) if (!inReach.current.has(id)) onApproach(id);
      inReach.current = near;
    };

    const wake = (): void => {
      if (frame) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
      reporter = window.setInterval(report, REPORT_MS);
    };

    const sleepIfIdle = (): void => {
      if (!frame || keys.size > 0 || drag?.walking) return;
      cancelAnimationFrame(frame);
      frame = 0;
      window.clearInterval(reporter);
      report();
    };

    const look = (dx: number, dy: number): void => {
      const body = walker.current;
      walker.current = { ...body, headingDeg: wrapDegrees(body.headingDeg + dx * LOOK_DEG_PER_PX), pitchDeg: clamp(body.pitchDeg - dy * LOOK_DEG_PER_PX, -MAX_PITCH_DEG, MAX_PITCH_DEG) };
      show();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      if (!(key in KEY_INTENT) || event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      event.preventDefault();
      keys.add(key);
      wake();
    };
    const onKeyUp = (event: KeyboardEvent): void => {
      if (keys.delete(event.key.toLowerCase())) sleepIfIdle();
    };
    const onBlur = (): void => {
      keys.clear();
      sleepIfIdle();
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
      element.setPointerCapture(event.pointerId);
      const walking = latest.current.phone && event.clientX < element.clientWidth / 2;
      drag = { id: event.pointerId, walking, fromX: event.clientX, fromY: event.clientY };
      if (walking) wake();
    };
    const onPointerMove = (event: PointerEvent): void => {
      if (!drag || event.pointerId !== drag.id) return;
      if (drag.walking) {
        pushing = { forward: stick(drag.fromY - event.clientY), strafe: stick(event.clientX - drag.fromX) };
        return;
      }
      look(event.clientX - drag.fromX, event.clientY - drag.fromY);
      drag.fromX = event.clientX;
      drag.fromY = event.clientY;
    };
    const onPointerEnd = (event: PointerEvent): void => {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      pushing = IDLE;
      sleepIfIdle();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerEnd);
    element.addEventListener('pointercancel', onPointerEnd);
    return () => {
      keys.clear();
      drag = null;
      sleepIfIdle();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerEnd);
      element.removeEventListener('pointercancel', onPointerEnd);
    };
  }, [stage, options.enabled]);

  return pushed;
}
