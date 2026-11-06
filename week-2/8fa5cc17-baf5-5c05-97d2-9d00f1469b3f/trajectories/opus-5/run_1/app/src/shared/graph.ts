/**
 * The single home of the graph seeded start, the force step, the integrator
 * and the camera pose to view matrix.
 */

export const SHELL_BASE_RADIUS = 6;
export const SHELL_STEP = 4;
export const REPULSION = 40;
export const REPULSION_MIN_DISTANCE = 0.5;
export const SPRING_STRENGTH = 0.08;
export const SPRING_LENGTH = 6;
export const SHELL_STRENGTH = 0.2;
export const TIME_STEP = 0.05;
export const DAMPING = 0.92;
export const REST_SPEED = 0.002;
export const INITIAL_STEPS = 600;
export const REHEAT_STEPS = 400;
export const REHEAT_STEP_MS = 16;
export const REHEAT_MAX_STEPS_PER_FRAME = 8;
export const GOLDEN_ANGLE_DEGREES = 137.50776405;

export const NODE_SIZE_MIN = 0.6;
export const NODE_SIZE_PER_BACKLINK = 0.15;
export const NODE_SIZE_MAX = 2.4;

export const CAMERA_HOME = { target: [0, 0, 0] as [number, number, number], yaw: 0, pitch: 20, distance: 40 };
export const CAMERA_PITCH_LIMIT = 80;
export const CAMERA_DISTANCE_MIN = 12;
export const CAMERA_DISTANCE_MAX = 90;
export const CAMERA_FOV_DEGREES = 45;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 500;
export const FOG_DEPTH = 40;
export const ORBIT_DEGREES_PER_PIXEL = 0.4;
export const WHEEL_DISTANCE_PER_PIXEL = 0.05;
export const KEY_YAW_STEP = 15;
export const KEY_PITCH_STEP = 10;
export const KEY_DISTANCE_STEP = 5;
export const IDLE_TURN_DEGREES_PER_SECOND = 6;
export const IDLE_RESUME_MS = 5000;
export const FLY_TO_MS = 600;
export const FLY_TO_PITCH = 15;
export const FLY_TO_DISTANCE_BASE = 12;
export const FLY_TO_DISTANCE_PER_SIZE = 4;
export const LABEL_MIN_PROJECTED_RADIUS = 6;
export const LABEL_OFFSET_PX = 12;
export const SCOPE_DIM_OPACITY = 0.25;
export const SCOPE_DIM_MS = 180;
export const NODE_GROW_MS = 280;
export const EDGE_DRAW_MS = 400;

export function nodeSize(backlinks: number): number {
  return Math.min(NODE_SIZE_MAX, NODE_SIZE_MIN + NODE_SIZE_PER_BACKLINK * backlinks);
}

export function shellRadius(typeIndex: number): number {
  return SHELL_BASE_RADIUS + SHELL_STEP * typeIndex;
}

/** The 32-bit FNV-1a hash of the lowercase hyphenated object id. */
export function nodeHash(objectId: string): number {
  const bytes = new TextEncoder().encode(objectId.toLowerCase());
  let hash = 2166136261;
  for (const byte of bytes) {
    hash = (hash ^ byte) >>> 0;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function jitterGenerator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 1831565813) >>> 0;
    let q = Math.imul(a ^ (a >>> 15), a | 1) >>> 0;
    q = ((q + Math.imul(q ^ (q >>> 7), q | 61)) ^ q) >>> 0;
    return ((q ^ (q >>> 14)) >>> 0) / 4294967296;
  };
}

export type LayoutNode = {
  id: string;
  typeIndex: number;
  indexInType: number;
  countInType: number;
  position: [number, number, number];
  velocity: [number, number, number];
  acceleration: [number, number, number];
  pinned: boolean;
};

export type LayoutEdge = { id: string; from: string; to: string };

export function seededStart(node: {
  id: string;
  typeIndex: number;
  indexInType: number;
  countInType: number;
}): [number, number, number] {
  const radius = shellRadius(node.typeIndex);
  const y = 1 - (2 * (node.indexInType + 0.5)) / node.countInType;
  const rho = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = (node.indexInType * GOLDEN_ANGLE_DEGREES * Math.PI) / 180;
  const shell: [number, number, number] = [
    radius * rho * Math.cos(theta),
    radius * y,
    radius * rho * Math.sin(theta),
  ];
  const jitter = jitterGenerator(nodeHash(node.id));
  return [shell[0] + jitter() - 0.5, shell[1] + jitter() - 0.5, shell[2] + jitter() - 0.5];
}

