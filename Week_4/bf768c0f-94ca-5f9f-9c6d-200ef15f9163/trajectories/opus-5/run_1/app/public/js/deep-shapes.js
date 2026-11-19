/**
 * The deep pieces, built from shapes rather than fetched as models.  Each of
 * the six types has its own silhouette: a horse-head knight with a muzzle and
 * ears, a rook with battlements, a king with a cross, a queen with a crown of
 * points, a bishop with a mitre, and a pawn.  No type is a plain round turned
 * shape alone.
 */

/** A mesh under construction: positions, normals and indices. */
function mesh() {
  return { positions: [], normals: [], indices: [] };
}

function pushTriangle(target, a, b, c, flip = false) {
  const base = target.positions.length / 3;
  const points = flip ? [a, c, b] : [a, b, c];
  const u = [points[1][0] - points[0][0], points[1][1] - points[0][1], points[1][2] - points[0][2]];
  const v = [points[2][0] - points[0][0], points[2][1] - points[0][1], points[2][2] - points[0][2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const length = Math.hypot(n[0], n[1], n[2]) || 1;
  for (const point of points) {
    target.positions.push(point[0], point[1], point[2]);
    target.normals.push(n[0] / length, n[1] / length, n[2] / length);
  }
  target.indices.push(base, base + 1, base + 2);
}

/** Revolve a profile of [radius, height] pairs around the Y axis. */
function lathe(target, profile, segments = 22) {
  for (let s = 0; s < segments; s++) {
    const a0 = (s / segments) * Math.PI * 2;
    const a1 = ((s + 1) / segments) * Math.PI * 2;
    for (let i = 0; i < profile.length - 1; i++) {
      const [r0, y0] = profile[i];
      const [r1, y1] = profile[i + 1];
      const p00 = [Math.cos(a0) * r0, y0, Math.sin(a0) * r0];
      const p01 = [Math.cos(a1) * r0, y0, Math.sin(a1) * r0];
      const p10 = [Math.cos(a0) * r1, y1, Math.sin(a0) * r1];
      const p11 = [Math.cos(a1) * r1, y1, Math.sin(a1) * r1];
      if (r0 > 0.0005) pushTriangle(target, p00, p10, p01);
      if (r1 > 0.0005) pushTriangle(target, p01, p10, p11);
    }
  }
}

function box(target, { x = 0, y = 0, z = 0, w, h, d, rotation = 0 }) {
  const hx = w / 2;
  const hz = d / 2;
  const corners = [
    [-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz],
    [-hx, h, -hz], [hx, h, -hz], [hx, h, hz], [-hx, h, hz],
  ].map(([px, py, pz]) => {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return [x + px * cos - pz * sin, y + py, z + px * sin + pz * cos];
  });
  const faces = [
    [0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0],
  ];
  for (const [a, b, c, d2] of faces) {
    pushTriangle(target, corners[a], corners[b], corners[c]);
    pushTriangle(target, corners[a], corners[c], corners[d2]);
  }
}

/** Extrude a closed polygon in the XY plane along Z: the knight's head. */
function extrude(target, polygon, depth, lift = 0) {
  const half = depth / 2;
  // Side walls.
  for (let i = 0; i < polygon.length; i++) {
    const [x0, y0] = polygon[i];
    const [x1, y1] = polygon[(i + 1) % polygon.length];
    const a = [x0, y0 + lift, -half];
    const b = [x1, y1 + lift, -half];
    const c = [x1, y1 + lift, half];
    const d = [x0, y0 + lift, half];
    pushTriangle(target, a, b, c);
    pushTriangle(target, a, c, d);
  }
  // Caps, fanned from the centroid.
  let cx = 0;
  let cy = 0;
  for (const [x, y] of polygon) { cx += x; cy += y; }
  cx /= polygon.length;
  cy /= polygon.length;
  for (let i = 0; i < polygon.length; i++) {
    const [x0, y0] = polygon[i];
    const [x1, y1] = polygon[(i + 1) % polygon.length];
    pushTriangle(target, [cx, cy + lift, half], [x0, y0 + lift, half], [x1, y1 + lift, half]);
    pushTriangle(target, [cx, cy + lift, -half], [x1, y1 + lift, -half], [x0, y0 + lift, -half]);
  }
}

function cone(target, { x = 0, y = 0, z = 0, radius, height, segments = 10 }) {
  for (let s = 0; s < segments; s++) {
    const a0 = (s / segments) * Math.PI * 2;
    const a1 = ((s + 1) / segments) * Math.PI * 2;
    const p0 = [x + Math.cos(a0) * radius, y, z + Math.sin(a0) * radius];
    const p1 = [x + Math.cos(a1) * radius, y, z + Math.sin(a1) * radius];
    pushTriangle(target, p0, [x, y + height, z], p1);
    pushTriangle(target, p0, p1, [x, y, z]);
  }
}

function sphere(target, { x = 0, y = 0, z = 0, radius, segments = 14, rings = 9 }) {
  for (let r = 0; r < rings; r++) {
    const phi0 = (r / rings) * Math.PI;
    const phi1 = ((r + 1) / rings) * Math.PI;
    for (let s = 0; s < segments; s++) {
      const t0 = (s / segments) * Math.PI * 2;
      const t1 = ((s + 1) / segments) * Math.PI * 2;
      const point = (phi, theta) => [
        x + radius * Math.sin(phi) * Math.cos(theta),
        y + radius * Math.cos(phi),
        z + radius * Math.sin(phi) * Math.sin(theta),
      ];
      pushTriangle(target, point(phi0, t0), point(phi1, t0), point(phi0, t1));
      pushTriangle(target, point(phi0, t1), point(phi1, t0), point(phi1, t1));
    }
  }
}

const BASE = [[0, 0], [0.34, 0], [0.34, 0.05], [0.3, 0.09], [0.22, 0.12]];

function pawn() {
  const target = mesh();
  lathe(target, [...BASE, [0.15, 0.2], [0.13, 0.4], [0.17, 0.46], [0.11, 0.5], [0.1, 0.52], [0, 0.52]]);
  sphere(target, { y: 0.63, radius: 0.145 });
  return target;
}

function rook() {
  const target = mesh();
  lathe(target, [...BASE, [0.2, 0.22], [0.19, 0.6], [0.26, 0.66], [0.26, 0.76], [0, 0.76]]);
  // Battlements: six blocks with the gaps between them.
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    box(target, {
      x: Math.cos(angle) * 0.2,
      z: Math.sin(angle) * 0.2,
      y: 0.74,
      w: 0.14, h: 0.17, d: 0.12,
      rotation: -angle,
    });
  }
  return target;
}

function knight() {
  const target = mesh();
  lathe(target, [...BASE, [0.19, 0.2], [0.17, 0.3], [0.2, 0.34], [0, 0.34]]);
  // A horse head seen from the side: muzzle at the front, two ears behind.
  const head = [
    [-0.22, 0.30], [0.10, 0.30],   // the chest, standing on the collar
    [0.13, 0.44], [0.30, 0.50],    // the jaw running out to the muzzle
    [0.34, 0.58], [0.25, 0.62],    // the nose and the mouth under it
    [0.17, 0.66], [0.13, 0.78],    // the cheek and the forehead
    [0.07, 0.92], [0.01, 0.79],    // the front ear
    [-0.06, 0.90], [-0.12, 0.74],  // the back ear
    [-0.19, 0.58], [-0.26, 0.42],  // the back of the neck
    [-0.26, 0.32],
  ];
  extrude(target, head, 0.24);
  return target;
}

function bishop() {
  const target = mesh();
  lathe(target, [...BASE, [0.17, 0.2], [0.15, 0.42], [0.21, 0.48], [0.15, 0.52], [0.13, 0.56], [0, 0.56]]);
  // The mitre: a rounded body drawn to a point.
  lathe(target, [[0, 0.54], [0.16, 0.62], [0.17, 0.72], [0.1, 0.84], [0.03, 0.9], [0, 0.92]]);
  sphere(target, { y: 0.95, radius: 0.05 });
  // The slit.
  box(target, { x: 0.02, y: 0.7, w: 0.05, h: 0.18, d: 0.26 });
  return target;
}

function queen() {
  const target = mesh();
  lathe(target, [...BASE, [0.2, 0.22], [0.16, 0.5], [0.2, 0.6], [0.26, 0.72], [0.24, 0.78], [0, 0.78]]);
  // A crown of points.
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    cone(target, {
      x: Math.cos(angle) * 0.21,
      z: Math.sin(angle) * 0.21,
      y: 0.76,
      radius: 0.052,
      height: 0.16,
      segments: 7,
    });
  }
  sphere(target, { y: 0.9, radius: 0.075 });
  return target;
}

