// Geometry worker: computes the group result (solids minus holes) with
// manifold-3d, and reports mesh + bounds back to the 3D Workshop.
import Module from '../../vendor/manifold/manifold.js';
import type { ShapeObject } from '../shared/scene.js';

type ManifoldModule = Awaited<ReturnType<typeof Module>>;

let M: ManifoldModule | null = null;
let initPromise: Promise<ManifoldModule> | null = null;

async function getModule(): Promise<ManifoldModule> {
  if (M) return M;
  if (!initPromise) {
    initPromise = (async () => {
      const mod = await Module({ locateFile: () => '/assets/wasm/manifold.wasm' });
      mod.setup();
      return mod;
    })();
  }
  return initPromise;
}

interface PostMessageGroup {
  type: 'grouped';
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  volume: number;
  bbox: { min: number[]; max: number[] };
  children: ShapeObject[];
  color: string;
  mode: 'solid' | 'hole';
}

self.onmessage = async (ev: MessageEvent) => {
  const data = ev.data as { objects: ShapeObject[] };
  try {
    const mod = await getModule();
    const objects = data.objects;
    const solids = objects.filter((o) => o.mode === 'solid');
    const holes = objects.filter((o) => o.mode === 'hole');

    let union: InstanceType<ManifoldModule['Manifold']> | null = null;
    for (const s of solids) {
      const shape = shapeFor(mod, s);
      union = union === null ? shape : mod.Manifold.union([union, shape]);
    }
    if (!union) {
      (self as unknown as Worker).postMessage({ type: 'error', message: 'A group needs at least one solid.' });
      return;
    }
    for (const h of holes) {
      union = mod.Manifold.difference([union, shapeFor(mod, h)]);
    }
    const mesh = union.getMesh();
    const verts = Array.from(mesh.vertProperties).filter((_, i) => i % 3 === 0 || i % 3 === 1 || i % 3 === 2);
    void verts;
    const positions = new Float32Array(mesh.numVert * 3);
    for (let v = 0; v < mesh.numVert; v++) {
      positions[v * 3] = mesh.vertProperties[v * 3]!;
      positions[v * 3 + 1] = mesh.vertProperties[v * 3 + 1]!;
      positions[v * 3 + 2] = mesh.vertProperties[v * 3 + 2]!;
    }
    const normals = new Float32Array(mesh.numVert * 3);
    // Flat normals from triangle geometry for chunky look.
    const indices = new Uint32Array(mesh.triVerts);
    for (let t = 0; t < mesh.numTri; t++) {
      const a = mesh.triVerts[t * 3]!, b = mesh.triVerts[t * 3 + 1]!, c = mesh.triVerts[t * 3 + 2]!;
      const ax = positions[a * 3]!, ay = positions[a * 3 + 1]!, az = positions[a * 3 + 2]!;
      const bx = positions[b * 3]!, by = positions[b * 3 + 1]!, bz = positions[b * 3 + 2]!;
      const cx = positions[c * 3]!, cy = positions[c * 3 + 1]!, cz = positions[c * 3 + 2]!;
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      for (const idx of [a, b, c]) {
        normals[idx * 3] = nx / len;
        normals[idx * 3 + 1] = ny / len;
        normals[idx * 3 + 2] = nz / len;
      }
    }
    const bb = union.boundingBox();
    const message: PostMessageGroup = {
      type: 'grouped',
      positions,
      normals,
      indices,
      volume: union.volume(),
      bbox: { min: bb.min, max: bb.max },
      children: objects,
      color: (objects.find((o) => o.mode === 'solid') ?? objects[0]!)!.color,
      mode: 'solid',
    };
    (self as unknown as Worker).postMessage(message);
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: (err as Error).message || 'Grouping failed.' });
  }
};

function shapeFor(mod: ManifoldModule, o: ShapeObject): InstanceType<ManifoldModule['Manifold']> {
  // Centre the shape, apply the rotation, then translate back.
  const local = buildPrimitive(mod, o);
  const rotated = o.rotationZ !== 0 ? local.rotate([0, 0, o.rotationZ]) : local;
  return rotated.translate([o.x, o.y, o.z]);
}

function buildPrimitive(mod: ManifoldModule, o: ShapeObject): InstanceType<ManifoldModule['Manifold']> {
  if (o.kind === 'box') {
    return mod.Manifold.cube([o.w, o.d, o.h], true);
  }
  if (o.kind === 'cylinder') {
    // 64 segments; radius scaled so the mesh volume equals π r² h.
    const r = o.w / 2;
    const exactArea = Math.PI * r * r;
    const polyArea = 64 * r * r * Math.sin(Math.PI / 64) * Math.cos(Math.PI / 64);
    const scale = Math.sqrt(exactArea / polyArea);
    const cyl = mod.Manifold.cylinder(o.h, r * scale, -1, 64, true);
    return cyl;
  }
  const r = o.w / 2;
  // sphere: uniform scale so mesh volume equals 4/3 π r³ with 64×32 mesh
  const polyVol = polySphereVolume(r);
  const exactVol = (4 / 3) * Math.PI * r ** 3;
  const scale = Math.cbrt(exactVol / polyVol);
  const sph = mod.Manifold.sphere(r * scale, 0);
  return sph.scale(scale);
}

function polySphereVolume(r: number): number {
  const segs = 64, rings = 32;
  let vol = 0;
  const point = (ri: number, si: number): [number, number, number] => {
    const phi = (Math.PI * ri) / rings;
    const theta = (2 * Math.PI * si) / segs;
    return [r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi)];
  };
  for (let ri = 0; ri < rings; ri++) {
    for (let si = 0; si < segs; si++) {
      const a = point(ri, si);
      const b = point(ri + 1, si);
      const c = point(ri + 1, (si + 1) % segs);
      const d = point(ri, (si + 1) % segs);
      vol += tetra([0, 0, 0], a, b, c) + tetra([0, 0, 0], a, c, d);
    }
  }
  return Math.abs(vol);
}

function tetra(a: number[], b: number[], c: number[], d: number[]): number {
  const ab = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
  const ac = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
  const ad = [d[0]! - a[0]!, d[1]! - a[1]!, d[2]! - a[2]!];
  return (ab[0]! * (ac[1]! * ad[2]! - ac[2]! * ad[1]!) - ab[1]! * (ac[0]! * ad[2]! - ac[2]! * ad[0]!) + ab[2]! * (ac[0]! * ad[1]! - ac[1]! * ad[0]!)) / 6;
}
