import { randomUUID } from 'node:crypto';
import type { ExportFormat, ExportRecord, ExportUnit } from '../shared/types.js';
import { FIELD_COPY } from '../shared/copy.js';
import { ApiError, validation } from './errors.js';
import { query, queryOne } from './db.js';
import { exportKey, putObject } from './storage.js';

export interface ExportRow {
  id: string;
  owner_id: string;
  project_id: string | null;
  file_name: string;
  format: ExportFormat;
  unit: ExportUnit;
  bytes: number;
  triangle_count: number | null;
  bbox_x: number | null;
  bbox_y: number | null;
  bbox_z: number | null;
  object_key: string;
  created_at: Date;
}

export const EXPORT_COLUMNS =
  'id, owner_id, project_id, file_name, format, unit, bytes, triangle_count, bbox_x, bbox_y, bbox_z, object_key, created_at';

const FILE_NAME_FORM = /^[a-z0-9]+(-[a-z0-9]+)*\.(stl|obj|svg)$/;

export const exportView = (row: ExportRow): ExportRecord => ({
  id: row.id,
  projectId: row.project_id,
  ownerId: row.owner_id,
  fileName: row.file_name,
  format: row.format,
  unit: row.unit,
  bytes: row.bytes,
  triangleCount: row.triangle_count,
  bbox:
    row.bbox_x === null || row.bbox_y === null || row.bbox_z === null
      ? null
      : { x: row.bbox_x, y: row.bbox_y, z: row.bbox_z },
  createdAt: row.created_at.toISOString(),
  downloadUrl: `/api/exports/${row.id}/download`,
});

export const parseExportQuery = (
  params: URLSearchParams,
): { format: ExportFormat; unit: ExportUnit; name: string; projectId: string | null } => {
  const fields: Record<string, string> = {};
  const format = params.get('format') ?? '';
  const unit = params.get('unit') ?? '';
  const name = params.get('name') ?? '';
  if (format !== 'stl' && format !== 'obj' && format !== 'svg') fields.format = FIELD_COPY.name;
  if (unit !== 'mm' && unit !== 'in') fields.unit = FIELD_COPY.name;
  const stem = name.slice(0, name.lastIndexOf('.'));
  if (!FILE_NAME_FORM.test(name) || stem.length < 1 || stem.length > 60) fields.name = FIELD_COPY.name;
  else if (!name.endsWith(`.${format}`)) fields.name = FIELD_COPY.name;
  if (Object.keys(fields).length > 0) throw validation(fields);
  return {
    format: format as ExportFormat,
    unit: unit as ExportUnit,
    name,
    projectId: params.get('projectId'),
  };
};

export interface MeshFacts {
  triangleCount: number | null;
  bbox: { x: number; y: number; z: number } | null;
}

const notClosed = (): never => {
  throw new ApiError(422, 'mesh_not_closed');
};

const badFile = (): never => {
  throw validation({ file: FIELD_COPY.name });
};

