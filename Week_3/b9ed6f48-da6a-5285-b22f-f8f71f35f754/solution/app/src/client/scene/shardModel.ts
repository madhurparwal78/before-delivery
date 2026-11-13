// The anamorphic shard sculpture, built in code from a chapter's numeral and title. The text is
// rasterised, sampled into points on a plane that faces the sightline camera, and each shard is
// pushed along its ray from that camera to a random depth (scaled to keep its apparent size).
// From the sightline the shards line up into the text; from anywhere else they are a cloud.
// Settling moves every shard back onto the plane.

const CAMERA_DISTANCE = 7;
const FOV_DEG = 42;
const PLANE_WIDTH = 4;
const PLANE_HEIGHT = 2.6;
const RASTER_W = 1000;
const RASTER_H = 650;

type Vec3 = [number, number, number];

export interface ShardModel {
  count: number;
  /** Point on the text plane per shard (x, y, z). */
  plane: Float32Array;
  /** Depth factor per shard: 1 is on the plane, <1 nearer the sightline camera. */
  depth: Float32Array;
  /** Two in-plane edge vectors per shard (ax, ay, bx, by) in plane units. */
  edges: Float32Array;
  /** Brightness 0..1 per shard. */
  shade: Float32Array;
  /** Sightline camera position and the plane's right and up axes. */
  eye: Vec3;
  right: Vec3;
  up: Vec3;
}

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cameraAt(yawDeg: number): Vec3 {
  const yaw = (yawDeg * Math.PI) / 180;
  return [CAMERA_DISTANCE * Math.sin(yaw), 0.35, CAMERA_DISTANCE * Math.cos(yaw)];
}

function wrapTitle(ctx: CanvasRenderingContext2D, title: string, width: number): string[] {
  const words = title.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  lines.push(line);
  return lines;
}

/** Target points sampled from the rasterised numeral (coarse) and title (fine). */
function textPoints(numeral: string, title: string): { x: number; y: number; size: number }[] {
  const canvas = document.createElement("canvas");
  canvas.width = RASTER_W;
  canvas.height = RASTER_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  const points: { x: number; y: number; size: number }[] = [];
  const sample = (draw: () => void, step: number, size: number) => {
    ctx.clearRect(0, 0, RASTER_W, RASTER_H);
    ctx.fillStyle = "#fff";
    draw();
    const data = ctx.getImageData(0, 0, RASTER_W, RASTER_H).data;
    for (let y = step / 2; y < RASTER_H; y += step) {
      for (let x = (y / step) % 2 ? step / 2 : 0; x < RASTER_W; x += step) {
        if (data[(Math.floor(y) * RASTER_W + Math.floor(x)) * 4 + 3] > 140) points.push({ x, y, size });
      }
    }
  };
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  sample(() => {
    ctx.font = '400 330px "Instrument Serif", Georgia, serif';
    ctx.fillText(numeral, RASTER_W / 2, 330);
  }, 9, 1.35);
  sample(() => {
    ctx.font = '400 92px "Instrument Serif", Georgia, serif';
    wrapTitle(ctx, title, RASTER_W * 0.92).forEach((line, i, all) => ctx.fillText(line, RASTER_W / 2, 470 + i * 96 - (all.length - 1) * 30));
  }, 4.5, 0.75);
  return points;
}

export function buildModel(numeral: string, title: string, sightlineDeg: number, seed: number): ShardModel {
  const rand = prng(seed);
  const eye = cameraAt(sightlineDeg);
  const len = Math.hypot(eye[0], eye[2]);
  const right: Vec3 = [eye[2] / len, 0, -eye[0] / len];
  const up: Vec3 = [0, 1, 0];
  const targets = textPoints(numeral, title);
  const dust = Math.round(targets.length * 0.12);
  const count = targets.length + dust;
  const plane = new Float32Array(count * 3);
  const depth = new Float32Array(count);
  const edges = new Float32Array(count * 4);
  const shade = new Float32Array(count);
  const unit = PLANE_WIDTH / RASTER_W;
  for (let i = 0; i < count; i++) {
    const t = targets[i];
    const u = t ? (t.x - RASTER_W / 2) * unit + (rand() - 0.5) * unit * 2 : (rand() - 0.5) * PLANE_WIDTH * 1.5;
    const v = t ? (RASTER_H / 2 - t.y) * (PLANE_HEIGHT / RASTER_H) + (rand() - 0.5) * unit * 2 : (rand() - 0.5) * PLANE_HEIGHT * 1.6;
    plane.set([u * right[0] + v * up[0], u * right[1] + v * up[1], u * right[2] + v * up[2]], i * 3);
    depth[i] = 0.42 + rand() * 1.1;
    const size = (t ? t.size : 0.6 + rand() * 0.6) * unit * 9;
    const angle = rand() * Math.PI * 2;
    const spread = 1.6 + rand() * 1.4;
    edges.set([Math.cos(angle) * size, Math.sin(angle) * size, Math.cos(angle + spread) * size * (0.6 + rand() * 0.6), Math.sin(angle + spread) * size * (0.6 + rand() * 0.6)], i * 4);
    shade[i] = t ? 0.72 + rand() * 0.28 : 0.25 + rand() * 0.3;
  }
  return { count, plane, depth, edges, shade, eye, right, up };
}

