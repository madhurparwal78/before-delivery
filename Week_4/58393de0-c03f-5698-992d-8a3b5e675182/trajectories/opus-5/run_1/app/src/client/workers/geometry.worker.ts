import type { CircuitComponent, CircuitWire, SceneObject } from '../../shared/types.js';
import { computeGroupResult } from '../geom/scene.js';
import { isClosed, weldMesh } from '../geom/weld.js';
import type { Vec3 } from '../geom/mesh.js';
import { buildObj, buildStl, buildSvg3d, buildSvgCircuit, designMesh, scaleMesh, MM_PER_INCH } from '../export/files.js';

export interface GroupRequest {
  type: 'group';
  id: number;
  members: SceneObject[];
}

export interface ExportRequest {
  type: 'export';
  id: number;
  format: 'stl' | 'obj' | 'svg';
  unit: 'mm' | 'in';
  name: string;
  objects: SceneObject[];
  components?: CircuitComponent[];
  wires?: CircuitWire[];
}

export type WorkerRequest = GroupRequest | ExportRequest;

export interface GroupReply {
  type: 'group';
  id: number;
  positions: Float32Array;
  volume: number;
  triangleCount: number;
  min: Vec3;
  max: Vec3;
}

export interface ExportReply {
  type: 'export';
  id: number;
  ok: boolean;
  reason?: 'mesh_not_closed' | 'empty';
  bytes?: Uint8Array;
  triangleCount?: number;
  size?: Vec3;
}

export type WorkerReply = GroupReply | ExportReply;

const positionsOf = (triangles: { a: Vec3; b: Vec3; c: Vec3 }[]): Float32Array => {
  const data = new Float32Array(triangles.length * 9);
  let at = 0;
  for (const triangle of triangles) {
    for (const corner of [triangle.a, triangle.b, triangle.c]) {
      data[at] = corner[0];
      data[at + 1] = corner[1];
      data[at + 2] = corner[2];
      at += 3;
    }
  }
  return data;
};

const handleGroup = (request: GroupRequest): GroupReply => {
  const result = computeGroupResult(request.members);
  return {
    type: 'group',
    id: request.id,
    positions: positionsOf(result.mesh.triangles),
    volume: result.volume,
    triangleCount: result.triangleCount,
    min: result.box.min,
    max: result.box.max,
  };
};

const handleExport = (request: ExportRequest): ExportReply => {
  const encoder = new TextEncoder();
  if (request.format === 'svg' && request.components) {
    if (request.components.length === 0) return { type: 'export', id: request.id, ok: false, reason: 'empty' };
    const svg = buildSvgCircuit(request.components, request.wires ?? []);
    return { type: 'export', id: request.id, ok: true, bytes: encoder.encode(svg), triangleCount: 0 };
  }
  const hasSolid = request.objects.some((object) => object.mode === 'solid');
  if (!hasSolid) return { type: 'export', id: request.id, ok: false, reason: 'empty' };
  const mesh = designMesh(request.objects);
  if (!isClosed(mesh)) return { type: 'export', id: request.id, ok: false, reason: 'mesh_not_closed' };
  const scaled = scaleMesh(mesh, request.unit === 'in' ? MM_PER_INCH : 1);
  if (request.format === 'stl') {
    return {
      type: 'export',
      id: request.id,
      ok: true,
      bytes: buildStl(scaled),
      triangleCount: scaled.triangles.length,
    };
  }
  if (request.format === 'obj') {
    return {
      type: 'export',
      id: request.id,
      ok: true,
      bytes: encoder.encode(buildObj(scaled, request.name)),
      triangleCount: scaled.triangles.length,
    };
  }
  const svg = buildSvg3d(weldMesh(mesh), request.objects, request.unit);
  return { type: 'export', id: request.id, ok: true, bytes: encoder.encode(svg) };
};

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const reply = request.type === 'group' ? handleGroup(request) : handleExport(request);
  (self as unknown as Worker).postMessage(reply);
});