const edgesClose = (triangles: [string, string, string][]): boolean => {
  const edges = new Map<string, number>();
  for (const [a, b, c] of triangles) {
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ] as [string, string][]) {
      const key = from < to ? `${from}|${to}` : `${to}|${from}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const count of edges.values()) {
    if (count !== 2) return false;
  }
  return edges.size > 0;
};

/** The server checks the uploaded file really is that format, and that meshes are closed. */
export const inspectExportFile = (body: Buffer, format: ExportFormat): MeshFacts => {
  if (format === 'stl') return inspectStl(body);
  if (format === 'obj') return inspectObj(body);
  return inspectSvg(body);
};

const inspectStl = (body: Buffer): MeshFacts => {
  if (body.length < 84) badFile();
  const count = body.readUInt32LE(80);
  if (body.length !== 84 + 50 * count || count === 0) badFile();
  const triangles: [string, string, string][] = [];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < count; index += 1) {
    const base = 84 + index * 50 + 12;
    const corners: string[] = [];
    for (let corner = 0; corner < 3; corner += 1) {
      const at = base + corner * 12;
      const x = body.readFloatLE(at);
      const y = body.readFloatLE(at + 4);
      const z = body.readFloatLE(at + 8);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
      corners.push(`${x},${y},${z}`);
    }
    triangles.push([corners[0], corners[1], corners[2]]);
  }
  if (!edgesClose(triangles)) notClosed();
  return {
    triangleCount: count,
    bbox: { x: round4(maxX - minX), y: round4(maxY - minY), z: round4(maxZ - minZ) },
  };
};

const inspectObj = (body: Buffer): MeshFacts => {
  const text = body.toString('utf8');
  const vertices: string[] = [];
  const bounds = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  const triangles: [string, string, string][] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('v ')) {
      const parts = line.trim().split(/\s+/).slice(1).map(Number);
      if (parts.length < 3 || parts.some((value) => !Number.isFinite(value))) badFile();
      const [x, y, z] = parts;
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.minZ = Math.min(bounds.minZ, z);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
      bounds.maxZ = Math.max(bounds.maxZ, z);
      vertices.push(`${x},${y},${z}`);
    } else if (line.startsWith('f ')) {
      const indices = line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map((token) => Number.parseInt(token.split('/')[0], 10));
      if (indices.length !== 3 || indices.some((value) => !Number.isInteger(value))) badFile();
      const corners = indices.map((index) => vertices[index - 1]);
      if (corners.some((corner) => corner === undefined)) badFile();
      triangles.push([corners[0], corners[1], corners[2]]);
    }
  }
  if (triangles.length === 0) badFile();
  if (!edgesClose(triangles)) notClosed();
  return {
    triangleCount: triangles.length,
    bbox: {
      x: round4(bounds.maxX - bounds.minX),
      y: round4(bounds.maxY - bounds.minY),
      z: round4(bounds.maxZ - bounds.minZ),
    },
  };
};

const inspectSvg = (body: Buffer): MeshFacts => {
  const text = body.toString('utf8');
  if (!/<svg[\s>]/i.test(text) || !/<\/svg>\s*$/i.test(text.trim())) badFile();
  const open = /<([a-zA-Z][\w:-]*)([^>]*)>/g;
  const stack: string[] = [];
  let match: RegExpExecArray | null = open.exec(text);
  while (match) {
    const tail = match[2].trimEnd();
    if (!tail.endsWith('/') && !match[1].startsWith('?') && !match[1].startsWith('!')) stack.push(match[1]);
    match = open.exec(text);
  }
  for (const close of text.matchAll(/<\/([a-zA-Z][\w:-]*)>/g)) {
    const last = stack.pop();
    if (last !== close[1]) badFile();
  }
  if (stack.length > 0) badFile();
  const width = /width="([0-9.]+)(mm|in)"/.exec(text);
  const height = /height="([0-9.]+)(mm|in)"/.exec(text);
  if (width === null || height === null) return badFile();
  const isPage = width[1] === '297' && height[1] === '210' && width[2] === 'mm';
  return {
    triangleCount: null,
    bbox: isPage ? null : { x: Number(width[1]), y: Number(height[1]), z: 0 },
  };
};

const round4 = (value: number): number => Math.round(value * 10000) / 10000;

export const storeExport = async (input: {
  ownerId: string;
  projectId: string | null;
  fileName: string;
  format: ExportFormat;
  unit: ExportUnit;
  body: Buffer;
  facts: MeshFacts;
}): Promise<ExportRow> => {
  const id = randomUUID();
  const key = exportKey(input.ownerId, id, input.fileName);
  const contentType =
    input.format === 'stl' ? 'model/stl' : input.format === 'obj' ? 'model/obj' : 'image/svg+xml';
  await putObject(key, input.body, contentType);
  const rows = await query<ExportRow>(
    `insert into exports (id, owner_id, project_id, file_name, format, unit, bytes, triangle_count, bbox_x, bbox_y, bbox_z, object_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning ${EXPORT_COLUMNS}`,
    [
      id,
      input.ownerId,
      input.projectId,
      input.fileName,
      input.format,
      input.unit,
      input.body.length,
      input.facts.triangleCount,
      input.facts.bbox?.x ?? null,
      input.facts.bbox?.y ?? null,
      input.facts.bbox?.z ?? null,
      key,
    ],
  );
  return rows[0];
};

export const loadExport = async (id: string): Promise<ExportRow | null> => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return queryOne<ExportRow>(`select ${EXPORT_COLUMNS} from exports where id = $1`, [id]);
};

export const contentTypeFor = (format: ExportFormat): string =>
  format === 'stl' ? 'model/stl' : format === 'obj' ? 'model/obj' : 'image/svg+xml';
