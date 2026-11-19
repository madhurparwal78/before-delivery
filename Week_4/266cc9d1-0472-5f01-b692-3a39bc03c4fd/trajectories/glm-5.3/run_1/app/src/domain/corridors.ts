import { add, DEG, dot, Ecef, eastNorth, Geodetic, geodeticToEcef, normalize, norm, pointSegmentDistance, scale, sub } from './geodesy.js';
import { buildCentreline, Centreline, centrelinePoint, projectOntoCentreline } from './geometry.js';

export type UtilitySeed = {
  id: string;
  name: string;
  tenantId: string;
  timeZone: string;
  foresterName: string;
  foresterEmail: string;
};

export type CorridorSeed = {
  id: string;
  name: string;
  utilityId: string;
  voltageKv: number;
  clearanceThresholdM: number;
  inspectionDue: string;
  tower1: { latDeg: number; lonDeg: number };
  azimuthDeg: number;
  towers: Array<{ chainageM: number; baseHeightM: number }>;
  attachmentHeightM: number;
};

export const UTILITIES: UtilitySeed[] = [
  {
    id: 'northmere', name: 'Northmere Power Cooperative', tenantId: 'kestrel',
    timeZone: 'America/Chicago', foresterName: 'Dana Okafor', foresterEmail: 'dana.okafor@northmere.example',
  },
  {
    id: 'sallow', name: 'Sallow Valley Electric', tenantId: 'kestrel',
    timeZone: 'America/Denver', foresterName: 'Lee Marchetti', foresterEmail: 'lee.marchetti@sallowvalley.example',
  },
  {
    id: 'harrow', name: 'Harrow Coast Utilities', tenantId: 'bluefen',
    timeZone: 'America/Los_Angeles', foresterName: 'Sam Whitlock', foresterEmail: 'sam.whitlock@harrowcoast.example',
  },
];

const ashTowers: Array<[number, number]> = [
  [0, 248.0], [312, 251.5], [640, 255.0], [955, 253.0], [1268, 249.5],
  [1590, 246.0], [1904, 247.5], [2231, 252.0], [2550, 256.5], [2870, 254.0],
];

export const CORRIDORS: CorridorSeed[] = [
  {
    id: 'nm-ash-creek', name: 'Ash Creek 345 kV', utilityId: 'northmere',
    voltageKv: 345, clearanceThresholdM: 3.0, inspectionDue: '2026-03-31',
    tower1: { latDeg: 44.5, lonDeg: -93.2 }, azimuthDeg: 90,
    towers: ashTowers.map(([c, h]) => ({ chainageM: c, baseHeightM: h })),
    attachmentHeightM: 24.0,
  },
  {
    id: 'nm-birch-hollow', name: 'Birch Hollow 138 kV', utilityId: 'northmere',
    voltageKv: 138, clearanceThresholdM: 1.6, inspectionDue: '2030-06-30',
    tower1: { latDeg: 44.62, lonDeg: -93.05 }, azimuthDeg: 45,
    towers: [0, 210, 430, 655, 870, 1085].map((c) => ({ chainageM: c, baseHeightM: 300.0 })),
    attachmentHeightM: 18.0,
  },
  {
    id: 'sv-cutbank', name: 'Cutbank 230 kV', utilityId: 'sallow',
    voltageKv: 230, clearanceThresholdM: 2.2, inspectionDue: '2030-09-30',
    tower1: { latDeg: 40.1, lonDeg: -105.3 }, azimuthDeg: 0,
    towers: [0, 380, 760, 1150].map((c) => ({ chainageM: c, baseHeightM: 1650.0 })),
    attachmentHeightM: 30.0,
  },
  {
    id: 'hc-dune-road', name: 'Dune Road 115 kV', utilityId: 'harrow',
    voltageKv: 115, clearanceThresholdM: 1.4, inspectionDue: '2030-05-31',
    tower1: { latDeg: 36.8, lonDeg: -121.7 }, azimuthDeg: 120,
    towers: [0, 250, 500].map((c) => ({ chainageM: c, baseHeightM: 20.0 })),
    attachmentHeightM: 20.0,
  },
];

/** Fixture terrain: linear interpolation by chainage between neighbouring towers. */
export function fixtureGroundHeight(corridor: CorridorSeed, chainageM: number): number {
  const towers = corridor.towers;
  if (chainageM <= towers[0].chainageM) return towers[0].baseHeightM;
  for (let i = 0; i < towers.length - 1; i++) {
    const a = towers[i];
    const b = towers[i + 1];
    if (chainageM >= a.chainageM && chainageM <= b.chainageM) {
      const t = (chainageM - a.chainageM) / (b.chainageM - a.chainageM);
      return a.baseHeightM + (b.baseHeightM - a.baseHeightM) * t;
    }
  }
  return towers[towers.length - 1].baseHeightM;
}

export type CorridorModel = {
  seed: CorridorSeed;
  centreline: Centreline;
  lengthM: number;
};

