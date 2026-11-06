// The procedural 3D island: a cracked salt crust, tidal channels around the deploy ring,
// low-poly buildings with a distinct silhouette per type, dusk lighting from one side.
import type { IslandScene, SceneBuilding, SceneUnit } from './scene.ts';
import { BUILDINGS } from '../../domain/catalog.ts';
import { footprintSize } from './scene.ts';

const VERTEX_SRC = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uMvp;
uniform mat4 uModel;
uniform vec3 uLightDir;
uniform float uTime;
uniform float uRipple;
varying vec3 vColor;
varying float vLight;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  if (uRipple > 0.5) {
    world.y += sin(uTime * 0.0012 + world.x * 0.9 + world.z * 0.7) * 0.035;
  }
  gl_Position = uMvp * world;
  vec3 normal = normalize(mat3(uModel) * aNormal);
  float lambert = max(dot(normal, uLightDir), 0.0);
  vLight = 0.45 + 0.65 * lambert;
  vColor = aColor;
}
`;

const FRAGMENT_SRC = `
precision mediump float;
varying vec3 vColor;
varying float vLight;
void main() {
  gl_FragColor = vec4(vColor * vLight, 1.0);
}
`;

interface Mesh {
  buffer: WebGLBuffer;
  count: number;
  ripple: boolean;
}

interface CameraMatrices {
  mvp: Float32Array;
  model: Float32Array;
}

const GROUND = [0.93, 0.91, 0.84];
const SALT_CRACK = [0.85, 0.83, 0.76];
const WATER = [0.31, 0.6, 0.56];
const BUILDING_COLORS: Record<string, [number, number, number]> = {
  brine_pan: [0.7, 0.78, 0.72],
  peat_cutter: [0.62, 0.5, 0.38],
  copper_sluice: [0.72, 0.5, 0.32],
  brine_cistern: [0.5, 0.62, 0.6],
  peat_rick: [0.66, 0.56, 0.36],
  copper_vault: [0.78, 0.45, 0.3],
  tide_barracks: [0.58, 0.6, 0.68],
  driftwood_camp: [0.72, 0.62, 0.45],
  kiln_tower: [0.82, 0.45, 0.25],
};
const ACCENT: [number, number, number] = [0.91, 0.47, 0.23];
const GHOST_OK: [number, number, number] = [0.31, 0.6, 0.56];
const GHOST_BAD: [number, number, number] = [0.78, 0.27, 0.21];
const UNIT_COLOR: Record<string, [number, number, number]> = {
  saltjack: [0.95, 0.93, 0.86],
  peat_slinger: [0.85, 0.72, 0.45],
};

function mat4Identity(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function mat4Multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + j] * b[i * 4 + k];
      out[i * 4 + j] = sum;
    }
  }
  return out;
}

function mat4Perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
}

function mat4LookAt(eye: number[], center: number[], up: number[]): Float32Array {
  const zAxis = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
  const xAxis = normalize(cross(up, zAxis));
  const yAxis = cross(zAxis, xAxis);
  return new Float32Array([
    xAxis[0], yAxis[0], zAxis[0], 0,
    xAxis[1], yAxis[1], zAxis[1], 0,
    xAxis[2], yAxis[2], zAxis[2], 0,
    -(xAxis[0] * eye[0] + xAxis[1] * eye[1] + xAxis[2] * eye[2]),
    -(yAxis[0] * eye[0] + yAxis[1] * eye[1] + yAxis[2] * eye[2]),
    -(zAxis[0] * eye[0] + zAxis[1] * eye[1] + zAxis[2] * eye[2]),
    1,
  ]);
}

function normalize(v: number[]): number[] {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

const PITCH = (35 * Math.PI) / 180;
const BASE_DISTANCE = 34;

export function cameraMatrices(scene: IslandScene, width: number, height: number): CameraMatrices {
  const ex = scene.expose();
  const { azimuth, zoom, panX, panY } = ex.camera;
  const theta = (azimuth * Math.PI) / 180;
  const distance = BASE_DISTANCE / zoom;
  const target = [panX - 20, 0, panY - 20];
  const eye = [
    target[0] + distance * Math.cos(PITCH) * Math.sin(theta),
    distance * Math.sin(PITCH),
    target[2] + distance * Math.cos(PITCH) * Math.cos(theta),
  ];
  const view = mat4LookAt(eye, target, [0, 1, 0]);
  const projection = mat4Perspective((45 * Math.PI) / 180, width / Math.max(1, height), 0.1, 300);
  return { mvp: mat4Multiply(projection, view), model: mat4Identity() };
}

export function webglPick(scene: IslandScene, px: number, py: number): { x: number; y: number } | null {
  const canvas = scene.expose().canvas;
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;
  const { mvp } = cameraMatrices(scene, canvas.width, canvas.height);
  // invert the projection: ray from camera through the pixel to the y=0 plane
  const nearPoint = unproject(mvp, (px / width) * 2 - 1, 1 - (py / height) * 2, -1);
  const farPoint = unproject(mvp, (px / width) * 2 - 1, 1 - (py / height) * 2, 1);
  const direction = [farPoint[0] - nearPoint[0], farPoint[1] - nearPoint[1], farPoint[2] - nearPoint[2]];
  if (Math.abs(direction[1]) < 1e-6) return null;
  const t = -nearPoint[1] / direction[1];
  if (t < 0) return null;
  const worldX = nearPoint[0] + direction[0] * t;
  const worldZ = nearPoint[2] + direction[2] * t;
  const cellX = Math.floor(worldX + 20);
  const cellY = Math.floor(worldZ + 20);
  if (cellX < 0 || cellX > 39 || cellY < 0 || cellY > 39) return null;
  return { x: cellX, y: cellY };
}

function unproject(mvp: Float32Array, ndcX: number, ndcY: number, ndcZ: number): number[] {
  const inverse = invert4(mvp);
  const x = inverse[0] * ndcX + inverse[4] * ndcY + inverse[8] * ndcZ + inverse[12];
  const y = inverse[1] * ndcX + inverse[5] * ndcY + inverse[9] * ndcZ + inverse[13];
  const z = inverse[2] * ndcX + inverse[6] * ndcY + inverse[10] * ndcZ + inverse[14];
  return [x, y, z];
}

function invert4(m: Float32Array): Float32Array {
  const inv = new Float32Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (det === 0) det = 1;
  for (let i = 0; i < 16; i++) inv[i] /= det;
  return inv;
}

export function webglBadge(scene: IslandScene, cellCenterX: number, cellCenterY: number): { x: number; y: number } | null {
  const canvas = scene.expose().canvas;
  const dpr = window.devicePixelRatio || 1;
  const { mvp } = cameraMatrices(scene, canvas.width, canvas.height);
  const worldY = buildingTopY(scene, cellCenterX, cellCenterY) + 0.4;
  const world = [cellCenterX - 20, worldY, cellCenterY - 20, 1];
  const clipX = mvp[0] * world[0] + mvp[4] * world[1] + mvp[8] * world[2] + mvp[12] * world[3];
  const clipY = mvp[1] * world[0] + mvp[5] * world[1] + mvp[9] * world[2] + mvp[13] * world[3];
  const clipW = mvp[3] * world[0] + mvp[7] * world[1] + mvp[11] * world[2] + mvp[15] * world[3];
  if (clipW <= 0) return null;
  const ndcX = clipX / clipW;
  const ndcY = clipY / clipW;
  return { x: ((ndcX + 1) / 2) * (canvas.width / dpr), y: ((1 - ndcY) / 2) * (canvas.height / dpr) };
}

function buildingTopY(scene: IslandScene, cx: number, cy: number): number {
  const ex = scene.expose();
  const building = ex.buildings.find((b) => !b.destroyed && cx >= b.x && cx <= b.x + footprintSize(b.type, b.rotation).width && cy >= b.y && cy <= b.y + footprintSize(b.type, b.rotation).depth);
  if (!building) return 0;
  return BUILDING_HEIGHTS[building.type] ?? 0.5;
}

const BUILDING_HEIGHTS: Record<string, number> = {
  brine_pan: 0.3,
  peat_cutter: 0.45,
  copper_sluice: 0.4,
  brine_cistern: 0.95,
  peat_rick: 0.7,
  copper_vault: 1.0,
  tide_barracks: 0.55,
  driftwood_camp: 0.35,
  kiln_tower: 1.35,
};

interface VertexSink {
  positions: number[];
  normals: number[];
  colors: number[];
}

function pushBox(sink: VertexSink, x0: number, y0: number, x1: number, y1: number, h0: number, h1: number, color: number[]): void {
  const quads: number[][][] = [
    // top
    [[x0, h1, y0], [x0, h1, y1], [x1, h1, y1], [x1, h1, y0], [0, 1, 0]],
    // north (z-)
    [[x0, h0, y0], [x1, h0, y0], [x1, h1, y0], [x0, h1, y0], [0, 0, -1]],
    // south (z+)
    [[x0, h1, y1], [x1, h1, y1], [x1, h0, y1], [x0, h0, y1], [0, 0, 1]],
    // west (x-)
    [[x0, h1, y0], [x0, h1, y1], [x0, h0, y1], [x0, h0, y0], [-1, 0, 0]],
    // east (x+)
    [[x1, h0, y0], [x1, h0, y1], [x1, h1, y1], [x1, h1, y0], [1, 0, 0]],
  ];
  for (const [a, b, c, d, normal] of quads) {
    for (const point of [a, b, c, a, c, d]) {
      sink.positions.push(point[0], point[1], point[2]);
      sink.normals.push(normal[0], normal[1], normal[2]);
      sink.colors.push(color[0], color[1], color[2]);
    }
  }
}

function pushPrismRoof(sink: VertexSink, x0: number, y0: number, x1: number, y1: number, base: number, height: number, color: number[]): void {
  const midX = (x0 + x1) / 2;
  const ridge = [midX, base + height, (y0 + y1) / 2];
  const corners: number[][] = [
    [x0, base, y0], [x1, base, y0], [x1, base, y1], [x0, base, y1],
  ];
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const normal = normalize(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [ridge[0] - a[0], ridge[1] - a[1], ridge[2] - a[2]]));
    for (const point of [a, b, ridge]) {
      sink.positions.push(point[0], point[1], point[2]);
      sink.normals.push(normal[0], normal[1], normal[2]);
      sink.colors.push(color[0], color[1], color[2]);
    }
  }
}

function buildGroundMesh(sink: VertexSink): void {
  // salt crust with cracked variation, and a tidal ring of water around the edge
  for (let x = 0; x < 40; x++) {
    for (let y = 0; y < 40; y++) {
      const worldX = x - 20;
      const worldY = y - 20;
      const isRing = x <= 1 || x >= 38 || y <= 1 || y >= 38;
      const color = isRing
        ? WATER
        : (x + y) % 2 === 0
          ? GROUND
          : SALT_CRACK;
      const h = isRing ? -0.12 : 0;
      pushBox(sink, worldX, worldY, worldX + 1, worldY + 1, h, h + (isRing ? 0.02 : 0.06), color);
    }
  }
}

function buildingGeometry(sink: VertexSink, building: SceneBuilding, rise: number, destroyed: boolean): void {
  const { width, depth } = footprintSize(building.type, building.rotation);
  const x0 = building.x - 20;
  const y0 = building.y - 20;
  const x1 = x0 + width;
  const y1 = y0 + depth;
  const color = destroyed ? [0.35, 0.3, 0.28] : BUILDING_COLORS[building.type] ?? GROUND;
  const height = (BUILDING_HEIGHTS[building.type] ?? 0.5) * rise;
  if (destroyed) {
    pushBox(sink, x0 + 0.15, y0 + 0.15, x1 - 0.15, y1 - 0.15, 0, 0.08, color);
    return;
  }
  switch (building.type) {
    case 'brine_pan':
      pushBox(sink, x0, y0, x1, y1, 0, height, color);
      pushBox(sink, x0 + 0.4, y0 + 0.4, x1 - 0.4, y1 - 0.4, height, height + 0.05, [0.36, 0.55, 0.53]);
      break;
    case 'peat_cutter':
      pushBox(sink, x0, y0, x1, y1, 0, height, color);
      pushPrismRoof(sink, x0, y0, x1, y1, height, 0.22, color.map((c) => c * 0.85));
      break;
    case 'copper_sluice':
      pushBox(sink, x0, y0, x1, y1, 0, height, color);
      pushBox(sink, x0 + 0.2, y0 + 0.2, x1 - 0.2, y1 - 0.2, height, height + 0.28, color.map((c) => c * 0.8));
      break;
    case 'brine_cistern':
      pushBox(sink, x0 + 0.3, y0 + 0.3, x1 - 0.3, y1 - 0.3, 0, height, color);
      pushBox(sink, x0 + 0.5, y0 + 0.5, x1 - 0.5, y1 - 0.5, height, height + 0.12, color.map((c) => c * 0.75));
      break;
    case 'peat_rick':
      pushBox(sink, x0, y0, x1, y1, 0, height * 0.6, color);
      pushBox(sink, x0 + 0.4, y0 + 0.4, x1 - 0.4, y1 - 0.4, height * 0.6, height, color.map((c) => c * 0.9));
      break;
    case 'copper_vault':
      pushBox(sink, x0, y0, x1, y1, 0, height, color);
      pushBox(sink, x0 + 0.2, y0 + 0.2, x1 - 0.2, y1 - 0.2, height, height + 0.1, ACCENT);
      break;
    case 'tide_barracks':
      pushBox(sink, x0, y0, x1, y1, 0, height, color);
      pushPrismRoof(sink, x0, y0, x1, y1, height, 0.25, color.map((c) => c * 0.8));
      pushBox(sink, x1 - 0.5, y1 - 0.5, x1 - 0.2, y1 - 0.2, height, height + 0.5, [0.9, 0.9, 0.9]);
      break;
    case 'driftwood_camp':
      pushBox(sink, x0, y0 + 0.2, x0 + width / 2, y1 - 0.2, 0, height, color);
      pushPrismRoof(sink, x0, y0 + 0.2, x0 + width / 2, y1 - 0.2, height, 0.2, color.map((c) => c * 0.85));
      pushBox(sink, x0 + width / 2, y0 + 0.2, x1, y1 - 0.2, 0, height, color.map((c) => c * 0.95));
      pushPrismRoof(sink, x0 + width / 2, y0 + 0.2, x1, y1 - 0.2, height, 0.2, color.map((c) => c * 0.8));
      break;
    case 'kiln_tower':
      pushBox(sink, x0 + 0.4, y0 + 0.4, x1 - 0.4, y1 - 0.4, 0, height * 0.75, color);
      pushBox(sink, x0 + 0.7, y0 + 0.7, x1 - 0.7, y1 - 0.7, height * 0.75, height, color.map((c) => c * 0.9));
      pushBox(sink, x0 + 0.9, y0 + 0.9, x1 - 0.9, y1 - 0.9, height, height + 0.15, ACCENT);
      break;
    default:
      pushBox(sink, x0, y0, x1, y1, 0, height, color);
      break;
  }
}

function scaffoldRing(sink: VertexSink, building: SceneBuilding, timeMs: number): void {
  const { width, depth } = footprintSize(building.type, building.rotation);
  const radius = Math.max(width, depth) / 2 + 0.25;
  const cx = building.x - 20 + width / 2;
  const cy = building.y - 20 + depth / 2;
  const segments = 12;
  const angle = (timeMs / 5000) * Math.PI * 2;
  const height = 0.5 + Math.sin(timeMs / 500) * 0.05;
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2 + angle;
    const a1 = ((i + 1) / segments) * Math.PI * 2 + angle;
    const p0 = [cx + Math.cos(a0) * radius, height, cy + Math.sin(a0) * radius];
    const p1 = [cx + Math.cos(a1) * radius, height, cy + Math.sin(a1) * radius];
    for (const point of [p0, p1, [p0[0], 0.06, p0[2]], p0, [p1[0], 0.06, p1[2]], [p1[0], 0.06, p1[2]]]) {
      sink.positions.push(point[0], point[1], point[2]);
      sink.normals.push(0, 1, 0);
      sink.colors.push(0.95, 0.72, 0.35);
    }
  }
}

function pushUnit(sink: VertexSink, unit: SceneUnit, destroyedWorld: boolean): void {
  void destroyedWorld;
  const x = unit.x / 1000 - 20;
  const y = unit.y / 1000 - 20;
  const color = UNIT_COLOR[unit.unit] ?? [1, 1, 1];
  if (!unit.alive) {
    pushBox(sink, x - 0.12, y - 0.12, x + 0.12, y + 0.12, 0.02, 0.05, [0.4, 0.36, 0.34]);
    return;
  }
  pushBox(sink, x - 0.16, y - 0.16, x + 0.16, y + 0.16, 0.06, 0.32, color);
  pushBox(sink, x - 0.1, y - 0.1, x + 0.1, y + 0.1, 0.32, 0.42, color.map((c) => c * 0.8));
}

export class WebGLRenderer {
  kind = 'webgl' as const;
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private groundMesh: Mesh;
  private dynamicMesh: Mesh;
  private readonly scene: IslandScene;
  private width = 1;
  private height = 1;
  private attributeLocations: { position: number; normal: number; color: number };
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  constructor(scene: IslandScene, gl: WebGLRenderingContext) {
    this.scene = scene;
    this.gl = gl;
    this.program = this.createProgram();
    this.attributeLocations = {
      position: gl.getAttribLocation(this.program, 'aPosition'),
      normal: gl.getAttribLocation(this.program, 'aNormal'),
      color: gl.getAttribLocation(this.program, 'aColor'),
    };
    for (const name of ['uMvp', 'uModel', 'uLightDir', 'uTime', 'uRipple']) {
      this.uniforms[name] = gl.getUniformLocation(this.program, name);
    }
    this.groundMesh = this.upload(this.buildSink((sink) => buildGroundMesh(sink)), null);
    this.dynamicMesh = { buffer: gl.createBuffer()!, count: 0, ripple: false };
  }

  private buildSink(fill: (sink: VertexSink) => void): VertexSink {
    const sink: VertexSink = { positions: [], normals: [], colors: [] };
    fill(sink);
    return sink;
  }

  private createProgram(): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string): WebGLShader => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.getShaderInfoLog(shader)) {
        throw new Error('shader');
      }
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SRC));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SRC));
    gl.linkProgram(program);
    return program;
  }

  private upload(sink: VertexSink, into: Mesh | null): Mesh {
    const gl = this.gl;
    const buffer = into?.buffer ?? gl.createBuffer()!;
    const count = sink.positions.length / 3;
    const data = new Float32Array(count * 9);
    for (let i = 0; i < count; i++) {
      data[i * 9] = sink.positions[i * 3];
      data[i * 9 + 1] = sink.positions[i * 3 + 1];
      data[i * 9 + 2] = sink.positions[i * 3 + 2];
      data[i * 9 + 3] = sink.normals[i * 3];
      data[i * 9 + 4] = sink.normals[i * 3 + 1];
      data[i * 9 + 5] = sink.normals[i * 3 + 2];
      data[i * 9 + 6] = sink.colors[i * 3];
      data[i * 9 + 7] = sink.colors[i * 3 + 1];
      data[i * 9 + 8] = sink.colors[i * 3 + 2];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    return { buffer, count, ripple: false };
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.gl.viewport(0, 0, width, height);
  }

  render(timeMs: number): void {
    const gl = this.gl;
    const ex = this.scene.expose();
    const now = performance.now();

    const sink: VertexSink = { positions: [], normals: [], colors: [] };
    for (const building of ex.buildings) {
      const riseStart = ex.riseAnimations.get(building.id);
      const collapseStart = ex.collapseAnimations.get(building.id);
      let rise = 1;
      if (!ex.reduced && riseStart !== undefined) {
        rise = Math.min(1, (now - riseStart) / 550);
      }
      if (!ex.reduced && collapseStart !== undefined) {
        rise = Math.max(0, 1 - (now - collapseStart) / 550);
      }
      buildingGeometry(sink, building, rise, building.destroyed === true);
      if (!ex.reduced && building.working && !building.destroyed) scaffoldRing(sink, building, timeMs);
    }
    for (const unit of ex.units) pushUnit(sink, unit, false);
    if (ex.ghost !== null) {
      const { width, depth } = footprintSize(ex.ghost.type, ex.ghost.rotation);
      const x0 = ex.ghost.x - 20;
      const y0 = ex.ghost.y - 20;
      const color = ex.ghost.valid ? GHOST_OK : GHOST_BAD;
      const cell = ex.cursor;
      pushBox(sink, x0, y0, x0 + width, y0 + depth, 0.02, 0.06, color);
      pushBox(sink, x0, y0, x0 + width, y0 + depth, 0.5, 0.52, color.map((c) => c * 0.7));
      void cell;
    }
    if (ex.view === 'raid') {
      for (let x = 0; x < 40; x++) {
        for (const y of [0, 1, 38, 39]) {
          const isCorner = (x <= 1 || x >= 38) && (y <= 1 || y >= 38);
          if (isCorner) continue;
          pushBox(sink, x - 20, y - 20, x - 19, y - 19, 0.07, 0.09, [0.95, 0.7, 0.4]);
        }
      }
      for (let y = 0; y < 40; y++) {
        for (const x of [0, 1, 38, 39]) {
          const isCorner = (x <= 1 || x >= 38) && (y <= 1 || y >= 38);
          if (isCorner) continue;
          pushBox(sink, x - 20, y - 20, x - 19, y - 19, 0.07, 0.09, [0.95, 0.7, 0.4]);
        }
      }
    }
    // the keyboard cursor
    if (ex.view !== 'replay') {
      pushBox(sink, ex.cursor.x - 20, ex.cursor.y - 20, ex.cursor.x - 19, ex.cursor.y - 19, 0.09, 0.11, [0.91, 0.47, 0.23]);
    }

    this.updateDynamic(this.upload(sink, this.dynamicMesh));

    const matrices = cameraMatrices(this.scene, this.width, this.height);
    gl.clearColor(0.137, 0.149, 0.259, 1);
    gl.enable(gl.DEPTH_TEST);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.uMvp, false, matrices.mvp);
    gl.uniformMatrix4fv(this.uniforms.uModel, false, matrices.model);
    gl.uniform3f(this.uniforms.uLightDir, -0.45, 0.8, 0.38);
    gl.uniform1f(this.uniforms.uTime, ex.reduced ? 0 : timeMs);

    this.drawMesh(this.groundMesh, true);
    this.drawMesh(this.dynamicMesh, false);
  }

  private updateDynamic(mesh: Mesh): void {
    this.dynamicMesh = mesh;
  }

  private drawMesh(mesh: Mesh, ripple: boolean): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.buffer);
    const stride = 9 * 4;
    gl.enableVertexAttribArray(this.attributeLocations.position);
    gl.enableVertexAttribArray(this.attributeLocations.normal);
    gl.enableVertexAttribArray(this.attributeLocations.color);
    gl.vertexAttribPointer(this.attributeLocations.position, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribPointer(this.attributeLocations.normal, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.vertexAttribPointer(this.attributeLocations.color, 3, gl.FLOAT, false, stride, 6 * 4);
    gl.uniform1f(this.uniforms.uRipple, ripple && !this.scene.expose().reduced ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }
}