export function computeAccelerations(nodes: LayoutNode[], edges: LayoutEdge[]): void {
  for (const node of nodes) node.acceleration = [0, 0, 0];
  const byId = new Map<string, LayoutNode>();
  for (const node of nodes) byId.set(node.id, node);
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const d: [number, number, number] = [
        b.position[0] - a.position[0],
        b.position[1] - a.position[1],
        b.position[2] - a.position[2],
      ];
      const length = Math.hypot(d[0], d[1], d[2]);
      const unit: [number, number, number] = length === 0 ? [1, 0, 0] : [d[0] / length, d[1] / length, d[2] / length];
      const strength = REPULSION / Math.pow(Math.max(length, REPULSION_MIN_DISTANCE), 2);
      for (let axis = 0; axis < 3; axis += 1) {
        a.acceleration[axis] -= strength * unit[axis];
        b.acceleration[axis] += strength * unit[axis];
      }
    }
  }
  const sorted = [...edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const edge of sorted) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (from === undefined || to === undefined) continue;
    const d: [number, number, number] = [
      to.position[0] - from.position[0],
      to.position[1] - from.position[1],
      to.position[2] - from.position[2],
    ];
    const length = Math.hypot(d[0], d[1], d[2]);
    const unit: [number, number, number] = length === 0 ? [1, 0, 0] : [d[0] / length, d[1] / length, d[2] / length];
    const strength = SPRING_STRENGTH * (length - SPRING_LENGTH);
    for (let axis = 0; axis < 3; axis += 1) {
      from.acceleration[axis] += strength * unit[axis];
      to.acceleration[axis] -= strength * unit[axis];
    }
  }
  for (const node of nodes) {
    const length = Math.hypot(node.position[0], node.position[1], node.position[2]);
    if (length === 0) continue;
    const strength = -SHELL_STRENGTH * (length - shellRadius(node.typeIndex));
    for (let axis = 0; axis < 3; axis += 1) {
      node.acceleration[axis] += (strength * node.position[axis]) / length;
    }
  }
}

/** One velocity Verlet step; returns the largest speed among unpinned nodes. */
export function integrateStep(nodes: LayoutNode[], edges: LayoutEdge[]): number {
  const previous = nodes.map((node) => [...node.acceleration] as [number, number, number]);
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.pinned) continue;
    for (let axis = 0; axis < 3; axis += 1) {
      node.position[axis] +=
        node.velocity[axis] * TIME_STEP + 0.5 * previous[index][axis] * TIME_STEP * TIME_STEP;
    }
  }
  computeAccelerations(nodes, edges);
  let fastest = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.pinned) {
      node.velocity = [0, 0, 0];
      continue;
    }
    for (let axis = 0; axis < 3; axis += 1) {
      node.velocity[axis] =
        (node.velocity[axis] + 0.5 * (previous[index][axis] + node.acceleration[axis]) * TIME_STEP) * DAMPING;
    }
    fastest = Math.max(fastest, Math.hypot(node.velocity[0], node.velocity[1], node.velocity[2]));
  }
  return fastest;
}

export function settle(nodes: LayoutNode[], edges: LayoutEdge[], maxSteps: number): number {
  computeAccelerations(nodes, edges);
  for (let step = 0; step < maxSteps; step += 1) {
    const fastest = integrateStep(nodes, edges);
    if (fastest < REST_SPEED) return step + 1;
  }
  return maxSteps;
}

/* ------------------------------------------------------------- matrices */

export type Mat4 = Float32Array;

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;
  return m;
}

export function translateScale(position: [number, number, number], scale: number): Mat4 {
  const m = new Float32Array(16);
  m[0] = scale;
  m[5] = scale;
  m[10] = scale;
  m[12] = position[0];
  m[13] = position[1];
  m[14] = position[2];
  m[15] = 1;
  return m;
}

