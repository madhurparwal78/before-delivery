/**
 * Generates a quantized-mesh terrain pyramid for a corridor.
 *
 * Ground height is the linear interpolation, by chainage, of the two
 * neighbouring towers' base heights, the same across the corridor's width and
 * held at the end towers' heights beyond the ends. Each level samples that
 * surface on its own grid, so coarser levels differ by a few metres.
 */

import {
  interpolatedBaseHeight,
  projectOntoCentreline,
  type CorridorGeometry,
} from "../../shared/corridor.js";
import { toEcef, WGS84_A, WGS84_B, type Vec3 } from "../../shared/geodesy.js";

export const MAX_TERRAIN_LEVEL = 15;

const METRES_PER_DEGREE_LAT = 110_574;
const METRES_PER_DEGREE_LON = 111_320;

export interface TerrainFile {
  path: string;
  bytes: Uint8Array;
}

/** Vertices per tile edge. Finer levels get a denser grid so level 15 is within 0.2 m. */
function gridSize(level: number): number {
  if (level >= 12) return 33;
  if (level >= 8) return 17;
  return 9;
}

/** The fixture ground surface. Far from the corridor the ends' heights hold. */
export function sampleGroundHeight(
  corridor: CorridorGeometry,
  lonDeg: number,
  latDeg: number,
): number {
  const azimuth = (corridor.azimuthDeg * Math.PI) / 180;
  const dx =
    (lonDeg - corridor.originLonDeg) *
    METRES_PER_DEGREE_LON *
    Math.cos((corridor.originLatDeg * Math.PI) / 180);
  const dy = (latDeg - corridor.originLatDeg) * METRES_PER_DEGREE_LAT;
  const along = dx * Math.sin(azimuth) + dy * Math.cos(azimuth);
  const across = dx * Math.cos(azimuth) - dy * Math.sin(azimuth);

  if (Math.abs(along) > 20_000 || Math.abs(across) > 20_000) {
    return interpolatedBaseHeight(corridor, along <= 0 ? -1 : corridor.lengthM + 1);
  }
  const chainageM = projectOntoCentreline(corridor, lonDeg, latDeg).chainageM;
  return interpolatedBaseHeight(corridor, Number.isFinite(chainageM) ? chainageM : along);
}

interface TileCoordinates {
  level: number;
  x: number;
  y: number;
}

interface LevelRange {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

function tileSizeDegrees(level: number): number {
  return 180 / 2 ** level;
}

function corridorBounds(corridor: CorridorGeometry): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  let west = corridor.originLonDeg;
  let east = corridor.originLonDeg;
  let south = corridor.originLatDeg;
  let north = corridor.originLatDeg;
  for (const tower of corridor.towers) {
    west = Math.min(west, tower.lonDeg);
    east = Math.max(east, tower.lonDeg);
    south = Math.min(south, tower.latDeg);
    north = Math.max(north, tower.latDeg);
  }
  const padLat = 400 / METRES_PER_DEGREE_LAT;
  const padLon =
    400 / (METRES_PER_DEGREE_LON * Math.cos((corridor.originLatDeg * Math.PI) / 180));
  return {
    west: west - padLon,
    south: south - padLat,
    east: east + padLon,
    north: north + padLat,
  };
}

function levelRange(corridor: CorridorGeometry, level: number): LevelRange {
  const size = tileSizeDegrees(level);
  const bounds = corridorBounds(corridor);
  const columns = 2 ** (level + 1);
  const rows = 2 ** level;
  return {
    startX: clamp(Math.floor((bounds.west + 180) / size), 0, columns - 1),
    endX: clamp(Math.floor((bounds.east + 180) / size), 0, columns - 1),
    startY: clamp(Math.floor((bounds.south + 90) / size), 0, rows - 1),
    endY: clamp(Math.floor((bounds.north + 90) / size), 0, rows - 1),
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function zigZag(value: number): number {
  return ((value << 1) ^ (value >> 31)) & 0xffff;
}

function encodeDeltas(values: number[]): Uint16Array {
  const out = new Uint16Array(values.length);
  let previous = 0;
  for (let i = 0; i < values.length; i += 1) {
    out[i] = zigZag(values[i] - previous);
    previous = values[i];
  }
  return out;
}

function encodeIndices(indices: number[]): Uint16Array {
  const out = new Uint16Array(indices.length);
  let highest = 0;
  for (let i = 0; i < indices.length; i += 1) {
    const code = highest - indices[i];
    out[i] = code;
    if (code === 0) highest += 1;
  }
  return out;
}

function boundingSphere(points: Vec3[]): { center: Vec3; radius: number } {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    minZ = Math.min(minZ, p.z);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    maxZ = Math.max(maxZ, p.z);
  }
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
  let radius = 0;
  for (const p of points) {
    radius = Math.max(radius, Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z));
  }
  return { center, radius };
}

