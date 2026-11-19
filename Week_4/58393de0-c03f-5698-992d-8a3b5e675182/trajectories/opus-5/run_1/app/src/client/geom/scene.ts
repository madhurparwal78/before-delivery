import type { SceneObject, Workplane } from '../../shared/types.js';
import { solidsMinusHoles } from './csg.js';
import { exactVolume, primitiveMesh, primitiveTriangles } from './primitives.js';
import {
  mergeBoxes,
  meshBox,
  meshVolume,
  rotateZ,
  transformMesh,
  type Box,
  type Mesh,
  type Vec3,
} from './mesh.js';

export type FaceName = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right';

export const FACE_NORMALS: { face: FaceName; normal: Vec3 }[] = [
  { face: 'top', normal: [0, 0, 1] },
  { face: 'bottom', normal: [0, 0, -1] },
  { face: 'right', normal: [1, 0, 0] },
  { face: 'left', normal: [-1, 0, 0] },
  { face: 'front', normal: [0, -1, 0] },
  { face: 'back', normal: [0, 1, 0] },
];

/** Snapping order for a picked face: a tie goes to the first of +Z, −Z, +X, −X, +Y, −Y. */
const SNAP_ORDER: Vec3[] = [
  [0, 0, 1],
  [0, 0, -1],
  [1, 0, 0],
  [-1, 0, 0],
  [0, -1, 0],
  [0, 1, 0],
];

export const snapToAxis = (normal: Vec3): Vec3 => {
  let best = SNAP_ORDER[0];
  let bestDot = -Infinity;
  for (const candidate of SNAP_ORDER) {
    const dot = candidate[0] * normal[0] + candidate[1] * normal[1] + candidate[2] * normal[2];
    if (dot > bestDot + 1e-9) {
      bestDot = dot;
      best = candidate;
    }
  }
  return best;
};

export const faceOfNormal = (normal: Vec3): FaceName => {
  const match = FACE_NORMALS.find(
    (entry) => entry.normal[0] === normal[0] && entry.normal[1] === normal[1] && entry.normal[2] === normal[2],
  );
  return match ? match.face : 'top';
};

/** Each workplane's own in-plane axes, used by the arrow keys and pointer moves. */
export const workplaneAxes = (normal: Vec3): { x: Vec3; y: Vec3 } => {
  const key = normal.join(',');
  switch (key) {
    case '0,0,-1':
      return { x: [1, 0, 0], y: [0, -1, 0] };
    case '0,-1,0':
      return { x: [1, 0, 0], y: [0, 0, 1] };
    case '0,1,0':
      return { x: [-1, 0, 0], y: [0, 0, 1] };
    case '1,0,0':
      return { x: [0, 1, 0], y: [0, 0, 1] };
    case '-1,0,0':
      return { x: [0, -1, 0], y: [0, 0, 1] };
    default:
      return { x: [1, 0, 0], y: [0, 1, 0] };
  }
};

export const defaultWorkplane = (): Workplane => ({ origin: [0, 0, 0], normal: [0, 0, 1] });

/** A new shape keeps world orientation and rests on the workplane. */
export const placeOnWorkplane = (workplane: Workplane, w: number, d: number, h: number): Vec3 => {
  const [nx, ny, nz] = workplane.normal;
  const extent = Math.abs(nz) > 0.5 ? h : Math.abs(ny) > 0.5 ? d : w;
  const half = extent / 2;
  return [
    round2(workplane.origin[0] + nx * half),
    round2(workplane.origin[1] + ny * half),
    round2(workplane.origin[2] + nz * half),
  ];
};

export const round2 = (value: number): number => Math.round(value * 100) / 100;
export const round1 = (value: number): number => Math.round(value * 10) / 10;

export const primitiveWorldMesh = (object: SceneObject): Mesh => {
  const local = primitiveMesh(object.kind as 'box' | 'cylinder' | 'sphere', object.w, object.d, object.h);
  return transformMesh(local, (point) => {
    const turned = rotateZ(point, object.rotationZ);
    return [turned[0] + object.x, turned[1] + object.y, turned[2] + object.z];
  });
};

export interface GroupResult {
  mesh: Mesh;
  volume: number;
  triangleCount: number;
  box: Box;
}

/** Flattens a group to its primitive members in world coordinates. */
export const flattenMembers = (object: SceneObject): SceneObject[] => {
  if (object.kind !== 'group') return [object];
  const members: SceneObject[] = [];
  for (const child of object.children) members.push(...flattenMembers(child));
  if (object.rotationZ === 0) return members;
  return members.map((member) => {
    const moved = rotateZ([member.x - object.x, member.y - object.y, member.z - object.z], object.rotationZ);
    return {
      ...member,
      x: round2(moved[0] + object.x),
      y: round2(moved[1] + object.y),
      z: round2(moved[2] + object.z),
      rotationZ: (member.rotationZ + object.rotationZ + 360) % 360,
    };
  });
};

export const computeGroupResult = (members: SceneObject[]): GroupResult => {
  const solids = members.filter((member) => member.mode === 'solid').map(primitiveWorldMesh);
  const holes = members.filter((member) => member.mode === 'hole').map(primitiveWorldMesh);
  const mesh = solidsMinusHoles(solids, holes);
  return {
    mesh,
    volume: Math.round(meshVolume(mesh)),
    triangleCount: mesh.triangles.length,
    box: mesh.triangles.length === 0 ? { min: [0, 0, 0], max: [0, 0, 0] } : meshBox(mesh),
  };
};

export const primitiveBox = (object: SceneObject): Box => {
  const mesh = primitiveWorldMesh(object);
  return meshBox(mesh);
};

export const objectBox = (object: SceneObject, groupBoxes: Map<string, Box>): Box => {
  if (object.kind !== 'group') return primitiveBox(object);
  const known = groupBoxes.get(object.id);
  if (known) return known;
  const half: Vec3 = [object.w / 2, object.d / 2, object.h / 2];
  return {
    min: [object.x - half[0], object.y - half[1], object.z - half[2]],
    max: [object.x + half[0], object.y + half[1], object.z + half[2]],
  };
};

export const selectionBox = (objects: SceneObject[], groupBoxes: Map<string, Box>): Box =>
  mergeBoxes(objects.map((object) => objectBox(object, groupBoxes)));

export const primitiveVolume = (object: SceneObject): number =>
  object.mode === 'hole'
    ? 0
    : Math.round(exactVolume(object.kind as 'box' | 'cylinder' | 'sphere', object.w, object.d, object.h));

export const primitiveTriangleCount = (object: SceneObject): number =>
  primitiveTriangles(object.kind as 'box' | 'cylinder' | 'sphere');
