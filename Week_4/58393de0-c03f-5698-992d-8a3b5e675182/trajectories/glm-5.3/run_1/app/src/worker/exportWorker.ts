// Export worker: builds STL/OBJ/SVG files from the whole design in the
// browser. Every top-level solid is unioned and every hole subtracted.
import Module from '../../vendor/manifold/manifold.js';
import type { ShapeObject } from '../shared/scene.js';

type ManifoldModule = Awaited<ReturnType<typeof Module>>;
type ManifoldT = InstanceType<ManifoldModule['Manifold']>;

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

export interface ExportRequest {
  type: 'export';
  format: 'stl' | 'obj' | 'svg';
  unit: 'mm' | 'in';
  objects: ShapeObject[];
  circuitSvg?: string;
  projectName: string;
}

export interface ExportResponse {
  type: 'done';
  bytes: ArrayBuffer;
  triangleCount: number;
  bbox: { x: number; y: number; z: number };
}

self.onmessage = async (ev: MessageEvent<ExportRequest>) => {
  const req = ev.data;
  try {
    if (req.format === 'svg' && req.circuitSvg) {
      const bytes = new TextEncoder().encode(req.circuitSvg).buffer;
      (self as unknown as Worker).postMessage({ type: 'done', bytes, triangleCount: 0, bbox: { x: 297, y: 210, z: 0 } });
      return;
    }
    const mod = await getModule();
    const solids = req.objects.filter((o) => o.mode === 'solid');
    const holes = req.objects.filter((o) => o.mode === 'hole');
    if (solids.length === 0) {
      (self as unknown as Worker).postMessage({ type: 'error', message: 'no-solids' });
      return;
    }
    let union: ManifoldT | null = null;
    for (const s of solids) {
      const shape = shapeFor(mod, s);
      union = union === null ? shape : mod.Manifold.union([union, shape]);
    }
    if (!union) {
      (self as unknown as Worker).postMessage({ type: 'error', message: 'no-solids' });
      return;
    }
    for (const h of holes) {
      union = mod.Manifold.difference([union, shapeFor(mod, h)]);
    }
    const mesh = union.getMesh();
    const scale = req.unit === 'in' ? 1 / 25.4 : 1;
    const bb = union.boundingBox();
    const bbox = {
      x: (bb.max[0]! - bb.min[0]!) * scale,
      y: (bb.max[1]! - bb.min[1]!) * scale,
      z: (bb.max[2]! - bb.min[2]!) * scale,
    };
    const triangleCount = mesh.numTri;

    if (req.format === 'stl') {
      const buffer = buildBinaryStl(mesh, scale);
      (self as unknown as Worker).postMessage({ type: 'done', bytes: buffer, triangleCount, bbox });
      return;
    }
    if (req.format === 'obj') {
      const text = buildObj(mesh, scale);
      const bytes = new TextEncoder().encode(text).buffer;
      (self as unknown as Worker).postMessage({ type: 'done', bytes, triangleCount, bbox });
      return;
    }
    // SVG top view: project the mesh footprint.
    const svg = buildSvgTopView(mesh, bb, req.unit);
    const bytes = new TextEncoder().encode(svg).buffer;
    (self as unknown as Worker).postMessage({ type: 'done', bytes, triangleCount: 0, bbox });
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: (err as Error).message || 'Export failed.' });
  }
};

function shapeFor(mod: ManifoldModule, o: ShapeObject): ManifoldT {
  const local = buildPrimitive(mod, o);
  const rotated = o.rotationZ !== 0 ? local.rotate([0, 0, o.rotationZ]) : local;
  return rotated.translate([o.x, o.y, o.z]);
}