/** The horizon occlusion point in ellipsoid-scaled space, as the format requires. */
function horizonOcclusionPoint(points: Vec3[], center: Vec3): Vec3 {
  const scaled = { x: center.x / WGS84_A, y: center.y / WGS84_A, z: center.z / WGS84_B };
  const length = Math.hypot(scaled.x, scaled.y, scaled.z);
  const direction = { x: scaled.x / length, y: scaled.y / length, z: scaled.z / length };
  let maxMagnitude = 0;
  for (const p of points) {
    const sp = { x: p.x / WGS84_A, y: p.y / WGS84_A, z: p.z / WGS84_B };
    let magnitudeSquared = sp.x * sp.x + sp.y * sp.y + sp.z * sp.z;
    let magnitude = Math.sqrt(magnitudeSquared);
    const unit = { x: sp.x / magnitude, y: sp.y / magnitude, z: sp.z / magnitude };
    magnitudeSquared = Math.max(1, magnitudeSquared);
    magnitude = Math.max(1, magnitude);
    const cosAlpha = unit.x * direction.x + unit.y * direction.y + unit.z * direction.z;
    const cross = {
      x: unit.y * direction.z - unit.z * direction.y,
      y: unit.z * direction.x - unit.x * direction.z,
      z: unit.x * direction.y - unit.y * direction.x,
    };
    const sinAlpha = Math.hypot(cross.x, cross.y, cross.z);
    const cosBeta = 1 / magnitude;
    const sinBeta = Math.sqrt(magnitudeSquared - 1) * cosBeta;
    const denominator = cosAlpha * cosBeta - sinAlpha * sinBeta;
    if (denominator > 0) maxMagnitude = Math.max(maxMagnitude, 1 / denominator);
  }
  if (maxMagnitude === 0) maxMagnitude = 1;
  return {
    x: direction.x * maxMagnitude,
    y: direction.y * maxMagnitude,
    z: direction.z * maxMagnitude,
  };
}