const modelCache = new Map<string, CorridorModel>();

export function corridorModel(id: string): CorridorModel | undefined {
  const cached = modelCache.get(id);
  if (cached) return cached;
  const seed = CORRIDORS.find((c) => c.id === id);
  if (!seed) return undefined;
  const start: Geodetic = { lonDeg: seed.tower1.lonDeg, latDeg: seed.tower1.latDeg, heightM: 0 };
  const centreline = buildCentreline(start, seed.azimuthDeg, seed.towers.map((t) => ({
    chainageM: t.chainageM, baseHeightM: t.baseHeightM, attachmentHeightM: seed.attachmentHeightM,
  })));
  const model: CorridorModel = {
    seed,
    centreline,
    lengthM: seed.towers[seed.towers.length - 1].chainageM,
  };
  modelCache.set(id, model);
  return model;
}

/** Span containing a chainage: tower k to k+1; corridor length belongs to the last span. */
export function spanForChainage(model: CorridorModel, chainageM: number): { fromTower: number; toTower: number; label: string } {
  const towers = model.centreline.towers;
  for (let i = 0; i < towers.length - 1; i++) {
    if (chainageM >= towers[i].chainageM && chainageM < towers[i + 1].chainageM) {
      return { fromTower: towers[i].number, toTower: towers[i + 1].number, label: `Span ${towers[i].number}–${towers[i + 1].number}` };
    }
  }
  const last = towers[towers.length - 1];
  return { fromTower: towers[towers.length - 2].number, toTower: last.number, label: `Span ${towers[towers.length - 2].number}–${last.number}` };
}

/** Attachment point of a tower: at its position, at base + attachment height. */
export function towerAttachment(model: CorridorModel, towerNumber: number): Ecef {
  const t = model.centreline.towers.find((x) => x.number === towerNumber);
  if (!t) throw new Error(`Unknown tower ${towerNumber}`);
  return geodeticToEcef({ lonDeg: t.lonDeg, latDeg: t.latDeg, heightM: t.baseHeightM + t.attachmentHeightM });
}

/** Derive every computed field of a finding. One place decides clearance and status. */
export function deriveFinding(model: CorridorModel, input: {
  chainageM: number; offsetM: number; groundHeightM: number;
  canopyHeightM: number; canopyRadiusM: number;
}): {
  lonDeg: number; latDeg: number; ecef: Ecef;
  canopyTopHeightM: number; clearanceM: number;
  status: 'violation' | 'clear'; span: { fromTower: number; toTower: number; label: string };
} {
  const g = centrelinePoint(model.centreline, input.chainageM, input.offsetM, input.groundHeightM);
  const ecef = geodeticToEcef(g);
  const canopyTopHeightM = input.groundHeightM + input.canopyHeightM;
  const top = geodeticToEcef({ ...g, heightM: canopyTopHeightM });
  const span = spanForChainage(model, input.chainageM);
  const a = towerAttachment(model, span.fromTower);
  const b = towerAttachment(model, span.toTower);
  const clearanceM = pointSegmentDistance(top, a, b);
  const status = clearanceM < model.seed.clearanceThresholdM ? 'violation' as const : 'clear' as const;
  return { lonDeg: g.lonDeg, latDeg: g.latDeg, ecef, canopyTopHeightM, clearanceM, status, span };
}

/** Project a lon/lat to corridor chainage (1 decimal) and offset (2 decimals). */
export function projectFinding(model: CorridorModel, lonDeg: number, latDeg: number): { chainageM: number; offsetM: number } {
  const p = projectOntoCentreline({ lonDeg, latDeg, heightM: 0 }, model.centreline);
  return { chainageM: Math.round(p.chainageM * 10) / 10, offsetM: Math.round(p.offsetM * 100) / 100 };
}

/** Camera heading along the corridor at a chainage, degrees clockwise from north. */
export function corridorHeading(model: CorridorModel, chainageM: number): number {
  const t = model.centreline.tangentAt(chainageM);
  const g = model.centreline.pointAt(chainageM);
  const { east, north } = eastNorth(g);
  const heading = Math.atan2(dot(t, east), dot(t, north)) / DEG;
  return (heading + 360) % 360;
}

/** Point at chainage with a height, in ECEF. */
export function centrelineEcef(model: CorridorModel, chainageM: number, heightM: number): Ecef {
  const g = model.centreline.pointAt(chainageM);
  return geodeticToEcef({ lonDeg: g.lonDeg, latDeg: g.latDeg, heightM });
}

/** Right-hand unit offset direction in ECEF at a chainage. */
export function rightVector(model: CorridorModel, chainageM: number): Ecef {
  return model.centreline.rightAt(chainageM);
}

export function moveEcef(base: Ecef, offset: Ecef, metres: number): Ecef {
  return add(base, scale(offset, metres));
}

export function ecefDistance(a: Ecef, b: Ecef): number {
  return norm(sub(a, b));
}

export function unitUp(p: Ecef): Ecef {
  return normalize(p);
}