export function perspective(aspect: number): Mat4 {
  const f = 1 / Math.tan(((CAMERA_FOV_DEGREES * Math.PI) / 180) / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (CAMERA_FAR + CAMERA_NEAR) / (CAMERA_NEAR - CAMERA_FAR);
  m[11] = -1;
  m[14] = (2 * CAMERA_FAR * CAMERA_NEAR) / (CAMERA_NEAR - CAMERA_FAR);
  return m;
}

export type CameraPose = {
  target: [number, number, number];
  yaw: number;
  pitch: number;
  distance: number;
};

export function cameraEye(pose: CameraPose): [number, number, number] {
  const yaw = (pose.yaw * Math.PI) / 180;
  const pitch = (pose.pitch * Math.PI) / 180;
  return [
    pose.target[0] + pose.distance * Math.cos(pitch) * Math.sin(yaw),
    pose.target[1] + pose.distance * Math.sin(pitch),
    pose.target[2] + pose.distance * Math.cos(pitch) * Math.cos(yaw),
  ];
}

export function viewMatrix(pose: CameraPose): Mat4 {
  const eye = cameraEye(pose);
  const center = pose.target;
  const up: [number, number, number] = [0, 1, 0];
  let z: [number, number, number] = [eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]];
  let length = Math.hypot(z[0], z[1], z[2]) || 1;
  z = [z[0] / length, z[1] / length, z[2] / length];
  let x: [number, number, number] = [
    up[1] * z[2] - up[2] * z[1],
    up[2] * z[0] - up[0] * z[2],
    up[0] * z[1] - up[1] * z[0],
  ];
  length = Math.hypot(x[0], x[1], x[2]) || 1;
  x = [x[0] / length, x[1] / length, x[2] / length];
  const y: [number, number, number] = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  const m = new Float32Array(16);
  m[0] = x[0];
  m[1] = y[0];
  m[2] = z[0];
  m[4] = x[1];
  m[5] = y[1];
  m[6] = z[1];
  m[8] = x[2];
  m[9] = y[2];
  m[10] = z[2];
  m[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  m[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  m[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  m[15] = 1;
  return m;
}

export function clampPitch(pitch: number): number {
  return Math.min(CAMERA_PITCH_LIMIT, Math.max(-CAMERA_PITCH_LIMIT, pitch));
}

export function clampDistance(distance: number): number {
  return Math.min(CAMERA_DISTANCE_MAX, Math.max(CAMERA_DISTANCE_MIN, distance));
}

export function flyToPose(position: [number, number, number], size: number): CameraPose {
  return {
    target: [position[0], position[1], position[2]],
    yaw: (Math.atan2(position[0], position[2]) * 180) / Math.PI,
    pitch: FLY_TO_PITCH,
    distance: clampDistance(FLY_TO_DISTANCE_BASE + FLY_TO_DISTANCE_PER_SIZE * size),
  };
}

export function shortWayYaw(from: number, to: number): number {
  let delta = ((to - from) % 360 + 540) % 360 - 180;
  return from + delta;
}

/** A procedurally built unit icosphere. */
export function icosphere(subdivisions: number): { positions: Float32Array; indices: Uint16Array } {
  const t = (1 + Math.sqrt(5)) / 2;
  let vertices: [number, number, number][] = [
    [-1, t, 0],
    [1, t, 0],
    [-1, -t, 0],
    [1, -t, 0],
    [0, -1, t],
    [0, 1, t],
    [0, -1, -t],
    [0, 1, -t],
    [t, 0, -1],
    [t, 0, 1],
    [-t, 0, -1],
    [-t, 0, 1],
  ].map((v) => {
    const length = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / length, v[1] / length, v[2] / length] as [number, number, number];
  });
  let faces: [number, number, number][] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  for (let pass = 0; pass < subdivisions; pass += 1) {
    const midpoints = new Map<string, number>();
    const nextFaces: [number, number, number][] = [];
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const hit = midpoints.get(key);
      if (hit !== undefined) return hit;
      const va = vertices[a];
      const vb = vertices[b];
      const mid: [number, number, number] = [
        (va[0] + vb[0]) / 2,
        (va[1] + vb[1]) / 2,
        (va[2] + vb[2]) / 2,
      ];
      const length = Math.hypot(mid[0], mid[1], mid[2]);
      vertices.push([mid[0] / length, mid[1] / length, mid[2] / length]);
      const index = vertices.length - 1;
      midpoints.set(key, index);
      return index;
    };
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      nextFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = nextFaces;
  }
  const positions = new Float32Array(vertices.length * 3);
  vertices.forEach((vertex, index) => {
    positions[index * 3] = vertex[0];
    positions[index * 3 + 1] = vertex[1];
    positions[index * 3 + 2] = vertex[2];
  });
  const indices = new Uint16Array(faces.length * 3);
  faces.forEach((face, index) => {
    indices[index * 3] = face[0];
    indices[index * 3 + 1] = face[1];
    indices[index * 3 + 2] = face[2];
  });
  return { positions, indices };
}

/** Ray against a sphere, used by picking; it never draws. */
export function raySphere(
  origin: [number, number, number],
  direction: [number, number, number],
  center: [number, number, number],
  radius: number,
): number | null {
  const oc: [number, number, number] = [origin[0] - center[0], origin[1] - center[1], origin[2] - center[2]];
  const b = 2 * (direction[0] * oc[0] + direction[1] * oc[1] + direction[2] * oc[2]);
  const c = oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2] - radius * radius;
  const a = direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2];
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const t1 = (-b - root) / (2 * a);
  const t2 = (-b + root) / (2 * a);
  if (t1 > 0) return t1;
  if (t2 > 0) return t2;
  return null;
}
