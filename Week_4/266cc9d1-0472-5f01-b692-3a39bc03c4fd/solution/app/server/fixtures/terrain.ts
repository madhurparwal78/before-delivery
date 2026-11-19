// A quantized-mesh-1.0 terrain pyramid (geographic tiling, TMS rows) for one corridor, levels
// 0 to 15. Every level samples the fixture ground on its own 33 x 33 grid, so coarse levels differ
// from the true ground by a few metres and level 15 by a few centimetres.
import { direct, toEcef, WGS84_A as A, WGS84_B as B } from "../../shared/geodesy.js";
import { groundHeight, type FixtureCorridor } from "./ground.js";

const MAX_LEVEL = 15;
const GRID = 33;
const MARGIN_M = 400;

type Vec3 = [number, number, number];

function scaled(p: Vec3): Vec3 {
  return [p[0] / A, p[1] / A, p[2] / B];
}

function normalise(p: Vec3): Vec3 {
  const m = Math.hypot(p[0], p[1], p[2]);
  return [p[0] / m, p[1] / m, p[2] / m];
}

/** The horizon-occlusion point in ellipsoid-scaled space (after Cesium's EllipsoidalOccluder). */
function horizonOcclusionPoint(points: Vec3[], direction: Vec3): Vec3 {
  const toPoint = normalise(scaled(direction));
  let magnitude = 0;
  for (const point of points) {
    const s = scaled(point);
    const squared = Math.max(1, s[0] ** 2 + s[1] ** 2 + s[2] ** 2);
    const length = Math.sqrt(squared);
    const unit = normalise(s);
    const cosAlpha = unit[0] * toPoint[0] + unit[1] * toPoint[1] + unit[2] * toPoint[2];
    const cross: Vec3 = [
      unit[1] * toPoint[2] - unit[2] * toPoint[1],
      unit[2] * toPoint[0] - unit[0] * toPoint[2],
      unit[0] * toPoint[1] - unit[1] * toPoint[0],
    ];
    const sinAlpha = Math.hypot(cross[0], cross[1], cross[2]);
    const cosBeta = 1 / length;
    const sinBeta = Math.sqrt(squared - 1) * cosBeta;
    const denominator = cosAlpha * cosBeta - sinAlpha * sinBeta;
    if (denominator <= 0) return [toPoint[0] * 1e6, toPoint[1] * 1e6, toPoint[2] * 1e6];
    magnitude = Math.max(magnitude, 1 / denominator);
  }
  return [toPoint[0] * magnitude, toPoint[1] * magnitude, toPoint[2] * magnitude];
}

function zigzag(value: number): number {
  return ((value << 1) ^ (value >> 31)) & 0xffff;
}

interface Rect {
  west: number;
  south: number;
  east: number;
  north: number;
}

function tileRect(level: number, x: number, yTms: number): Rect {
  const size = 180 / 2 ** level;
  return { west: -180 + x * size, south: -90 + yTms * size, east: -180 + (x + 1) * size, north: -90 + (yTms + 1) * size };
}

