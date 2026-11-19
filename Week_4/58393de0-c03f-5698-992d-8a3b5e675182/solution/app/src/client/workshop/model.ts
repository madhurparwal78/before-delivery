import { DESIGN_OBJECT_MAX, NEW_SHAPE_MM, SIZE_MAX_MM, SIZE_MIN_MM, UNDO_DEPTH } from "../../shared/limits";
import type { DesignObject, ObjectMode, ObjectShape, Vec3, Workplane } from "../../shared/types";

/** The document the Workshop edits: the top-level objects and the workplane new shapes land on. */
export interface Design {
  objects: DesignObject[];
  workplane: Workplane;
}

export type Axis = "x" | "y" | "z";
export type SizeField = "w" | "d" | "h";

interface Box {
  min: Vec3;
  max: Vec3;
}

export const GROUND: Workplane = { origin: [0, 0, 0], normal: [0, 0, 1] };

/** Rounded to a tenth or a hundredth; never negative zero. */
const round1 = (value: number): number => Math.round(value * 10) / 10 + 0;
const round2 = (value: number): number => Math.round(value * 100) / 100 + 0;

/** An angle folded into 0 up to (not including) 360. */
const foldDegrees = (degrees: number): number => ((degrees % 360) + 360) % 360;

/** The published form of a turn: whole degrees, 0 to 359. */
export const wholeDegrees = (degrees: number): number => Math.round(foldDegrees(degrees)) % 360;

const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/* ---------- workplane faces ---------- */

type FaceName = "top" | "bottom" | "front" | "back" | "left" | "right";

export interface Face {
  name: FaceName;
  normal: Vec3;
  /** World direction of the workplane's own +X. */
  across: Vec3;
  /** World direction of the workplane's own +Y. */
  up: Vec3;
}

const TOP: Face = { name: "top", normal: [0, 0, 1], across: [1, 0, 0], up: [0, 1, 0] };
const BOTTOM: Face = { name: "bottom", normal: [0, 0, -1], across: [1, 0, 0], up: [0, -1, 0] };
const RIGHT: Face = { name: "right", normal: [1, 0, 0], across: [0, 1, 0], up: [0, 0, 1] };
const LEFT: Face = { name: "left", normal: [-1, 0, 0], across: [0, -1, 0], up: [0, 0, 1] };
const BACK: Face = { name: "back", normal: [0, 1, 0], across: [-1, 0, 0], up: [0, 0, 1] };
const FRONT: Face = { name: "front", normal: [0, -1, 0], across: [1, 0, 0], up: [0, 0, 1] };

/** In tie-break order: +Z, -Z, +X, -X, +Y, -Y. */
const FACES: readonly Face[] = [TOP, BOTTOM, RIGHT, LEFT, BACK, FRONT];

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const plus = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const times = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];

/** The nearest of the six axis directions to `direction`; a tie goes to the first of +Z, -Z, +X, -X, +Y, -Y. */
export function snapFace(direction: Vec3): Face {
  let best = TOP;
  let bestDot = -Infinity;
  for (const face of FACES) {
    const alignment = dot(face.normal, direction);
    if (alignment > bestDot + 1e-9) {
      best = face;
      bestDot = alignment;
    }
  }
  return best;
}

export type MoveKey = "right" | "left" | "up" | "down" | "raise" | "lower";

/** A move of `amount` mm along the workplane's own axes (right/up) or its normal (raise/lower), in world space. */
export function moveVector(workplane: Workplane, key: MoveKey, amount: number): Vec3 {
  const face = snapFace(workplane.normal);
  switch (key) {
    case "right": return times(face.across, amount);
    case "left": return times(face.across, -amount);
    case "up": return times(face.up, amount);
    case "down": return times(face.up, -amount);
    case "raise": return times(face.normal, amount);
    case "lower": return times(face.normal, -amount);
  }
}

/* ---------- object geometry ---------- */

/** Half the extents of the object's world bounding box on x and y, with its turn about Z applied. */
function halfSpanXY(object: DesignObject): [number, number] {
  const angle = radians(object.rotationZ);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  if (object.kind === "box" || object.kind === "group") {
    return [(object.w * Math.abs(c) + object.d * Math.abs(s)) / 2, (object.w * Math.abs(s) + object.d * Math.abs(c)) / 2];
  }
  const a = object.w / 2;
  const b = object.d / 2;
  return [Math.hypot(a * c, b * s), Math.hypot(a * s, b * c)];
}

