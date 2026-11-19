import { meshVolume, type Mesh, type Triangle, type Vec3 } from './mesh.js';

export const CYLINDER_SEGMENTS = 64;
export const SPHERE_SEGMENTS = 64;
export const SPHERE_RINGS = 32;

export const TRIANGLES = { box: 12, cylinder: 256, sphere: 3968 } as const;

const tri = (a: Vec3, b: Vec3, c: Vec3): Triangle => ({ a, b, c });

/** A box of the given size, centred on the origin: 12 triangles. */
export const boxMesh = (w: number, d: number, h: number): Mesh => {
  const x = w / 2;
  const y = d / 2;
  const z = h / 2;
  const corners: Vec3[] = [
    [-x, -y, -z],
    [x, -y, -z],
    [x, y, -z],
    [-x, y, -z],
    [-x, -y, z],
    [x, -y, z],
    [x, y, z],
    [-x, y, z],
  ];
  const faces: [number, number, number, number][] = [
    [4, 5, 6, 7],
    [1, 0, 3, 2],
    [0, 1, 5, 4],
    [2, 3, 7, 6],
    [1, 2, 6, 5],
    [3, 0, 4, 7],
  ];
  const triangles: Triangle[] = [];
  for (const [a, b, c, d2] of faces) {
    triangles.push(tri(corners[a], corners[b], corners[c]), tri(corners[a], corners[c], corners[d2]));
  }
  return { triangles };
};

/** Scaled radially so the mesh volume equals π r² h exactly. */
export const cylinderMesh = (diameter: number, h: number): Mesh => {
  const r = diameter / 2;
  const n = CYLINDER_SEGMENTS;
  const radius = r * Math.sqrt((2 * Math.PI) / (n * Math.sin((2 * Math.PI) / n)));
  const z = h / 2;
  const ring = (atZ: number): Vec3[] =>
    Array.from({ length: n }, (_unused, index) => {
      const angle = (index * 2 * Math.PI) / n;
      return [radius * Math.cos(angle), radius * Math.sin(angle), atZ] as Vec3;
    });
  const top = ring(z);
  const bottom = ring(-z);
  const triangles: Triangle[] = [];
  for (let index = 0; index < n; index += 1) {
    const next = (index + 1) % n;
    triangles.push(tri(bottom[index], bottom[next], top[next]), tri(bottom[index], top[next], top[index]));
  }
  const topCentre: Vec3 = [0, 0, z];
  const bottomCentre: Vec3 = [0, 0, -z];
  for (let index = 0; index < n; index += 1) {
    const next = (index + 1) % n;
    triangles.push(tri(topCentre, top[index], top[next]));
    triangles.push(tri(bottomCentre, bottom[next], bottom[index]));
  }
  return { triangles };
};

const unitSphereScale = ((): number => {
  const unit = rawSphere(1);
  return Math.cbrt((4 / 3) * Math.PI / meshVolume(unit));
})();

function rawSphere(radius: number): Mesh {
  const n = SPHERE_SEGMENTS;
  const rings = SPHERE_RINGS;
  const point = (ring: number, segment: number): Vec3 => {
    const phi = (ring * Math.PI) / rings;
    const theta = (segment * 2 * Math.PI) / n;
    return [
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.sin(phi) * Math.sin(theta),
      radius * Math.cos(phi),
    ];
  };
  const triangles: Triangle[] = [];
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < n; segment += 1) {
      const next = (segment + 1) % n;
      const a = point(ring, segment);
      const b = point(ring, next);
      const c = point(ring + 1, next);
      const d = point(ring + 1, segment);
      if (ring === 0) triangles.push(tri(a, c, d));
      else if (ring === rings - 1) triangles.push(tri(a, b, c));
      else triangles.push(tri(a, b, c), tri(a, c, d));
    }
  }
  return { triangles };
}

/** Scaled uniformly so the mesh volume equals 4⁄3 π r³ exactly. */
export const sphereMesh = (diameter: number): Mesh => rawSphere((diameter / 2) * unitSphereScale);

export const exactVolume = (kind: 'box' | 'cylinder' | 'sphere', w: number, d: number, h: number): number => {
  if (kind === 'box') return w * d * h;
  if (kind === 'cylinder') return Math.PI * (w / 2) ** 2 * h;
  return (4 / 3) * Math.PI * (w / 2) ** 3;
};

export const primitiveMesh = (kind: 'box' | 'cylinder' | 'sphere', w: number, d: number, h: number): Mesh => {
  if (kind === 'box') return boxMesh(w, d, h);
  if (kind === 'cylinder') return cylinderMesh(w, h);
  return sphereMesh(w);
};

export const primitiveTriangles = (kind: 'box' | 'cylinder' | 'sphere'): number => TRIANGLES[kind];
