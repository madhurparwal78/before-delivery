import type { DesignObject, ObjectShape, Snapshot } from "../../shared/types";
import { displayColor } from "./palette";

/** One box, cylinder or sphere in world coordinates; groups are dissolved into their members. */
export interface Part {
  kind: ObjectShape;
  hole: boolean;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rotationZ: number;
  color: string;
}

const DEG = Math.PI / 180;

interface Turn {
  x: number;
  y: number;
  degrees: number;
}

/**
 * The primitives a list of design objects is made of, in creation order. A group contributes its members, turned by the
 * group's rotation about its centre, and a hole group makes every member a hole. Colours resolve to valid CSS colours.
 */
export function partsOf(objects: DesignObject[]): Part[] {
  const parts: Part[] = [];
  const add = (object: DesignObject, hole: boolean, turns: Turn[]) => {
    if (object.kind === "group") {
      const own: Turn = { x: object.x, y: object.y, degrees: object.rotationZ };
      for (const child of object.children) add(child, hole || object.mode === "hole", [own, ...turns]);
      return;
    }
    const placed = turns.reduce(rotateAbout, { x: object.x, y: object.y, degrees: 0 });
    parts.push({
      kind: object.kind, hole: hole || object.mode === "hole", x: placed.x, y: placed.y, z: object.z,
      w: object.w, d: object.d, h: object.h, rotationZ: object.rotationZ + placed.degrees,
      color: displayColor(object.color, parts.length),
    });
  };
  for (const object of objects) add(object, false, []);
  return parts;
}

/** Moves a point (and adds up its turn) when the group it belongs to rotates about its own centre. */
function rotateAbout(point: Turn, turn: Turn): Turn {
  if (turn.degrees % 360 === 0) return point;
  const cos = Math.cos(turn.degrees * DEG), sin = Math.sin(turn.degrees * DEG);
  const dx = point.x - turn.x, dy = point.y - turn.y;
  return { x: turn.x + dx * cos - dy * sin, y: turn.y + dx * sin + dy * cos, degrees: point.degrees + turn.degrees };
}

/** The design objects a snapshot shows in 3D: a 3D design's objects, or a Block Lab program's output. */
export function objectsOf(snapshot: Snapshot): DesignObject[] {
  return snapshot.kind === "circuit" ? [] : snapshot.objects;
}