/** The object's world bounding box. */
export function worldBounds(object: DesignObject): Box {
  const [hx, hy] = halfSpanXY(object);
  const hz = object.h / 2;
  return {
    min: [object.x - hx, object.y - hy, object.z - hz],
    max: [object.x + hx, object.y + hy, object.z + hz],
  };
}

/** Centre of the side of the object's world bounding box that faces `normal`. */
export function faceOrigin(object: DesignObject, normal: Vec3): Vec3 {
  const { min, max } = worldBounds(object);
  const pick = (axis: 0 | 1 | 2): number => {
    const n = normal[axis];
    if (n > 0) return max[axis];
    if (n < 0) return min[axis];
    return (min[axis] + max[axis]) / 2;
  };
  return [round2(pick(0)), round2(pick(1)), round2(pick(2))];
}

/** The workplane on the face of `object` that points along `direction` (snapped to an axis). */
export function workplaneOnFace(object: DesignObject, direction: Vec3): Workplane {
  const face = snapFace(direction);
  return { origin: faceOrigin(object, face.normal), normal: face.normal };
}

function sameWorkplane(a: Workplane, b: Workplane): boolean {
  return a.origin.every((v, i) => v === b.origin[i]) && a.normal.every((v, i) => v === b.normal[i]);
}

/* ---------- editing ---------- */

const rounded = (value: Vec3): Vec3 => [round2(value[0]), round2(value[1]), round2(value[2])];

function withObjects(design: Design, objects: DesignObject[]): Design {
  return { ...design, objects };
}

/** Replaces the listed objects through `change`; returns `design` itself when nothing changed. */
function mapSelected(design: Design, ids: readonly string[], change: (object: DesignObject) => DesignObject): Design {
  let changed = false;
  const objects = design.objects.map((object) => {
    if (!ids.includes(object.id)) return object;
    const next = change(object);
    if (next !== object) changed = true;
    return next;
  });
  return changed ? withObjects(design, objects) : design;
}

/** The object moved by `delta`; a group's members move with it, so their world coordinates stay true. */
function translateObject(object: DesignObject, delta: Vec3): DesignObject {
  const [x, y, z] = rounded(plus([object.x, object.y, object.z], delta));
  return { ...object, x, y, z, children: object.children.map((child) => translateObject(child, delta)) };
}

export function translate(design: Design, ids: readonly string[], delta: Vec3): Design {
  return mapSelected(design, ids, (object) => translateObject(object, delta));
}

/** Turns each listed object about the vertical axis through its own centre. */
export function turn(design: Design, ids: readonly string[], degrees: number): Design {
  return mapSelected(design, ids, (object) => ({ ...object, rotationZ: foldDegrees(object.rotationZ + degrees) }));
}

export function setMode(design: Design, ids: readonly string[], mode: ObjectMode): Design {
  return mapSelected(design, ids, (object) => (object.mode === mode ? object : { ...object, mode }));
}

/** The mode a toggle (the `H` key) moves a selection to: all holes become solid, anything else becomes hole. */
export function toggledMode(objects: readonly DesignObject[]): ObjectMode {
  return objects.length > 0 && objects.every((object) => object.mode === "hole") ? "solid" : "hole";
}

/** `size` accepted as a sizing value: 0.1 to 1000 mm, kept to one decimal. Null when out of range or not a number. */
export function parseSize(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < SIZE_MIN_MM || value > SIZE_MAX_MM) return null;
  return round1(value);
}

/**
 * Sets one size of each listed shape. A cylinder keeps width and depth equal, a sphere keeps all three equal, and the
 * bottom-centre point stays where it was. Groups have no size of their own and are left alone.
 */
