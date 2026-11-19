import { corridorModel, fixtureGroundHeight, type CorridorModel } from './corridors.js';
import { centrelinePoint } from './geometry.js';
import { buildAshCreekCzml } from './flight.js';

/**
 * Fixture content generator for seeded survey assets. Each file's bytes are
 * deterministic in (asset id, path), so every process generates identical
 * bytes for the same object, and storage confirmation can compare checksums.
 */

function hashSeed(assetId: string, path: string): number {
  let h = 2166136261;
  const s = `${assetId}/${path}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function fixtureFileBytes(assetId: string, corridorId: string, path: string): Uint8Array {
  const model = corridorModel(corridorId);
  if (!model) throw new Error(`Unknown corridor ${corridorId}`);
  const text = fixtureFileText(assetId, model, path);
  return Buffer.from(text, 'utf8');
}

function fixtureFileText(assetId: string, model: CorridorModel, path: string): string {
  if (path === 'layer.json') return layerJson(model);
  if (path === 'tileset.json') return tilesetJson(model);
  if (path.endsWith('.czml')) {
    if (model.seed.id === 'nm-ash-creek') return buildAshCreekCzml(model);
    return JSON.stringify([{ id: 'document', name: 'flight', version: '1.0' }]);
  }
  if (path.endsWith('.terrain')) return quantizedMesh(model, path);
  if (path.endsWith('.glb')) return glbTile(model, path);
  throw new Error(`Unknown fixture file ${path}`);
}

/** Terrain pyramid metadata: 16 levels, web-mercator style tiling. */
function layerJson(model: CorridorModel): string {
  const tilesPerLevel = (level: number) => 2 ** Math.min(level, 4);
  return JSON.stringify({
    tilejson: '2.1.0',
    scheme: 'tms',
    format: 'quantized-mesh-1.0',
    version: '1.0.0',
    minLevel: 0,
    maxLevel: 15,
    bounds: corridorBounds(model),
    projection: 'EPSG:4326',
    description: `${model.seed.name} terrain pyramid fixture`,
    levels: Array.from({ length: 16 }, (_, level) => ({
      level,
      tiles: tilesPerLevel(level),
      tileX: tilesPerLevel(level),
      tileY: 1,
    })),
    extensions: ['oct-encoding'],
  });
}

function corridorBounds(model: CorridorModel): [number, number, number, number] {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const t of model.centreline.towers) {
    minLon = Math.min(minLon, t.lonDeg);
    maxLon = Math.max(maxLon, t.lonDeg);
    minLat = Math.min(minLat, t.latDeg);
    maxLat = Math.max(maxLat, t.latDeg);
  }
  return [minLon, minLat, maxLon, maxLat];
}

function quantizedMesh(model: CorridorModel, path: string): string {
  // A small human-readable quantized-mesh-like payload. The browser worker
  // samples ground height from the fixture rule, so the payload records the
  // tile's chainage window and its level.
  const m = /^(?:tiles\/)?(\d+)\/(\d+)\/(\d+)\.terrain$/.exec(path);
  const level = m ? Number(m[1]) : 0;
  const rand = rng(hashSeed(model.seed.id, path));
  const sample = model.lengthM * rand();
  return JSON.stringify({
    format: 'quantized-mesh-1.0',
    level,
    x: m ? Number(m[2]) : 0,
    y: m ? Number(m[3]) : 0,
    corridor: model.seed.id,
    sampleChainageM: Math.round(sample * 10) / 10,
    groundHeightM: fixtureGroundHeight(model.seed, sample),
    vertices: 65,
  });
}

function tilesetJson(model: CorridorModel): string {
  const rand = rng(hashSeed(model.seed.id, 'tileset.json'));
  const glbCount = 8;
  const tiles = Array.from({ length: glbCount }, (_, i) => {
    const c = ((i + rand()) / glbCount) * model.lengthM;
    return {
      boundingVolume: { chainageM: Math.round(c * 10) / 10 },
      geometricError: 32,
      refine: 'REPLACE',
      content: { uri: `tiles/tile-${i}.glb` },
    };
  });
  return JSON.stringify({
    asset: { version: '1.1', generator: 'spanwise-fixture' },
    geometricError: 512,
    root: { boundingVolume: { bounds: corridorBounds(model) }, geometricError: 256, refine: 'REPLACE', children: tiles },
    description: `${model.seed.name} reality mesh fixture`,
  });
}

function glbTile(model: CorridorModel, path: string): string {
  const m = /^tiles\/tile-(\d+)\.glb$/.exec(path);
  const idx = m ? Number(m[1]) : 0;
  const rand = rng(hashSeed(model.seed.id, path));
  const c = ((idx + rand() * 0.5) / 8) * model.lengthM;
  const p = centrelinePoint(model.centreline, c, 0, fixtureGroundHeight(model.seed, c));
  return JSON.stringify({
    format: 'spanwise-fixture-glb',
    corridor: model.seed.id,
    tile: idx,
    centre: { lonDeg: p.lonDeg, latDeg: p.latDeg, heightM: p.heightM },
    trees: [
      { comment: 'canopy cluster', radiusM: 4, heightM: 18 },
    ],
    textures: ['texture.ktx2'],
  });
}

/** Manifest of every fixture file for a seeded asset. */
export function fixtureManifest(corridorId: string, kind: 'terrain' | 'tileset' | 'czml'): Array<{ path: string }> {
  const paths: Array<{ path: string }> = [];
  if (kind === 'terrain') {
    paths.push({ path: 'layer.json' });
    for (let level = 0; level <= 15; level++) {
      const n = 2 ** Math.min(level, 4);
      for (let x = 0; x < n; x++) {
        paths.push({ path: `tiles/${level}/${x}/0.terrain` });
      }
    }
  } else if (kind === 'tileset') {
    paths.push({ path: 'tileset.json' });
    for (let i = 0; i < 8; i++) paths.push({ path: `tiles/tile-${i}.glb` });
  } else {
    paths.push({ path: 'ash-creek-2026-06-14.czml' });
  }
  return paths;
}
