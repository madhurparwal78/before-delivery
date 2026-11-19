import type { Vec3 } from "../../shared/types";
import { snapFace } from "./model";
import type { WorkshopStore } from "./store";

export interface Hit {
  id: string;
  /** Outward normal of the face that was hit, in world space. */
  normal: Vec3;
}

/** What the pointer controls need from whichever view draws the scene. */
export interface PickView {
  pick: (clientX: number, clientY: number) => Hit | null;
  /** Where the pointer's ray meets the plane through `origin`; null when the ray runs too close to parallel with it. */
  planePoint: (clientX: number, clientY: number, origin: Vec3, normal: Vec3) => Vec3 | null;
}

interface Point {
  x: number;
  y: number;
}

type Gesture =
  | { kind: "none" }
  | { kind: "press"; id: number; start: Point; hit: Hit | null; shift: boolean; wasSelected: boolean; touch: boolean }
  | { kind: "orbit"; id: number; last: Point }
  | { kind: "move"; id: number; origin: Vec3; normal: Vec3; start: Vec3 }
  | { kind: "pinch"; span: number };

/** Pointer travel under which a press still counts as a click or tap. */
const CLICK_SLOP_PX = 4;
const WHEEL_ZOOM_PER_PX = 0.0015;
const LINE_PX = 16;
const PAGE_PX = 100;

const spread = (points: Map<number, Point>): number => {
  const [a, b] = [...points.values()];
  return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
};

/**
 * Click or tap selects (Shift toggles), a drag on a shape moves it on the workplane (touch: only a selected shape),
 * a drag on empty space orbits, a wheel or a two-finger pinch zooms.
 */
export function attachPointerControls(element: HTMLElement | SVGElement, view: PickView, store: WorkshopStore): () => void {
  const points = new Map<number, Point>();
  let gesture: Gesture = { kind: "none" };
  let shiftHeld = false;

  const trackShift = (event: KeyboardEvent) => { shiftHeld = event.shiftKey; };
  const dropShift = () => { shiftHeld = false; };

  const startMove = (press: Extract<Gesture, { kind: "press" }>): Gesture | null => {
    const { hit } = press;
    if (!hit || press.shift || (press.touch && !press.wasSelected)) return null;
    const { design, mode } = store.getState();
    const object = design.objects.find((candidate) => candidate.id === hit.id);
    if (!object || mode === "pickFace") return null;
    const origin: Vec3 = [object.x, object.y, object.z];
    const start = view.planePoint(press.start.x, press.start.y, origin, design.workplane.normal);
    if (!start || !store.beginMove()) return null;
    return { kind: "move", id: press.id, origin, normal: design.workplane.normal, start };
  };

  const onDown = (event: Event) => {
    const e = event as PointerEvent;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    element.setPointerCapture(e.pointerId);
    if (document.activeElement !== element && element instanceof HTMLElement) element.focus({ preventScroll: true });
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (points.size >= 2) {
      if (gesture.kind === "move") store.endMove();
      gesture = { kind: "pinch", span: spread(points) };
      return;
    }
    const hit = view.pick(e.clientX, e.clientY);
    const shift = e.shiftKey || shiftHeld;
    const touch = e.pointerType === "touch";
    const { selected, mode } = store.getState();
    const wasSelected = hit !== null && selected.includes(hit.id);
    if (hit && !touch && !shift && mode !== "pickFace" && !wasSelected) store.select([hit.id]);
    gesture = { kind: "press", id: e.pointerId, start: { x: e.clientX, y: e.clientY }, hit, shift, wasSelected, touch };
  };

  const onMove = (event: Event) => {
    const e = event as PointerEvent;
    if (!points.has(e.pointerId)) return;
    points.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const current = gesture;
    if (current.kind === "pinch") {
      const span = spread(points);
      if (span > 0 && current.span > 0) store.zoomBy(current.span / span);
      gesture = { kind: "pinch", span };
      return;
    }
    if (current.kind === "orbit" && current.id === e.pointerId) {
      store.orbitBy(e.clientX - current.last.x, e.clientY - current.last.y);
      gesture = { ...current, last: { x: e.clientX, y: e.clientY } };
      return;
    }
    if (current.kind === "move" && current.id === e.pointerId) {
      const point = view.planePoint(e.clientX, e.clientY, current.origin, current.normal);
      if (!point) return;
      const face = snapFace(current.normal);
      const delta: Vec3 = [point[0] - current.start[0], point[1] - current.start[1], point[2] - current.start[2]];
      const along = (axis: Vec3): number => Math.round(delta[0] * axis[0] + delta[1] * axis[1] + delta[2] * axis[2]);
      const [across, up] = [along(face.across), along(face.up)];
      store.moveBy([
        face.across[0] * across + face.up[0] * up,
        face.across[1] * across + face.up[1] * up,
        face.across[2] * across + face.up[2] * up,
      ]);
      return;
    }
    if (current.kind !== "press" || current.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - current.start.x, e.clientY - current.start.y) < CLICK_SLOP_PX) return;
    const moving = startMove(current);
    if (moving) {
      gesture = moving;
    } else if (current.shift && current.hit) {
      gesture = { kind: "none" };
    } else {
      store.orbitBy(e.clientX - current.start.x, e.clientY - current.start.y);
      gesture = { kind: "orbit", id: e.pointerId, last: { x: e.clientX, y: e.clientY } };
    }
  };

  const finish = (event: Event, clicked: boolean) => {
    const e = event as PointerEvent;
    if (!points.delete(e.pointerId)) return;
    if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
    const current = gesture;
    gesture = { kind: "none" };
    if (current.kind === "move") {
      store.endMove();
      return;
    }
    if (current.kind !== "press" || !clicked || current.id !== e.pointerId) return;
    const { hit } = current;
    if (store.getState().mode === "pickFace") {
      if (hit) store.pickFace(hit.id, hit.normal);
    } else if (hit) {
      if (current.shift) store.toggleSelected(hit.id);
      else store.select([hit.id]);
    } else if (!current.shift) {
      store.select([]);
    }
  };

  const onUp = (event: Event) => finish(event, true);
  const onCancel = (event: Event) => finish(event, false);

  const onWheel = (event: Event) => {
    const e = event as WheelEvent;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? PAGE_PX : 1;
    store.zoomBy(Math.exp(e.deltaY * unit * WHEEL_ZOOM_PER_PX));
  };

  element.addEventListener("pointerdown", onDown);
  element.addEventListener("pointermove", onMove);
  element.addEventListener("pointerup", onUp);
  element.addEventListener("pointercancel", onCancel);
  element.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", trackShift, true);
  window.addEventListener("keyup", trackShift, true);
  window.addEventListener("blur", dropShift);
  return () => {
    element.removeEventListener("pointerdown", onDown);
    element.removeEventListener("pointermove", onMove);
    element.removeEventListener("pointerup", onUp);
    element.removeEventListener("pointercancel", onCancel);
    element.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", trackShift, true);
    window.removeEventListener("keyup", trackShift, true);
    window.removeEventListener("blur", dropShift);
  };
}