export function resize(design: Design, ids: readonly string[], field: SizeField, value: number): Design {
  return mapSelected(design, ids, (object) => {
    if (object.kind === "group") return object;
    const follows = (target: SizeField): boolean =>
      field === target || object.kind === "sphere" || (object.kind === "cylinder" && field !== "h" && target !== "h");
    const next = {
      ...object,
      w: follows("w") ? value : object.w,
      d: follows("d") ? value : object.d,
      h: follows("h") ? value : object.h,
    };
    if (next.w === object.w && next.d === object.d && next.h === object.h) return object;
    return { ...next, z: round2(object.z - object.h / 2 + next.h / 2) };
  });
}

/** Sets each listed object's centre on `axis` to the centre of the whole selection's bounding box. */
export function align(design: Design, ids: readonly string[], axis: Axis): Design {
  const index = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const chosen = design.objects.filter((object) => ids.includes(object.id));
  if (chosen.length === 0) return design;
  const low = Math.min(...chosen.map((object) => worldBounds(object).min[index]));
  const high = Math.max(...chosen.map((object) => worldBounds(object).max[index]));
  const middle = round2((low + high) / 2);
  return mapSelected(design, ids, (object) => {
    if (object[axis] === middle) return object;
    const delta: Vec3 = [0, 0, 0];
    delta[index] = middle - object[axis];
    return translateObject(object, delta);
  });
}

export function removeObjects(design: Design, ids: readonly string[]): Design {
  const objects = design.objects.filter((object) => !ids.includes(object.id));
  return objects.length === design.objects.length ? design : withObjects(design, objects);
}

/** A new shape resting on the workplane: centre = origin + normal * half the shape's extent along the normal. */
export function addShape(design: Design, kind: ObjectShape, id: string, color: string): Design | null {
  if (design.objects.length >= DESIGN_OBJECT_MAX) return null;
  const { origin, normal } = design.workplane;
  const half = NEW_SHAPE_MM / 2;
  const [x, y, z] = rounded([origin[0] + normal[0] * half, origin[1] + normal[1] * half, origin[2] + normal[2] * half]);
  const shape: DesignObject = {
    id, kind, mode: "solid", x, y, z, w: NEW_SHAPE_MM, d: NEW_SHAPE_MM, h: NEW_SHAPE_MM, rotationZ: 0, color, children: [],
  };
  return withObjects(design, [...design.objects, shape]);
}

export function setWorkplane(design: Design, workplane: Workplane): Design {
  return sameWorkplane(design.workplane, workplane) ? design : { ...design, workplane };
}

/* ---------- groups ---------- */

type GroupProblem = "select-two" | "needs-solid";

/** Why these objects cannot be grouped, or null when they can. */
export function groupProblem(members: readonly DesignObject[]): GroupProblem | null {
  if (members.length < 2) return "select-two";
  return members.some((member) => member.mode === "solid") ? null : "needs-solid";
}

export function membersOf(design: Design, ids: readonly string[]): DesignObject[] {
  return design.objects.filter((object) => ids.includes(object.id));
}

/** A solid group of `members` for the geometry worker to resolve; its own box is filled in from the result. */
export function groupDraft(members: readonly DesignObject[], id: string): DesignObject {
  const first = members.find((member) => member.mode === "solid") ?? members[0];
  return {
    id, kind: "group", mode: "solid", x: 0, y: 0, z: 0, w: 0, d: 0, h: 0, rotationZ: 0,
    color: first?.color ?? "", children: [...members],
  };
}

/** The draft with x,y,z at the centre of the result's bounding box and w,d,h that box. */
export function groupFromBounds(draft: DesignObject, bounds: Box): DesignObject {
  const centre = (axis: 0 | 1 | 2): number => round2((bounds.min[axis] + bounds.max[axis]) / 2);
  const span = (axis: 0 | 1 | 2): number => round1(bounds.max[axis] - bounds.min[axis]);
  return { ...draft, x: centre(0), y: centre(1), z: centre(2), w: span(0), d: span(1), h: span(2) };
}

/** Puts `group` where the first member stood and removes the other members. */
export function replaceWithGroup(design: Design, members: readonly DesignObject[], group: DesignObject): Design {
  const first = members[0];
  const objects: DesignObject[] = [];
  for (const object of design.objects) {
    if (object === first) objects.push(group);
    else if (!members.includes(object)) objects.push(object);
  }
  return withObjects(design, objects);
}