function encodeTile(corridor: FixtureCorridor, rect: Rect): Buffer {
  const n = GRID;
  const lon = (i: number) => rect.west + ((rect.east - rect.west) * i) / (n - 1);
  const lat = (j: number) => rect.south + ((rect.north - rect.south) * j) / (n - 1);

  const triangles: number[] = [];
  for (let j = 0; j < n - 1; j += 1) {
    for (let i = 0; i < n - 1; i += 1) {
      const sw = j * n + i;
      const se = sw + 1;
      const nw = sw + n;
      const ne = nw + 1;
      triangles.push(sw, se, nw, se, ne, nw);
    }
  }
  // Number vertices in order of first use, as high-water-mark index encoding requires.
  const order: number[] = [];
  const renumbered = new Map<number, number>();
  for (const grid of triangles) {
    if (!renumbered.has(grid)) {
      renumbered.set(grid, order.length);
      order.push(grid);
    }
  }
  const count = order.length;
  const heights = order.map((g) => groundHeight(corridor, lon(g % n), lat(Math.floor(g / n))));
  const minHeight = Math.min(...heights);
  const maxHeight = Math.max(...heights);
  const positions = order.map((g, k) => toEcef(lon(g % n), lat(Math.floor(g / n)), heights[k] ?? 0));

  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of positions) {
    for (let a = 0; a < 3; a += 1) {
      lo[a] = Math.min(lo[a] ?? Infinity, p[a] ?? 0);
      hi[a] = Math.max(hi[a] ?? -Infinity, p[a] ?? 0);
    }
  }
  const centre: Vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const radius = Math.max(...positions.map((p) => Math.hypot(p[0] - centre[0], p[1] - centre[1], p[2] - centre[2])));
  const surfaceCentre = toEcef((rect.west + rect.east) / 2, (rect.south + rect.north) / 2, (minHeight + maxHeight) / 2);
  const horizon = horizonOcclusionPoint(positions, surfaceCentre);

  const header = Buffer.alloc(88);
  [surfaceCentre[0], surfaceCentre[1], surfaceCentre[2]].forEach((v, k) => header.writeDoubleLE(v, k * 8));
  header.writeFloatLE(minHeight, 24);
  header.writeFloatLE(maxHeight, 28);
  [centre[0], centre[1], centre[2], radius, horizon[0], horizon[1], horizon[2]].forEach((v, k) => header.writeDoubleLE(v, 32 + k * 8));

  const vertexData = Buffer.alloc(4 + count * 6);
  vertexData.writeUInt32LE(count, 0);
  const span = maxHeight - minHeight;
  let pu = 0;
  let pv = 0;
  let ph = 0;
  order.forEach((g, k) => {
    const u = Math.round(((g % n) / (n - 1)) * 32767);
    const v = Math.round((Math.floor(g / n) / (n - 1)) * 32767);
    const h = span === 0 ? 0 : Math.round((((heights[k] ?? minHeight) - minHeight) / span) * 32767);
    vertexData.writeUInt16LE(zigzag(u - pu), 4 + k * 2);
    vertexData.writeUInt16LE(zigzag(v - pv), 4 + count * 2 + k * 2);
    vertexData.writeUInt16LE(zigzag(h - ph), 4 + count * 4 + k * 2);
    pu = u;
    pv = v;
    ph = h;
  });

  const indexData = Buffer.alloc(4 + triangles.length * 2);
  indexData.writeUInt32LE(triangles.length / 3, 0);
  let highest = 0;
  triangles.forEach((grid, k) => {
    const index = renumbered.get(grid) ?? 0;
    const code = highest - index;
    indexData.writeUInt16LE(code, 4 + k * 2);
    if (code === 0) highest += 1;
  });

  const edge = (test: (i: number, j: number) => boolean, key: (i: number, j: number) => number): Buffer => {
    const members = order
      .map((g, k) => ({ k, i: g % n, j: Math.floor(g / n) }))
      .filter(({ i, j }) => test(i, j))
      .sort((a, b) => key(a.i, a.j) - key(b.i, b.j));
    const out = Buffer.alloc(4 + members.length * 2);
    out.writeUInt32LE(members.length, 0);
    members.forEach((m, k) => out.writeUInt16LE(m.k, 4 + k * 2));
    return out;
  };
  return Buffer.concat([
    header,
    vertexData,
    indexData,
    edge((i) => i === 0, (_i, j) => j),
    edge((_i, j) => j === 0, (i) => i),
    edge((i) => i === n - 1, (_i, j) => j),
    edge((_i, j) => j === n - 1, (i) => i),
  ]);
}

/** layer.json plus every tile, keyed by its path in the asset. */
export function terrainPyramid(corridor: FixtureCorridor, name: string): Map<string, Buffer> {
  const last = corridor.towers[corridor.towers.length - 1]?.chainageM ?? 0;
  const corners = [-MARGIN_M, last + MARGIN_M].flatMap((c) =>
    [-MARGIN_M, MARGIN_M].map((offset) => {
      const foot = c >= 0 ? direct(corridor.line.origin, corridor.line.azimuthDeg, c) : direct(corridor.line.origin, corridor.line.azimuthDeg + 180, -c);
      return direct(foot, corridor.line.azimuthDeg + 90, offset);
    }),
  );
  const bounds = {
    west: Math.min(...corners.map((p) => p.lonDeg)),
    east: Math.max(...corners.map((p) => p.lonDeg)),
    south: Math.min(...corners.map((p) => p.latDeg)),
    north: Math.max(...corners.map((p) => p.latDeg)),
  };
  const files = new Map<string, Buffer>();
  const available: Array<Array<{ startX: number; startY: number; endX: number; endY: number }>> = [];
  for (let level = 0; level <= MAX_LEVEL; level += 1) {
    const size = 180 / 2 ** level;
    const range =
      level === 0
        ? { startX: 0, startY: 0, endX: 1, endY: 0 }
        : {
            startX: Math.floor((bounds.west + 180) / size),
            endX: Math.floor((bounds.east + 180) / size),
            startY: Math.floor((bounds.south + 90) / size),
            endY: Math.floor((bounds.north + 90) / size),
          };
    available.push([range]);
    for (let x = range.startX; x <= range.endX; x += 1) {
      for (let y = range.startY; y <= range.endY; y += 1) {
        files.set(`${level}/${x}/${y}.terrain`, encodeTile(corridor, tileRect(level, x, y)));
      }
    }
  }
  const layer = {
    tilejson: "2.1.0",
    name,
    description: "Procedurally generated survey terrain",
    version: "1.0.0",
    format: "quantized-mesh-1.0",
    scheme: "tms",
    tiles: ["{z}/{x}/{y}.terrain"],
    projection: "EPSG:4326",
    bounds: [-180, -90, 180, 90],
    minzoom: 0,
    maxzoom: MAX_LEVEL,
    available,
  };
  files.set("layer.json", Buffer.from(JSON.stringify(layer, null, 2), "utf8"));
  return files;
}
