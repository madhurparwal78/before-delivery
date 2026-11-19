import {
  add, cross, DEG, dot, Geodetic, normalize, norm, scale, sub, Ecef,
  geodeticToEcef, eastNorth, lerp, ecefToGeodetic,
} from './geodesy.js';

export type TowerRow = {
  number: number;
  chainageM: number;
  lonDeg: number;
  latDeg: number;
  baseHeightM: number;
  attachmentHeightM: number;
};

export type Centreline = {
  pointAt(chainageM: number): Geodetic;
  tangentAt(chainageM: number): Ecef;
  rightAt(chainageM: number): Ecef;
  lengthM: number;
  towers: TowerRow[];
};

/** Convert a unit ECEF vector to geodetic coordinates (iterating for the ellipsoid). */
export function unitVectorToGeodetic(v: Ecef): Geodetic {
  return ecefToGeodetic({ x: v.x * WGS_R, y: v.y * WGS_R, z: v.z * WGS_R });
}
const WGS_R = 6378137;

/** Great-circle interpolation between two geodetic surface points. */
export function greatCircle(a: Geodetic, b: Geodetic, t: number): Geodetic {
  if (t <= 0) return { ...a };
  if (t >= 1) return { ...b };
  const av = normalize(geodeticToEcef({ ...a, heightM: 0 }));
  const bv = normalize(geodeticToEcef({ ...b, heightM: 0 }));
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(av, bv))));
  if (angle < 1e-12) {
    return {
      lonDeg: lerp(a.lonDeg, b.lonDeg, t),
      latDeg: lerp(a.latDeg, b.latDeg, t),
      heightM: lerp(a.heightM, b.heightM, t),
    };
  }
  const sinA = Math.sin(angle * (1 - t)) / Math.sin(angle);
  const sinB = Math.sin(angle * t) / Math.sin(angle);
  const v = add(scale(av, sinA), scale(bv, sinB));
  const lon = Math.atan2(v.y, v.x) / DEG;
  const lat = Math.atan2(v.z, Math.sqrt(v.x * v.x + v.y * v.y)) / DEG;
  return { lonDeg: lon, latDeg: lat, heightM: lerp(a.heightM, b.heightM, t) };
}

export function buildCentreline(
  start: Geodetic,
  azimuthDeg: number,
  towers: Array<{ chainageM: number; baseHeightM: number; attachmentHeightM: number }>
): Centreline {
  const { north, east } = eastNorth(start);
  const az = azimuthDeg * DEG;
  const dir = add(scale(north, Math.cos(az)), scale(east, Math.sin(az)));
  const R = 6371000;
  const lengthM = towers.length === 0 ? 0 : towers[towers.length - 1].chainageM;
  const startVec = normalize(geodeticToEcef({ ...start, heightM: 0 }));
  const pointAt = (c: number): Geodetic => {
    if (lengthM === 0) return { ...start, heightM: 0 };
    const c0 = Math.min(Math.max(c, 0), lengthM);
    if (c0 === 0) return { ...start, heightM: 0 };
    // Walk small great-circle steps so long corridors follow the ellipsoid closely.
    const steps = Math.ceil(c0 / 500);
    const theta = (c0 / steps) / R;
    let v = startVec;
    for (let i = 0; i < steps; i++) {
      const { east, north } = eastNorth(unitVectorToGeodetic(v));
      const dir = add(scale(north, Math.cos(az)), scale(east, Math.sin(az)));
      v = normalize(add(scale(v, Math.cos(theta)), scale(dir, Math.sin(theta))));
    }
    const g = unitVectorToGeodetic(v);
    return { lonDeg: g.lonDeg, latDeg: g.latDeg, heightM: 0 };
  };
  const anchor = (c: number): Ecef => geodeticToEcef(pointAt(c));
  const tangentAt = (c: number): Ecef => normalize(sub(anchor(c + 0.5), anchor(c - 0.5)));
  const rightAt = (c: number): Ecef => normalize(cross(tangentAt(c), normalize(anchor(c))));
  const towerRows: TowerRow[] = towers.map((t, i) => {
    const p = pointAt(t.chainageM);
    return {
      number: i + 1,
      chainageM: t.chainageM,
      lonDeg: p.lonDeg,
      latDeg: p.latDeg,
      baseHeightM: t.baseHeightM,
      attachmentHeightM: t.attachmentHeightM,
    };
  });
  return { pointAt, tangentAt, rightAt, lengthM, towers: towerRows };
}

/** Project a surface point onto the centreline: chainage (m) and signed offset (positive right). */
export function projectOntoCentreline(
  p: Geodetic,
  cl: Centreline
): { chainageM: number; offsetM: number } {
  let best = 0;
  let bestDist = Infinity;
  const step = Math.max(1, cl.lengthM / 2000);
  const pv = geodeticToEcef({ ...p, heightM: 0 });
  for (let c = 0; c <= cl.lengthM + step; c += step) {
    const d = norm(sub(pv, geodeticToEcef(cl.pointAt(Math.min(c, cl.lengthM)))));
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  let lo = Math.max(0, best - step);
  let hi = Math.min(cl.lengthM, best + step);
  for (let i = 0; i < 30; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const d1 = norm(sub(pv, geodeticToEcef(cl.pointAt(m1))));
    const d2 = norm(sub(pv, geodeticToEcef(cl.pointAt(m2))));
    if (d1 < d2) hi = m2;
    else lo = m1;
  }
  const chainage = (lo + hi) / 2;
  const foot = geodeticToEcef(cl.pointAt(chainage));
  const v = sub(pv, foot);
  const offset = dot(v, cl.rightAt(chainage));
  return { chainageM: chainage, offsetM: offset };
}

/** Surface point at chainage and offset, carrying the given height. */
export function centrelinePoint(
  cl: Centreline,
  chainageM: number,
  offsetM: number,
  heightM: number
): Geodetic {
  const base = geodeticToEcef(cl.pointAt(chainageM));
  const moved = add(base, scale(cl.rightAt(chainageM), offsetM));
  return { ...ecefToGeodetic(moved), heightM };
}