function turnAbout(child: DesignObject, pivot: { x: number; y: number }, degrees: number): DesignObject {
  const angle = radians(degrees);
  const dx = child.x - pivot.x;
  const dy = child.y - pivot.y;
  const x = round2(pivot.x + dx * Math.cos(angle) - dy * Math.sin(angle));
  const y = round2(pivot.y + dx * Math.sin(angle) + dy * Math.cos(angle));
  const turned = { ...child, x, y, rotationZ: foldDegrees(child.rotationZ + degrees) };
  if (child.kind !== "group") return turned;
  return { ...turned, children: child.children.map((member) => translateObject(member, [x - child.x, y - child.y, 0])) };
}

/** The members of a group as top-level objects again: carried by the group's turn about its centre. */
export function release(group: DesignObject): DesignObject[] {
  if (group.rotationZ === 0) return group.children;
  return group.children.map((child) => turnAbout(child, group, group.rotationZ));
}

/** Replaces each listed group by its members. Null when no listed object is a group or the design would grow too large. */
export function ungroup(design: Design, ids: readonly string[]): { design: Design; released: DesignObject[] } | null {
  const groups = design.objects.filter((object) => object.kind === "group" && ids.includes(object.id));
  if (groups.length === 0) return null;
  const released: DesignObject[] = [];
  const objects = design.objects.flatMap((object) => {
    if (!groups.includes(object)) return [object];
    const members = release(object);
    released.push(...members);
    return members;
  });
  return { design: withObjects(design, objects), released };
}

export function ungroupFits(design: Design, ids: readonly string[]): boolean {
  const groups = design.objects.filter((object) => object.kind === "group" && ids.includes(object.id));
  const grown = groups.reduce((total, group) => total + group.children.length - 1, 0);
  return design.objects.length + grown <= DESIGN_OBJECT_MAX;
}

/* ---------- selection ---------- */

/** The ids that still exist, in creation order. */
export function inCreationOrder(design: Design, ids: Iterable<string>): string[] {
  const wanted = new Set(ids);
  return design.objects.filter((object) => wanted.has(object.id)).map((object) => object.id);
}

/**
 * The object Tab (direction 1) or Shift+Tab (-1) selects next, or null when focus should leave the workplane: past the
 * last object, before the first, or Shift+Tab with nothing selected.
 */
export function tabTarget(design: Design, selected: readonly string[], direction: 1 | -1): string | null {
  const positions = design.objects.flatMap((object, index) => (selected.includes(object.id) ? [index] : []));
  if (positions.length === 0) return direction === 1 ? (design.objects[0]?.id ?? null) : null;
  const edge = direction === 1 ? Math.max(...positions) : Math.min(...positions);
  return design.objects[edge + direction]?.id ?? null;
}

export function toggleId(selected: readonly string[], id: string): string[] {
  return selected.includes(id) ? selected.filter((other) => other !== id) : [...selected, id];
}

/* ---------- undo history ---------- */

export interface Entry {
  design: Design;
  selected: string[];
}

export interface History {
  past: Entry[];
  future: Entry[];
}

export const EMPTY_HISTORY: History = { past: [], future: [] };

/** `entry` becomes the newest undo step; the redo steps are dropped and only the last 100 undo steps are kept. */
export function record(history: History, entry: Entry): History {
  return { past: [...history.past, entry].slice(-UNDO_DEPTH), future: [] };
}

/** One step back: the entry to restore and the history after it, with `present` queued for redo. */
export function stepBack(history: History, present: Entry): { history: History; restore: Entry } | null {
  const restore = history.past[history.past.length - 1];
  if (!restore) return null;
  return { restore, history: { past: history.past.slice(0, -1), future: [...history.future, present] } };
}

export function stepForward(history: History, present: Entry): { history: History; restore: Entry } | null {
  const restore = history.future[history.future.length - 1];
  if (!restore) return null;
  return { restore, history: { past: [...history.past, present].slice(-UNDO_DEPTH), future: history.future.slice(0, -1) } };
}

/* ---------- published numbers ---------- */

/** Up to `decimals` decimals with no trailing zeros. */
export function trimmed(value: number, decimals: number): string {
  const scale = 10 ** decimals;
  return String(Math.round(value * scale) / scale);
}

export const vectorText = (value: Vec3): string => value.map((part) => trimmed(part, 2)).join(",");