function encodeTile(corridor: CorridorGeometry, tile: TileCoordinates): Uint8Array {
  const size = tileSizeDegrees(tile.level);
  const west = -180 + tile.x * size;
  const south = -90 + tile.y * size;
  const n = gridSize(tile.level);
  const last = n - 1;

  const heights: number[] = [];
  const positions: Vec3[] = [];
  for (let row = 0; row < n; row += 1) {
    const latDeg = south + (size * row) / last;
    for (let column = 0; column < n; column += 1) {
      const lonDeg = west + (size * column) / last;
      const height = sampleGroundHeight(corridor, lonDeg, latDeg);
      heights.push(height);
      positions.push(toEcef(lonDeg, latDeg, height));
    }
  }

  const minimumHeight = Math.min(...heights);
  const maximumHeight = Math.max(...heights);
  const heightRange = maximumHeight - minimumHeight;

  const us: number[] = [];
  const vs: number[] = [];
  const hs: number[] = [];
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      us.push(Math.round((32767 * column) / last));
      vs.push(Math.round((32767 * row) / last));
      hs.push(
        heightRange === 0
          ? 0
          : Math.round((32767 * (heights[row * n + column] - minimumHeight)) / heightRange),
      );
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < last; row += 1) {
    for (let column = 0; column < last; column += 1) {
      const a = row * n + column;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const westIndices: number[] = [];
  const eastIndices: number[] = [];
  const southIndices: number[] = [];
  const northIndices: number[] = [];
  for (let i = 0; i < n; i += 1) {
    westIndices.push(i * n);
    eastIndices.push(i * n + last);
    southIndices.push(i);
    northIndices.push(last * n + i);
  }

  const sphere = boundingSphere(positions);
  const occlusion = horizonOcclusionPoint(positions, sphere.center);

  const vertexCount = us.length;
  const encodedU = encodeDeltas(us);
  const encodedV = encodeDeltas(vs);
  const encodedH = encodeDeltas(hs);
  const encodedIndices = encodeIndices(indices);

  const edgeBytes = 4 * 4 + 2 * (westIndices.length + southIndices.length + eastIndices.length + northIndices.length);
  const total =
    88 + 4 + vertexCount * 6 + 4 + encodedIndices.length * 2 + edgeBytes;
  const buffer = Buffer.alloc(total);
  let offset = 0;

  buffer.writeDoubleLE(sphere.center.x, offset); offset += 8;
  buffer.writeDoubleLE(sphere.center.y, offset); offset += 8;
  buffer.writeDoubleLE(sphere.center.z, offset); offset += 8;
  buffer.writeFloatLE(minimumHeight, offset); offset += 4;
  buffer.writeFloatLE(maximumHeight, offset); offset += 4;
  buffer.writeDoubleLE(sphere.center.x, offset); offset += 8;
  buffer.writeDoubleLE(sphere.center.y, offset); offset += 8;
  buffer.writeDoubleLE(sphere.center.z, offset); offset += 8;
  buffer.writeDoubleLE(sphere.radius, offset); offset += 8;
  buffer.writeDoubleLE(occlusion.x, offset); offset += 8;
  buffer.writeDoubleLE(occlusion.y, offset); offset += 8;
  buffer.writeDoubleLE(occlusion.z, offset); offset += 8;

  buffer.writeUInt32LE(vertexCount, offset); offset += 4;
  for (const value of encodedU) { buffer.writeUInt16LE(value, offset); offset += 2; }
  for (const value of encodedV) { buffer.writeUInt16LE(value, offset); offset += 2; }
  for (const value of encodedH) { buffer.writeUInt16LE(value, offset); offset += 2; }

  buffer.writeUInt32LE(indices.length / 3, offset); offset += 4;
  for (const value of encodedIndices) { buffer.writeUInt16LE(value, offset); offset += 2; }

  for (const edge of [westIndices, southIndices, eastIndices, northIndices]) {
    buffer.writeUInt32LE(edge.length, offset); offset += 4;
    for (const value of edge) { buffer.writeUInt16LE(value, offset); offset += 2; }
  }

  return new Uint8Array(buffer);
}

/** The whole pyramid: `layer.json` plus one `.terrain` file per available tile. */
export function buildTerrainPyramid(corridor: CorridorGeometry): TerrainFile[] {
  const files: TerrainFile[] = [];
  const available: LevelRange[][] = [];

  for (let level = 0; level <= MAX_TERRAIN_LEVEL; level += 1) {
    const range = levelRange(corridor, level);
    available.push([range]);
    for (let x = range.startX; x <= range.endX; x += 1) {
      for (let y = range.startY; y <= range.endY; y += 1) {
        files.push({
          path: `${level}/${x}/${y}.terrain`,
          bytes: encodeTile(corridor, { level, x, y }),
        });
      }
    }
  }

  const bounds = corridorBounds(corridor);
  const layer = {
    tilejson: "2.1.0",
    name: "Spanwise corridor terrain",
    description: "Procedurally generated corridor terrain",
    version: "1.0.0",
    format: "quantized-mesh-1.0",
    scheme: "tms",
    projection: "EPSG:4326",
    tiles: ["{z}/{x}/{y}.terrain"],
    bounds: [bounds.west, bounds.south, bounds.east, bounds.north],
    minzoom: 0,
    maxzoom: MAX_TERRAIN_LEVEL,
    available,
  };
  files.unshift({
    path: "layer.json",
    bytes: new TextEncoder().encode(`${JSON.stringify(layer, null, 2)}\n`),
  });
  return files;
}
