import type { Breakpoint, SceneCamera, Vec3 } from './types';
import { ARTBOARDS } from './types';
import type { PrimitiveKind } from './properties';

export const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
export const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

export const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const addVec = (a: Vec3, b: Vec3): Vec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const subVec = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const scaleVec = (a: Vec3, s: number): Vec3 => vec(a.x * s, a.y * s, a.z * s);
export const dotVec = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const crossVec = (a: Vec3, b: Vec3): Vec3 =>
  vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const lengthVec = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const normaliseVec = (a: Vec3): Vec3 => {
  const length = lengthVec(a);
  return length === 0 ? vec(0, 0, 0) : scaleVec(a, 1 / length);
};

export interface Transform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

/** v' = T · Rz · Ry · Rx · S · v */
export function applyTransform(local: Vec3, transform: Transform): Vec3 {
  let x = local.x * transform.scale.x;
  let y = local.y * transform.scale.y;
  let z = local.z * transform.scale.z;

  const cx = Math.cos(toRadians(transform.rotation.x));
  const sx = Math.sin(toRadians(transform.rotation.x));
  const y1 = y * cx - z * sx;
  const z1 = y * sx + z * cx;
  y = y1;
  z = z1;

  const cy = Math.cos(toRadians(transform.rotation.y));
  const sy = Math.sin(toRadians(transform.rotation.y));
  const x1 = x * cy + z * sy;
  const z2 = -x * sy + z * cy;
  x = x1;
  z = z2;

  const cz = Math.cos(toRadians(transform.rotation.z));
  const sz = Math.sin(toRadians(transform.rotation.z));
  const x2 = x * cz - y * sz;
  const y2 = x * sz + y * cz;
  x = x2;
  y = y2;

  return vec(x + transform.position.x, y + transform.position.y, z + transform.position.z);
}

export interface CameraBasis {
  xAxis: Vec3;
  yAxis: Vec3;
  zAxis: Vec3;
  position: Vec3;
}

export function cameraBasis(position: Vec3, target: Vec3): CameraBasis {
  const zAxis = normaliseVec(subVec(position, target));
  let xAxis = crossVec(vec(0, 1, 0), zAxis);
  if (lengthVec(xAxis) === 0) xAxis = vec(1, 0, 0);
  else xAxis = normaliseVec(xAxis);
  const yAxis = crossVec(zAxis, xAxis);
  return { xAxis, yAxis, zAxis, position };
}

export function toCameraSpace(world: Vec3, basis: CameraBasis): Vec3 {
  const relative = subVec(world, basis.position);
  return vec(dotVec(relative, basis.xAxis), dotVec(relative, basis.yAxis), dotVec(relative, basis.zAxis));
}

export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}

export function artboardOf(breakpoint: Breakpoint): { width: number; height: number } {
  return ARTBOARDS[breakpoint];
}

/** Camera with the scroll orbit applied, if any. */
export function orbitedCamera(camera: SceneCamera, azimuthDegrees: number | null): SceneCamera {
  if (azimuthDegrees === null) return camera;
  const dx = camera.position.x - camera.target.x;
  const dz = camera.position.z - camera.target.z;
  const distance = Math.hypot(dx, dz);
  const angle = toRadians(azimuthDegrees);
  return {
    ...camera,
    position: {
      x: camera.target.x + Math.sin(angle) * distance,
      y: camera.position.y,
      z: camera.target.z + Math.cos(angle) * distance,
    },
  };
}

export function projectPoint(
  world: Vec3,
  camera: SceneCamera,
  breakpoint: Breakpoint,
  viewport?: { width: number; height: number },
): ScreenPoint {
  const artboard = viewport ?? artboardOf(breakpoint);
  const basis = cameraBasis(
    vec(camera.position.x, camera.position.y, camera.position.z),
    vec(camera.target.x, camera.target.y, camera.target.z),
  );
  const cameraSpace = toCameraSpace(world, basis);
  const depth = -cameraSpace.z;
  const f = 1 / Math.tan(toRadians(camera.fov) / 2);
  const aspect = artboard.width / artboard.height;
  const ndcX = (f / aspect) * (cameraSpace.x / depth);
  const ndcY = f * (cameraSpace.y / depth);
  return {
    x: ((ndcX + 1) / 2) * artboard.width,
    y: ((1 - ndcY) / 2) * artboard.height,
    visible: depth >= camera.near && depth <= camera.far,
  };
}

export const CUBE_CORNER_NAMES = [
  '+x +y +z',
  '-x +y +z',
  '+x -y +z',
  '-x -y +z',
  '+x +y -z',
  '-x +y -z',
  '+x -y -z',
  '-x -y -z',
] as const;

export const PLANE_CORNER_NAMES = ['+x +y', '-x +y', '+x -y', '-x -y'] as const;

const SIGNS: Record<string, number> = { '+': 1, '-': -1 };

/** Corner offsets for a box with the given half-extents, in cube corner order. */
export function boxCorners(half: Vec3): { name: string; point: Vec3 }[] {
  return CUBE_CORNER_NAMES.map((name) => {
    const parts = name.split(' ');
    return {
      name,
      point: vec(
        SIGNS[parts[0][0]] * half.x,
        SIGNS[parts[1][0]] * half.y,
        SIGNS[parts[2][0]] * half.z,
      ),
    };
  });
}

export function planeCorners(): { name: string; point: Vec3 }[] {
  return PLANE_CORNER_NAMES.map((name) => {
    const parts = name.split(' ');
    return { name, point: vec(SIGNS[parts[0][0]] * 0.5, SIGNS[parts[1][0]] * 0.5, 0) };
  });
}

