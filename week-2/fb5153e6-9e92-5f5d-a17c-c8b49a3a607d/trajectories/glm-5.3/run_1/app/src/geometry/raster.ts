import type { Mesh, Box } from './glb.js';
import { cameraPosition, type Camera } from '../domain/viewer.js';
import { writePng } from './png.js';

const PREVIEW_WIDTH = 1024;
const PREVIEW_HEIGHT = 768;

const BONE = [0xf4, 0xf0, 0xe6, 255];
const INK_SHADE: [number, number, number] = [0.72, 0.74, 0.78];

/**
 * Software rasteriser: renders the mesh from the default camera onto the bone
 * ground with simple headlight shading. Deterministic, no GPU required.
 */
export function renderPreview(mesh: Mesh, camera: Camera, box: Box): Buffer {
  const { min, max } = box;
  const centre: [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];
  const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
  const position = cameraPosition(camera, radius);
  const eye: [number, number, number] = [position.x, position.y, position.z];
  const look: [number, number, number] = centre;
  const forwardVec = normalise([look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]]);
  const rightVec = normalise(cross(forwardVec, [0, 1, 0]));
  const upVec = normalise(cross(rightVec, forwardVec));
  const halfFov = Math.tan(((camera.fov / 2) * Math.PI) / 180);
  const aspect = PREVIEW_WIDTH / PREVIEW_HEIGHT;

  const zbuffer = new Float32Array(PREVIEW_WIDTH * PREVIEW_HEIGHT).fill(Infinity);
  const image = new Uint8Array(PREVIEW_WIDTH * PREVIEW_HEIGHT * 4);
  for (let i = 0; i < PREVIEW_WIDTH * PREVIEW_HEIGHT; i++) {
    image[i * 4] = BONE[0] ?? 0;
    image[i * 4 + 1] = BONE[1] ?? 0;
    image[i * 4 + 2] = BONE[2] ?? 0;
    image[i * 4 + 3] = BONE[3] ?? 0;
  }

  // Draw a soft ground plane line for depth reference.
  const groundY = min[1] - radius * 0.05;
  for (let gy = Math.round(PREVIEW_HEIGHT * 0.82); gy < Math.round(PREVIEW_HEIGHT * 0.86); gy++) {
    for (let gx = Math.round(PREVIEW_WIDTH * 0.12); gx < PREVIEW_WIDTH - Math.round(PREVIEW_WIDTH * 0.12); gx++) {
      setPixel(image, zbuffer, gx, gy, 0xe0, 0xdb, 0xcf);
    }
  }
  void groundY;

  const triangles = mesh.indices.length / 3;
  for (let t = 0; t < triangles; t++) {
    const corners: [number, number, number][] = [];
    const projected: { x: number; y: number; z: number }[] = [];
    let behind = false;
    for (let c = 0; c < 3; c++) {
      const index = mesh.indices[t * 3 + c] ?? 0;
      const px = mesh.positions[index * 3 + 0] ?? 0;
      const py = mesh.positions[index * 3 + 1] ?? 0;
      const pz = mesh.positions[index * 3 + 2] ?? 0;
      corners.push([px, py, pz]);
      const vx = px - eye[0];
      const vy = py - eye[1];
      const vz = pz - eye[2];
      const zc = vx * forwardVec[0] + vy * forwardVec[1] + vz * forwardVec[2];
      if (zc <= 0.0001) {
        behind = true;
        break;
      }
      const xc = vx * rightVec[0] + vy * rightVec[1] + vz * rightVec[2];
      const yc = vx * upVec[0] + vy * upVec[1] + vz * upVec[2];
      projected.push({
        x: (xc / (zc * halfFov * aspect) + 1) / 2 * PREVIEW_WIDTH,
        y: (1 - yc / (zc * halfFov)) / 2 * PREVIEW_HEIGHT,
        z: zc,
      });
    }
    if (behind) continue;
    const c0 = corners[0] ?? [0, 0, 0];
    const c1 = corners[1] ?? [0, 0, 0];
    const c2 = corners[2] ?? [0, 0, 0];
    const normal = normalise(cross(
      [c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]],
      [c2[0] - c0[0], c2[1] - c0[1], c2[2] - c0[2]],
    ));
    // Light roughly from camera direction plus a touch from above.
    const toEye = normalise([eye[0] - centre[0], eye[1] - centre[1], eye[2] - centre[2]]);
    const diffuse = Math.abs(dot(normal, toEye)) * 0.72 + 0.28;
    const shade = (component: number): number => Math.round(255 * component * diffuse);
    const inkR = 0.17 + 0.1 * (INK_SHADE[0] ?? 0.7);
    const inkG = 0.2 + 0.1 * (INK_SHADE[1] ?? 0.7);
    const inkB = 0.28 + 0.1 * (INK_SHADE[2] ?? 0.8);
    fillTriangle(image, zbuffer, projected, shade(inkR), shade(inkG), shade(inkB));
  }

  return writePng(PREVIEW_WIDTH, PREVIEW_HEIGHT, image);
}

export function previewDimensions(): { width: number; height: number } {
  return { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT };
}

function setPixel(
  image: Uint8Array,
  zbuffer: Float32Array,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  z = -Infinity,
): void {
  if (x < 0 || y < 0 || x >= PREVIEW_WIDTH || y >= PREVIEW_HEIGHT) return;
  const index = y * PREVIEW_WIDTH + x;
  if (index >= zbuffer.length) return;
  if (z >= (zbuffer[index] ?? Infinity)) return;
  zbuffer[index] = z;
  image[index * 4] = r;
  image[index * 4 + 1] = g;
  image[index * 4 + 2] = b;
  image[index * 4 + 3] = 255;
}

function fillTriangle(
  image: Uint8Array,
  zbuffer: Float32Array,
  vertices: { x: number; y: number; z: number }[],
  r: number,
  g: number,
  b: number,
): void {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of vertices) {
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(PREVIEW_HEIGHT - 1, Math.ceil(maxY));
  for (let y = yStart; y <= yEnd; y++) {
    const scan: { x: number; z: number }[] = [];
    for (let i = 0; i < 3; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % 3];
      if (a === undefined || b === undefined) continue;
      if (a.y <= y + 0.5 && b.y > y + 0.5) {
        const t = (y + 0.5 - a.y) / (b.y - a.y);
        scan.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      } else if (b.y <= y + 0.5 && a.y > y + 0.5) {
        const t = (y + 0.5 - b.y) / (a.y - b.y);
        scan.push({ x: b.x + (a.x - b.x) * t, z: b.z + (a.z - b.z) * t });
      }
    }
    if (scan.length < 2) continue;
    scan.sort((p, q) => p.x - q.x);
    const left = scan[0]!;
    const right = scan[scan.length - 1]!;
    if (left === undefined || right === undefined) continue;
    const xStart = Math.max(0, Math.floor(left.x));
    const xEnd = Math.min(PREVIEW_WIDTH - 1, Math.ceil(right.x));
    for (let x = xStart; x <= xEnd; x++) {
      if (x + 0.5 < left.x || x + 0.5 > right.x) continue;
      const t = right.x === left.x ? 0 : (x + 0.5 - left.x) / (right.x - left.x);
      const z = left.z + (right.z - left.z) * t;
      setPixel(image, zbuffer, x, y, r, g, b, z);
    }
  }
}

function normalise(v: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len === 0 ? [0, 1, 0] : [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

