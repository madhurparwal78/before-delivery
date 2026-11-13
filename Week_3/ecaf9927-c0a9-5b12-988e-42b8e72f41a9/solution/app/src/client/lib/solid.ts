import type { BodyMesh } from '../../shared/api';

export interface Placed {
  mesh: BodyMesh;
  /** Where the body's left edge is placed along the screen axis, in millimetres. */
  shiftX: number;
  /** Where the body sits in depth, in millimetres (rows of an assembly layout). */
  shiftY?: number;
}

export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Palette {
  light: string;
  dark: string;
  ink: string;
}

const YAW = (-35 * Math.PI) / 180;
const PITCH = (28 * Math.PI) / 180;
const LIGHT: [number, number, number] = normalize([-0.45, -0.7, 0.75]);
const CREASE = Math.cos((35 * Math.PI) / 180);

function normalize(v: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
}

const cross = (a: number[], b: number[]): [number, number, number] => [
  (a[1] as number) * (b[2] as number) - (a[2] as number) * (b[1] as number),
  (a[2] as number) * (b[0] as number) - (a[0] as number) * (b[2] as number),
  (a[0] as number) * (b[1] as number) - (a[1] as number) * (b[0] as number),
];

interface Projected {
  sx: Float64Array;
  sy: Float64Array;
  depth: Float64Array;
}

/** The three-quarter view: yaw about the vertical axis, then tilt towards the viewer; orthographic. */
function project(mesh: BodyMesh, shiftX: number, shiftY: number): Projected {
  const n = mesh.vertices.length;
  const out: Projected = { sx: new Float64Array(n), sy: new Float64Array(n), depth: new Float64Array(n) };
  const cosY = Math.cos(YAW);
  const sinY = Math.sin(YAW);
  mesh.vertices.forEach(([x, vy, z], i) => {
    const px = x + shiftX;
    const y = vy + shiftY;
    const rx = px * cosY - y * sinY;
    const ry = px * sinY + y * cosY;
    out.sx[i] = rx;
    out.sy[i] = ry * Math.sin(PITCH) + z * Math.cos(PITCH);
    out.depth[i] = -(ry * Math.cos(PITCH) - z * Math.sin(PITCH));
  });
  return out;
}

const VIEW: [number, number, number] = [0, Math.cos(PITCH), -Math.sin(PITCH)];

function toWorldDirection(normal: [number, number, number]): number {
  // The light is fixed in the yawed frame; rotate the normal into it.
  const cosY = Math.cos(YAW);
  const sinY = Math.sin(YAW);
  const x = normal[0] * cosY - normal[1] * sinY;
  const y = normal[0] * sinY + normal[1] * cosY;
  return x * LIGHT[0] + y * LIGHT[1] + normal[2] * LIGHT[2];
}

function facing(normal: [number, number, number]): number {
  const cosY = Math.cos(YAW);
  const sinY = Math.sin(YAW);
  const y = normal[0] * sinY + normal[1] * cosY;
  return y * VIEW[1] + normal[2] * VIEW[2];
}