/** World position of shard `i` at settle progress `p` (0 scattered, 1 on the plane). */
export function shardPosition(m: ShardModel, i: number, p: number): { x: number; y: number; z: number; scale: number } {
  const s = m.depth[i] + (1 - m.depth[i]) * p;
  const px = m.plane[i * 3];
  const py = m.plane[i * 3 + 1];
  const pz = m.plane[i * 3 + 2];
  return { x: m.eye[0] + s * (px - m.eye[0]), y: m.eye[1] + s * (py - m.eye[1]), z: m.eye[2] + s * (pz - m.eye[2]), scale: s };
}

/**
 * The vertical field of view that keeps the text plane inside a canvas of this aspect ratio. The
 * camera never moves off its orbit, because the shards only line up from the sightline eye point.
 */
export function fovFor(aspect: number): number {
  const base = Math.tan((FOV_DEG * Math.PI) / 360);
  const needed = Math.max(base, (PLANE_WIDTH * 0.6) / CAMERA_DISTANCE / aspect, (PLANE_HEIGHT * 0.62) / CAMERA_DISTANCE);
  return (2 * Math.atan(needed) * 180) / Math.PI;
}

/**
 * Draws the sculpture seen from `yawDeg` on a 2D canvas, with the same geometry and camera as the
 * WebGL scene; used for the still viewpoints.
 */
export function drawStill(canvas: HTMLCanvasElement, m: ShardModel, yawDeg: number, ground: string, ink: [number, number, number]): void {
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, h);
  const distance = CAMERA_DISTANCE;
  const cam = cameraAt(yawDeg);
  const forward = [-cam[0], -cam[1], -cam[2]];
  const fl = Math.hypot(forward[0], forward[1], forward[2]);
  const f: Vec3 = [forward[0] / fl, forward[1] / fl, forward[2] / fl];
  const rl = Math.hypot(f[2], f[0]);
  const r: Vec3 = [-f[2] / rl, 0, f[0] / rl];
  const u: Vec3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const focal = h / 2 / Math.tan((fovFor(w / h) * Math.PI) / 360);
  const project = (x: number, y: number, z: number): [number, number, number] => {
    const dx = x - cam[0];
    const dy = y - cam[1];
    const dz = z - cam[2];
    const depth = dx * f[0] + dy * f[1] + dz * f[2];
    return [w / 2 + ((dx * r[0] + dy * r[1] + dz * r[2]) * focal) / depth, h / 2 - ((dx * u[0] + dy * u[1] + dz * u[2]) * focal) / depth, depth];
  };
  const order = Array.from({ length: m.count }, (_, i) => i);
  const projected = order.map((i) => {
    const p = shardPosition(m, i, 0);
    const ax = m.edges[i * 4] * p.scale;
    const ay = m.edges[i * 4 + 1] * p.scale;
    const bx = m.edges[i * 4 + 2] * p.scale;
    const by = m.edges[i * 4 + 3] * p.scale;
    const corner = (a: number, b: number) => project(p.x + a * m.right[0] + b * m.up[0], p.y + a * m.right[1] + b * m.up[1], p.z + a * m.right[2] + b * m.up[2]);
    return { i, pts: [project(p.x, p.y, p.z), corner(ax, ay), corner(bx, by)] };
  });
  projected.sort((a, b) => b.pts[0][2] - a.pts[0][2]);
  for (const { i, pts } of projected) {
    const fog = Math.max(0.25, Math.min(1, 1.35 - (pts[0][2] - distance * 0.6) / (distance * 1.2)));
    const k = m.shade[i] * fog;
    ctx.fillStyle = `rgb(${Math.round(ink[0] * k)}, ${Math.round(ink[1] * k)}, ${Math.round(ink[2] * k)})`;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    ctx.lineTo(pts[1][0], pts[1][1]);
    ctx.lineTo(pts[2][0], pts[2][1]);
    ctx.closePath();
    ctx.fill();
  }
}