function buildPrimitive(mod: ManifoldModule, o: ShapeObject): ManifoldT {
  if (o.kind === 'box') return mod.Manifold.cube([o.w, o.d, o.h], true);
  if (o.kind === 'cylinder') {
    const r = o.w / 2;
    const exactArea = Math.PI * r * r;
    const polyArea = 64 * r * r * Math.sin(Math.PI / 64) * Math.cos(Math.PI / 64);
    const scale = Math.sqrt(exactArea / polyArea);
    return mod.Manifold.cylinder(o.h, r * scale, -1, 64, true);
  }
  const r = o.w / 2;
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

// Binary STL: 80-byte header starting with "Quarkyard", uint32 count, then
// 50 bytes per triangle.
function buildBinaryStl(mesh: { vertProperties: Float32Array; triVerts: Uint32Array; numVert: number; numTri: number }, scale: number): ArrayBuffer {
  const count = mesh.numTri;
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  const header = 'Quarkyard binary STL';
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, count, true);
  let offset = 84;
  for (let t = 0; t < count; t++) {
    const a = mesh.triVerts[t * 3]!, b = mesh.triVerts[t * 3 + 1]!, c = mesh.triVerts[t * 3 + 2]!;
    const ax = mesh.vertProperties[a * 3]! * scale, ay = mesh.vertProperties[a * 3 + 1]! * scale, az = mesh.vertProperties[a * 3 + 2]! * scale;
    const bx = mesh.vertProperties[b * 3]! * scale, by = mesh.vertProperties[b * 3 + 1]! * scale, bz = mesh.vertProperties[b * 3 + 2]! * scale;
    const cx = mesh.vertProperties[c * 3]! * scale, cy = mesh.vertProperties[c * 3 + 1]! * scale, cz = mesh.vertProperties[c * 3 + 2]! * scale;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    view.setFloat32(offset, nx / len, true); view.setFloat32(offset + 4, ny / len, true); view.setFloat32(offset + 8, nz / len, true);
    view.setFloat32(offset + 12, ax, true); view.setFloat32(offset + 16, ay, true); view.setFloat32(offset + 20, az, true);
    view.setFloat32(offset + 24, bx, true); view.setFloat32(offset + 28, by, true); view.setFloat32(offset + 32, bz, true);
    view.setFloat32(offset + 36, cx, true); view.setFloat32(offset + 40, cy, true); view.setFloat32(offset + 44, cz, true);
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }
  return buffer;
}

function buildObj(mesh: { vertProperties: Float32Array; triVerts: Uint32Array; numVert: number; numTri: number }, scale: number): string {
  const lines: string[] = ['o quarkyard'];
  for (let v = 0; v < mesh.numVert; v++) {
    lines.push(`v ${fmt(mesh.vertProperties[v * 3]! * scale)} ${fmt(mesh.vertProperties[v * 3 + 1]! * scale)} ${fmt(mesh.vertProperties[v * 3 + 2]! * scale)}`);
  }
  for (let t = 0; t < mesh.numTri; t++) {
    const a = mesh.triVerts[t * 3]! + 1, b = mesh.triVerts[t * 3 + 1]! + 1, c = mesh.triVerts[t * 3 + 2]! + 1;
    lines.push(`f ${a} ${b} ${c}`);
  }
  return `${lines.join('\n')}\n`;
}

function fmt(n: number): string {
  return `${Number(n.toFixed(4))}`;
}

function buildSvgTopView(mesh: { vertProperties: Float32Array; triVerts: Uint32Array; numVert: number; numTri: number }, bb: { min: number[]; max: number[] }, unit: 'mm' | 'in'): string {
  const w = bb.max[0]! - bb.min[0]!;
  const h = bb.max[1]! - bb.min[1]!;
  const decimals = unit === 'mm' ? 3 : 5;
  const round = (n: number) => {
    const v = Number(n.toFixed(decimals));
    return `${v}`;
  };
  const widthStr = `${round(w)}${unit}`;
  const heightStr = `${round(h)}${unit}`;
  const shift = unit === 'in' ? 1 / 25.4 : 1;
  const paths: string[] = [];
  for (let t = 0; t < mesh.numTri; t++) {
    const a = mesh.triVerts[t * 3]!, b = mesh.triVerts[t * 3 + 1]!, c = mesh.triVerts[t * 3 + 2]!;
    const ax = (mesh.vertProperties[a * 3]! - bb.min[0]!) * shift;
    const ay = (bb.max[1]! - mesh.vertProperties[a * 3 + 1]!) * shift;
    const bx = (mesh.vertProperties[b * 3]! - bb.min[0]!) * shift;
    const by = (bb.max[1]! - mesh.vertProperties[b * 3 + 1]!) * shift;
    const cx = (mesh.vertProperties[c * 3]! - bb.min[0]!) * shift;
    const cy = (bb.max[1]! - mesh.vertProperties[c * 3 + 1]!) * shift;
    paths.push(`M${round(ax)} ${round(ay)}L${round(bx)} ${round(by)}L${round(cx)} ${round(cy)}Z`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${widthStr}" height="${heightStr}" viewBox="0 0 ${round(w * shift)} ${round(h * shift)}"><path d="${paths.join('')}" fill="#dddddd" stroke="#333333" stroke-width="0.1"/></svg>`;
}