function parseColour(css: string): [number, number, number] {
  const n = parseInt(css.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Draws bodies as shaded solids in two warm greys with ink hairline edges, fitted into `region`.
 * A small software z-buffer keeps hidden faces and edges hidden; the picture is still.
 */
export function drawSolids(
  ctx: CanvasRenderingContext2D,
  bodies: readonly Placed[],
  region: Region,
  palette: Palette,
  pixelRatio: number,
): { slots: { x: number; width: number; baseline: number }[] } {
  const projected = bodies.map((b) => project(b.mesh, b.shiftX, b.shiftY ?? 0));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of projected) {
    for (let i = 0; i < p.sx.length; i++) {
      minX = Math.min(minX, p.sx[i] as number);
      maxX = Math.max(maxX, p.sx[i] as number);
      minY = Math.min(minY, p.sy[i] as number);
      maxY = Math.max(maxY, p.sy[i] as number);
    }
  }
  const scale = Math.min((region.width * 0.8) / (maxX - minX || 1), (region.height * 0.62) / (maxY - minY || 1));
  const offsetX = region.x + region.width / 2 - ((minX + maxX) / 2) * scale;
  const offsetY = region.y + region.height / 2 + ((minY + maxY) / 2) * scale;

  const w = Math.ceil(ctx.canvas.width);
  const h = Math.ceil(ctx.canvas.height);
  const image = ctx.getImageData(0, 0, w, h);
  const zbuffer = new Float32Array(w * h).fill(-Infinity);
  const light = parseColour(palette.light);
  const dark = parseColour(palette.dark);
  const ink = parseColour(palette.ink);
  const toX = (sx: number) => (offsetX + sx * scale) * pixelRatio;
  const toY = (sy: number) => (offsetY - sy * scale) * pixelRatio;
  const slots: { x: number; width: number; baseline: number }[] = [];

  bodies.forEach((body, bi) => {
    const proj = projected[bi] as Projected;
    const { vertices, triangles } = body.mesh;
    const normals: [number, number, number][] = triangles.map(([a, b, c]) => {
      const va = vertices[a] as number[];
      const vb = vertices[b] as number[];
      const vc = vertices[c] as number[];
      return normalize(cross([vb[0]! - va[0]!, vb[1]! - va[1]!, vb[2]! - va[2]!], [vc[0]! - va[0]!, vc[1]! - va[1]!, vc[2]! - va[2]!]));
    });
    const front = normals.map((n) => facing(n) < 0);
    let slotMin = Infinity, slotMax = -Infinity, slotLow = -Infinity;
    triangles.forEach(([a, b, c], ti) => {
      if (!front[ti]) return;
      const colour = toWorldDirection(normals[ti] as [number, number, number]) > 0.3 ? light : dark;
      const x0 = toX(proj.sx[a] as number), y0 = toY(proj.sy[a] as number);
      const x1 = toX(proj.sx[b] as number), y1 = toY(proj.sy[b] as number);
      const x2 = toX(proj.sx[c] as number), y2 = toY(proj.sy[c] as number);
      slotMin = Math.min(slotMin, x0, x1, x2);
      slotMax = Math.max(slotMax, x0, x1, x2);
      slotLow = Math.max(slotLow, y0, y1, y2);
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) < 1e-9) return;
      const loX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const hiX = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)));
      const loY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const hiY = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)));
      const d0 = proj.depth[a] as number, d1 = proj.depth[b] as number, d2 = proj.depth[c] as number;
      for (let y = loY; y <= hiY; y++) {
        for (let x = loX; x <= hiX; x++) {
          const px = x + 0.5, py = y + 0.5;
          const l0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / area;
          const l1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / area;
          const l2 = 1 - l0 - l1;
          if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
          const depth = l0 * d0 + l1 * d1 + l2 * d2;
          const at = y * w + x;
          if (depth <= (zbuffer[at] as number)) continue;
          zbuffer[at] = depth;
          image.data[at * 4] = colour[0];
          image.data[at * 4 + 1] = colour[1];
          image.data[at * 4 + 2] = colour[2];
          image.data[at * 4 + 3] = 255;
        }
      }
    });
    slots.push({ x: slotMin / pixelRatio, width: (slotMax - slotMin) / pixelRatio, baseline: slotLow / pixelRatio });

    // Edges: boundaries, silhouettes (front next to back) and creases sharper than 35 degrees.
    const owners = new Map<string, number[]>();
    triangles.forEach((tri, ti) => {
      for (let k = 0; k < 3; k++) {
        const a = tri[k] as number, b = tri[(k + 1) % 3] as number;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        owners.set(key, [...(owners.get(key) ?? []), ti]);
      }
    });
    for (const [key, tris] of owners) {
      const [first, second] = tris as [number, number | undefined];
      const sharp = second === undefined || (front[first] as boolean) !== (front[second] as boolean) ||
        dotNormals(normals[first] as number[], normals[second] as number[]) < CREASE;
      if (!sharp || !(front[first] || (second !== undefined && front[second]))) continue;
      const [a, b] = key.split(':').map(Number) as [number, number];
      line(image, zbuffer, w, h, toX(proj.sx[a] as number), toY(proj.sy[a] as number), proj.depth[a] as number, toX(proj.sx[b] as number), toY(proj.sy[b] as number), proj.depth[b] as number, ink, Math.max(1, Math.round(pixelRatio)));
    }
  });
  ctx.putImageData(image, 0, 0);
  return { slots };
}

const dotNormals = (a: number[], b: number[]): number => (a[0] as number) * (b[0] as number) + (a[1] as number) * (b[1] as number) + (a[2] as number) * (b[2] as number);

function line(
  image: ImageData,
  zbuffer: Float32Array,
  w: number,
  h: number,
  x0: number,
  y0: number,
  d0: number,
  x1: number,
  y1: number,
  d1: number,
  ink: [number, number, number],
  thickness: number,
): void {
  const steps = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
  for (let s = 0; s <= steps; s++) {
    const t = steps === 0 ? 0 : s / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    const depth = d0 + (d1 - d0) * t;
    for (let ox = 0; ox < thickness; ox++) {
      for (let oy = 0; oy < thickness; oy++) {
        const px = x + ox, py = y + oy;
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const at = py * w + px;
        if (depth < (zbuffer[at] as number) - 0.6) continue;
        image.data[at * 4] = ink[0];
        image.data[at * 4 + 1] = ink[1];
        image.data[at * 4 + 2] = ink[2];
        image.data[at * 4 + 3] = 255;
      }
    }
  }
}

/** Purchased parts have no stored body; they are drawn as a plain round fastener so every instance appears. */
export function fastenerMesh(partId: string): BodyMesh {
  const sides = 24;
  const vertices: [number, number, number][] = [];
  const triangles: [number, number, number][] = [];
  const ring = (radius: number, z: number) => {
    const start = vertices.length;
    for (let i = 0; i < sides; i++) vertices.push([radius * Math.cos((2 * Math.PI * i) / sides), radius * Math.sin((2 * Math.PI * i) / sides), z]);
    return start;
  };
  const stack = [ring(3, 0), ring(3, 2), ring(1.6, 2), ring(1.6, 12)];
  vertices.push([0, 0, 0], [0, 0, 12]);
  const bottom = vertices.length - 2;
  const top = vertices.length - 1;
  const band = (lo: number, hi: number) => {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      triangles.push([lo + i, lo + j, hi + j], [lo + i, hi + j, hi + i]);
    }
  };
  band(stack[0] as number, stack[1] as number);
  band(stack[1] as number, stack[2] as number);
  band(stack[2] as number, stack[3] as number);
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    triangles.push([bottom, (stack[0] as number) + j, (stack[0] as number) + i], [top, (stack[3] as number) + i, (stack[3] as number) + j]);
  }
  return { part_id: partId, build: 0, units: 'mm', vertices, triangles };
}
