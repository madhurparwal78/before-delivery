// Object snaps and the other drafting aids (brief: Interactions > Object snaps, Other drafting aids).
// Candidates are exactly the server's: each object's `snaps` plus the drawing's `intersections`.
import { visibleLayerNames } from '../../../shared/geometry.ts';
import type { ApiObject, DrawingView, Point, Snaps } from '../../../shared/types.ts';
import { expects } from '../commandLine/machine.ts';
import type { Aids, EditorStore } from '../store.ts';
import { scaleOf, toModel } from './camera.ts';

const SNAP_KINDS = ['Endpoint', 'Midpoint', 'Center', 'Intersection'] as const;
export type SnapKind = (typeof SNAP_KINDS)[number];
export interface Candidate { kind: SnapKind; point: Point }

const MOUSE_APERTURE_PX = 10;
const TOUCH_APERTURE_PX = 24;
export const GRID_MM = 100;
const POLAR_STEP_DEG = 45;

const KIND_OF_SNAPS: Record<keyof Snaps, SnapKind> = { endpoint: 'Endpoint', midpoint: 'Midpoint', center: 'Center' };
const SNAP_KEYS = ['endpoint', 'midpoint', 'center'] as const satisfies readonly (keyof Snaps)[];

function candidatesOfObjects(objects: ApiObject[], into: Map<string, Candidate>): void {
  for (const object of objects) {
    for (const key of SNAP_KEYS) {
      for (const point of object.snaps[key]) into.set(`${key}:${point[0]},${point[1]}`, { kind: KIND_OF_SNAPS[key], point });
    }
  }
}

const cache = new WeakMap<DrawingView, Candidate[]>();

function collect(drawing: DrawingView, exclude?: ReadonlySet<string>): Candidate[] {
  const found = new Map<string, Candidate>();
  const visible = visibleLayerNames(drawing.layers);
  candidatesOfObjects(drawing.objects.filter((object) => visible.has(object.layer) && !exclude?.has(object.handle)), found);
  for (const xref of drawing.xrefs) if (xref.status === 'loaded') candidatesOfObjects(xref.objects, found);
  for (const point of drawing.intersections) found.set(`Intersection:${point[0]},${point[1]}`, { kind: 'Intersection', point });
  return [...found.values()];
}

/** Every snap candidate of the drawing: base objects on visible layers, loaded xref objects and intersections. */
function candidatesOf(drawing: DrawingView, exclude?: ReadonlySet<string>): Candidate[] {
  if (exclude) return collect(drawing, exclude);
  const cached = cache.get(drawing);
  if (cached) return cached;
  const list = collect(drawing);
  cache.set(drawing, list);
  return list;
}

/** Candidates inside `aperturePx` of the model point, nearest first and, on a tie, in the order Endpoint, Midpoint, Center, Intersection. */
function candidatesNear(candidates: Candidate[], model: Point, scale: number, aperturePx: number): Candidate[] {
  const radius = aperturePx / scale;
  const near: { candidate: Candidate; distance: number }[] = [];
  for (const candidate of candidates) {
    const distance = Math.hypot(candidate.point[0] - model[0], candidate.point[1] - model[1]);
    if (distance <= radius) near.push({ candidate, distance });
  }
  near.sort((a, b) => a.distance - b.distance || SNAP_KINDS.indexOf(a.candidate.kind) - SNAP_KINDS.indexOf(b.candidate.kind));
  return near.map((entry) => entry.candidate);
}

/** The candidates around the pointer for the awaited point, empty when no snap applies right now. */
export function snapsAtPointer(store: EditorStore, exclude?: ReadonlySet<string>): Candidate[] {
  const { drawing, aids, machine, layout } = store.current;
  const { pointer, cleared } = store.hud.get();
  if (!drawing || !pointer || cleared || !aids.osnap || layout !== 'Model') return [];
  if (!exclude && expects(machine) !== 'point') return [];
  const camera = store.camera.get();
  const model = toModel(camera, pointer.x, pointer.y);
  const base = candidatesOf(drawing, exclude);
  const trace = store.current.activeTrace?.state === 'open' ? traceCandidates(store.current.activeTrace.objects) : [];
  return candidatesNear([...base, ...trace], model, scaleOf(camera), pointer.touch ? TOUCH_APERTURE_PX : MOUSE_APERTURE_PX);
}

function traceCandidates(objects: ApiObject[]): Candidate[] {
  const found = new Map<string, Candidate>();
  candidatesOfObjects(objects, found);
  return [...found.values()];
}

/** The candidate whose marker shows now, after any Tab cycling. */
export function snapNow(store: EditorStore, exclude?: ReadonlySet<string>): Candidate | null {
  const list = snapsAtPointer(store, exclude);
  return list[store.hud.get().cycle % Math.max(list.length, 1)] ?? null;
}

/** Applies grid, then ORTHO or POLAR from `anchor`, to a picked point that no snap marker claimed. */
export function constrain(raw: Point, aids: Aids, anchor: Point | null): Point {
  let point = aids.grid ? [Math.round(raw[0] / GRID_MM) * GRID_MM, Math.round(raw[1] / GRID_MM) * GRID_MM] as Point : raw;
  if (!anchor) return point;
  const dx = point[0] - anchor[0];
  const dy = point[1] - anchor[1];
  if (aids.ortho) point = Math.abs(dx) >= Math.abs(dy) ? [point[0], anchor[1]] : [anchor[0], point[1]];
  else if (aids.polar) {
    const step = (POLAR_STEP_DEG * Math.PI) / 180;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    const length = Math.hypot(dx, dy);
    point = [anchor[0] + length * Math.cos(angle), anchor[1] + length * Math.sin(angle)];
  }
  return point;
}