export const PRIMITIVE_TRIANGLES: Record<PrimitiveKind, number> = {
  Cube: 12,
  Sphere: 960,
  Cylinder: 128,
  Torus: 1536,
  Plane: 2,
};

export const PRIMITIVE_HALF_EXTENTS: Record<PrimitiveKind, Vec3> = {
  Cube: vec(0.5, 0.5, 0.5),
  Sphere: vec(0.5, 0.5, 0.5),
  Cylinder: vec(0.5, 0.5, 0.5),
  Torus: vec(0.65, 0.65, 0.15),
  Plane: vec(0.5, 0.5, 0),
};

export interface Mesh {
  positions: number[];
  indices: number[];
}

function pushTriangle(mesh: Mesh, a: number, b: number, c: number): void {
  mesh.indices.push(a, b, c);
}

function addVertex(mesh: Mesh, p: Vec3): number {
  mesh.positions.push(p.x, p.y, p.z);
  return mesh.positions.length / 3 - 1;
}

export function primitiveMesh(kind: PrimitiveKind): Mesh {
  const mesh: Mesh = { positions: [], indices: [] };
  if (kind === 'Cube') {
    const corners: Vec3[] = [
      vec(-0.5, -0.5, -0.5),
      vec(0.5, -0.5, -0.5),
      vec(0.5, 0.5, -0.5),
      vec(-0.5, 0.5, -0.5),
      vec(-0.5, -0.5, 0.5),
      vec(0.5, -0.5, 0.5),
      vec(0.5, 0.5, 0.5),
      vec(-0.5, 0.5, 0.5),
    ];
    corners.forEach((c) => addVertex(mesh, c));
    const faces = [
      [4, 5, 6, 7],
      [1, 0, 3, 2],
      [0, 4, 7, 3],
      [5, 1, 2, 6],
      [3, 7, 6, 2],
      [0, 1, 5, 4],
    ];
    for (const face of faces) {
      pushTriangle(mesh, face[0], face[1], face[2]);
      pushTriangle(mesh, face[0], face[2], face[3]);
    }
    return mesh;
  }
  if (kind === 'Plane') {
    addVertex(mesh, vec(-0.5, -0.5, 0));
    addVertex(mesh, vec(0.5, -0.5, 0));
    addVertex(mesh, vec(0.5, 0.5, 0));
    addVertex(mesh, vec(-0.5, 0.5, 0));
    pushTriangle(mesh, 0, 1, 2);
    pushTriangle(mesh, 0, 2, 3);
    return mesh;
  }
  if (kind === 'Sphere') {
    const radial = 32;
    const rings = 16;
    for (let ring = 0; ring <= rings; ring += 1) {
      const phi = (ring / rings) * Math.PI;
      for (let seg = 0; seg <= radial; seg += 1) {
        const theta = (seg / radial) * Math.PI * 2;
        addVertex(
          mesh,
          vec(
            0.5 * Math.sin(phi) * Math.cos(theta),
            0.5 * Math.cos(phi),
            0.5 * Math.sin(phi) * Math.sin(theta),
          ),
        );
      }
    }
    const stride = radial + 1;
    for (let ring = 0; ring < rings; ring += 1) {
      for (let seg = 0; seg < radial; seg += 1) {
        const a = ring * stride + seg;
        const b = a + stride;
        if (ring !== 0) pushTriangle(mesh, a, b, a + 1);
        if (ring !== rings - 1) pushTriangle(mesh, a + 1, b, b + 1);
      }
    }
    return mesh;
  }
  if (kind === 'Cylinder') {
    const radial = 32;
    for (let seg = 0; seg < radial; seg += 1) {
      const theta = (seg / radial) * Math.PI * 2;
      addVertex(mesh, vec(0.5 * Math.cos(theta), 0.5, 0.5 * Math.sin(theta)));
      addVertex(mesh, vec(0.5 * Math.cos(theta), -0.5, 0.5 * Math.sin(theta)));
    }
    const topCentre = addVertex(mesh, vec(0, 0.5, 0));
    const bottomCentre = addVertex(mesh, vec(0, -0.5, 0));
    for (let seg = 0; seg < radial; seg += 1) {
      const next = (seg + 1) % radial;
      const topA = seg * 2;
      const bottomA = seg * 2 + 1;
      const topB = next * 2;
      const bottomB = next * 2 + 1;
      pushTriangle(mesh, topA, bottomA, bottomB);
      pushTriangle(mesh, topA, bottomB, topB);
      pushTriangle(mesh, topCentre, topB, topA);
      pushTriangle(mesh, bottomCentre, bottomA, bottomB);
    }
    return mesh;
  }
  const ringSegments = 48;
  const tubeSegments = 16;
  for (let i = 0; i < ringSegments; i += 1) {
    const u = (i / ringSegments) * Math.PI * 2;
    for (let j = 0; j < tubeSegments; j += 1) {
      const v = (j / tubeSegments) * Math.PI * 2;
      const radius = 0.5 + 0.15 * Math.cos(v);
      addVertex(mesh, vec(radius * Math.cos(u), radius * Math.sin(u), 0.15 * Math.sin(v)));
    }
  }
  for (let i = 0; i < ringSegments; i += 1) {
    for (let j = 0; j < tubeSegments; j += 1) {
      const a = i * tubeSegments + j;
      const b = ((i + 1) % ringSegments) * tubeSegments + j;
      const c = ((i + 1) % ringSegments) * tubeSegments + ((j + 1) % tubeSegments);
      const d = i * tubeSegments + ((j + 1) % tubeSegments);
      pushTriangle(mesh, a, b, c);
      pushTriangle(mesh, a, c, d);
    }
  }
  return mesh;
}

export function meshTriangleCount(mesh: Mesh): number {
  return mesh.indices.length / 3;
}
