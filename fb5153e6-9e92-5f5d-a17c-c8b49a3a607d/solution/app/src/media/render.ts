import type { Camera } from '../shared/viewer.js';
import { cameraPosition } from '../shared/viewer.js';
import { palette, hexToRgb } from '../shared/palette.js';
import { encodePng } from './png.js';
import type { BoundingBox } from './gltf.js';

export const PREVIEW_WIDTH = 1024;
export const PREVIEW_HEIGHT = 768;

const DEG = Math.PI / 180;
const LIGHT: readonly [number, number, number] = (() => {
  const v: [number, number, number] = [-0.4, 0.78, 0.48];
  const len = Math.hypot(...v);
  return [v[0] / len, v[1] / len, v[2] / len];
})();

interface Basis {
  readonly right: readonly [number, number, number];
  readonly up: readonly [number, number, number];
  readonly forward: readonly [number, number, number];
  readonly position: readonly [number, number, number];
}

function basisFor(camera: Camera, boundingRadiusMm: number): Basis {
  const p = cameraPosition(camera, boundingRadiusMm);
  const len = Math.hypot(p.x, p.y, p.z) || 1;
  const forward: [number, number, number] = [-p.x / len, -p.y / len, -p.z / len];
  // right = normalise(forward × worldUp) with worldUp = +Y.
  const rlen = Math.hypot(forward[2], forward[0]) || 1;
  const right: [number, number, number] = [-forward[2] / rlen, 0, forward[0] / rlen];
  const up: [number, number, number] = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  return { right, up, forward, position: [p.x, p.y, p.z] };
}

/**
 * Renders the model from its default camera on the bone ground, with flat
 * shading and a z-buffer. Nothing moves and nothing loops.
 */
export function renderPreview(
  trianglesMetres: Float32Array,
  box: BoundingBox,
  camera: Camera,
  boundingRadiusMm: number,
): Buffer {
  const width = PREVIEW_WIDTH;
  const height = PREVIEW_HEIGHT;
  const [bgR, bgG, bgB] = hexToRgb(palette.bone);
  const [mR, mG, mB] = hexToRgb(palette.material);

  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    pixels[i * 3] = bgR;
    pixels[i * 3 + 1] = bgG;
    pixels[i * 3 + 2] = bgB;
  }
  const depth = new Float64Array(width * height).fill(Infinity);

  const centre: readonly [number, number, number] = [
    ((box.min[0] + box.max[0]) / 2) * 1000,
    ((box.min[1] + box.max[1]) / 2) * 1000,
    ((box.min[2] + box.max[2]) / 2) * 1000,
  ];

  const { right, up, forward, position } = basisFor(camera, boundingRadiusMm);
  const halfFov = Math.tan((camera.fov / 2) * DEG);
  const aspect = width / height;

  const project = (
    x: number,
    y: number,
    z: number,
  ): readonly [number, number, number] | null => {
    const vx = x - position[0];
    const vy = y - position[1];
    const vz = z - position[2];
    const zc = vx * forward[0] + vy * forward[1] + vz * forward[2];
    if (zc <= 1e-6) return null;
    const xc = vx * right[0] + vy * right[1] + vz * right[2];
    const yc = vx * up[0] + vy * up[1] + vz * up[2];
    return [
      ((xc / (zc * halfFov * aspect) + 1) / 2) * width,
      ((1 - yc / (zc * halfFov)) / 2) * height,
      zc,
    ];
  };

  const count = Math.floor(trianglesMetres.length / 9);
  for (let t = 0; t < count; t += 1) {
    const b = t * 9;
    const world: [number, number, number][] = [];
    for (let c = 0; c < 3; c += 1) {
      world.push([
        (trianglesMetres[b + c * 3] ?? 0) * 1000 - centre[0],
        (trianglesMetres[b + c * 3 + 1] ?? 0) * 1000 - centre[1],
        (trianglesMetres[b + c * 3 + 2] ?? 0) * 1000 - centre[2],
      ]);
    }
    const [w0, w1, w2] = world as [
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ];
    const ux = w1[0] - w0[0];
    const uy = w1[1] - w0[1];
    const uz = w1[2] - w0[2];
    const vx = w2[0] - w0[0];
    const vy = w2[1] - w0[1];
    const vz = w2[2] - w0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nlen = Math.hypot(nx, ny, nz);
    if (nlen === 0) continue;
    nx /= nlen;
    ny /= nlen;
    nz /= nlen;
    // Face the light either way, so a model with mixed winding still reads.
    const lambert = Math.abs(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    const shade = 0.5 + 0.5 * lambert;

    const p0 = project(...w0);
    const p1 = project(...w1);
    const p2 = project(...w2);
    if (p0 === null || p1 === null || p2 === null) continue;

    const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
    const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
    const area = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    if (area === 0) continue;

    const r = Math.round(mR * shade);
    const g = Math.round(mG * shade);
    const bl = Math.round(mB * shade);

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0b = ((p1[0] - px) * (p2[1] - py) - (p2[0] - px) * (p1[1] - py)) / area;
        const w1b = ((p2[0] - px) * (p0[1] - py) - (p0[0] - px) * (p2[1] - py)) / area;
        const w2b = 1 - w0b - w1b;
        if (w0b < 0 || w1b < 0 || w2b < 0) continue;
        const z = w0b * p0[2] + w1b * p1[2] + w2b * p2[2];
        const index = y * width + x;
        if (z >= (depth[index] ?? Infinity)) continue;
        depth[index] = z;
        pixels[index * 3] = r;
        pixels[index * 3 + 1] = g;
        pixels[index * 3 + 2] = bl;
      }
    }
  }

  return encodePng(width, height, pixels);
}