function king() {
  const target = mesh();
  lathe(target, [...BASE, [0.21, 0.22], [0.17, 0.52], [0.22, 0.62], [0.27, 0.74], [0.25, 0.8], [0, 0.8]]);
  // A cross on top.
  box(target, { y: 0.8, w: 0.09, h: 0.3, d: 0.09 });
  box(target, { y: 0.97, w: 0.24, h: 0.08, d: 0.085 });
  return target;
}

const BUILDERS = { p: pawn, r: rook, n: knight, b: bishop, q: queen, k: king };

/** The six deep piece geometries, each with its own silhouette. */
export function buildPieceGeometries() {
  const out = {};
  for (const [type, build] of Object.entries(BUILDERS)) {
    const raw = build();
    out[type] = {
      positions: new Float32Array(raw.positions),
      normals: new Float32Array(raw.normals),
      count: raw.positions.length / 3,
    };
  }
  return out;
}

/** The board: sixty-four square tiles, a frame and a plinth. */
export function buildBoardGeometry() {
  const tiles = [];
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const target = mesh();
      const x0 = file - 4;
      const z0 = (7 - rank) - 4;
      pushTriangle(target, [x0, 0, z0], [x0, 0, z0 + 1], [x0 + 1, 0, z0 + 1]);
      pushTriangle(target, [x0, 0, z0], [x0 + 1, 0, z0 + 1], [x0 + 1, 0, z0]);
      tiles.push({
        file,
        rank,
        positions: new Float32Array(target.positions),
        normals: new Float32Array(target.normals),
        count: 6,
      });
    }
  }
  // The frame's top sits a hair below the squares, so the two never fight.
  const frame = mesh();
  box(frame, { y: -0.36, w: 9.4, h: 0.34, d: 9.4 });
  return {
    tiles,
    frame: {
      positions: new Float32Array(frame.positions),
      normals: new Float32Array(frame.normals),
      count: frame.positions.length / 3,
    },
  };
}

/** A flat quad just above a square, for the marks the board carries. */
export function buildMarkGeometry(inset = 0.06, height = 0.012) {
  const target = mesh();
  const a = -0.5 + inset;
  const b = 0.5 - inset;
  pushTriangle(target, [a, height, a], [a, height, b], [b, height, b]);
  pushTriangle(target, [a, height, a], [b, height, b], [b, height, a]);
  return {
    positions: new Float32Array(target.positions),
    normals: new Float32Array(target.normals),
    count: 6,
  };
}

/** A disc just above a square: the legal-move mark. */
export function buildDiscGeometry(radius = 0.17, height = 0.014) {
  const target = mesh();
  const segments = 18;
  for (let s = 0; s < segments; s++) {
    const a0 = (s / segments) * Math.PI * 2;
    const a1 = ((s + 1) / segments) * Math.PI * 2;
    pushTriangle(
      target,
      [0, height, 0],
      [Math.cos(a0) * radius, height, Math.sin(a0) * radius],
      [Math.cos(a1) * radius, height, Math.sin(a1) * radius],
    );
  }
  return {
    positions: new Float32Array(target.positions),
    normals: new Float32Array(target.normals),
    count: target.positions.length / 3,
  };
}
