import type { Queryable } from '../db.js';
import { notFound } from '../errors.js';
import type { Prop } from '../../shared/types.js';

export interface PropRow {
  id: string;
  workspace_id: string;
  name: string;
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  content_type: string;
  bytes: number;
  sha256: string;
}

const GLB = 'model/gltf-binary';
const GLTF = 'model/gltf+json';

export const extensionOf = (contentType: string): 'glb' | 'gltf' => (contentType === GLB ? 'glb' : 'gltf');

export const toProp = (row: PropRow): Prop => ({
  id: row.id, name: row.name, widthMm: row.width_mm, depthMm: row.depth_mm, heightMm: row.height_mm,
  contentType: row.content_type, bytes: row.bytes, sha256: row.sha256, fileUrl: `/api/props/${row.id}/file`,
});

/** `lock` takes the row for update: a prop is deleted only while no placement can start using it. */
export async function findProp(db: Queryable, workspaceId: string, propId: string, lock = false): Promise<PropRow> {
  const found = await db.query<PropRow>(`SELECT * FROM props WHERE id = $1 AND workspace_id = $2${lock ? ' FOR UPDATE' : ''}`, [propId, workspaceId]);
  const row = found.rows[0];
  if (!row) throw notFound();
  return row;
}

/** The stored content type of a glTF 2.0 file, or null when the bytes are not one. */
export function gltfType(data: Buffer): string | null {
  if (data.length >= 12 && data.subarray(0, 4).toString('latin1') === 'glTF') {
    return data.readUInt32LE(4) === 2 ? GLB : null;
  }
  try {
    const parsed = JSON.parse(data.toString('utf8')) as { asset?: { version?: unknown } };
    return parsed.asset?.version === '2.0' ? GLTF : null;
  } catch {
    return null;
  }
}

const TOKEN_CHARS = /[A-Za-z0-9!#$&+\-.^_`|~]/;

/** `Content-Disposition` for a prop file: an ASCII fallback name and the UTF-8 name percent-encoded. */
function contentDisposition(name: string, contentType: string): string {
  const ext = extensionOf(contentType);
  const ascii = [...name].map((ch) => (ch >= ' ' && ch <= '~' && ch !== '"' && ch !== '\\' ? ch : '_')).join('');
  const encoded = [...Buffer.from(name, 'utf8')].map((byte) => (TOKEN_CHARS.test(String.fromCharCode(byte)) ? String.fromCharCode(byte) : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`)).join('');
  return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encoded}.${ext}`;
}

/** The headers every prop download carries; `ifNoneMatch` equal to the ETag makes it a 304. */
export function downloadReply(file: { body: Buffer }, row: { name: string; content_type: string; sha256: string }, ifNoneMatch: string | undefined) {
  const etag = `"${row.sha256}"`;
  const headers = { etag, 'content-type': row.content_type, 'content-disposition': contentDisposition(row.name, row.content_type) };
  const matches = ifNoneMatch?.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === etag);
  if (matches) return { status: 304, headers };
  return { status: 200, bytes: file.body, headers: { ...headers, 'content-length': file.body.length } };
}

/** Splits a multipart/form-data body held in memory into its text fields and its one file part. */
export function parseMultipart(contentType: string | undefined, body: Buffer): { fields: Record<string, string>; file: { data: Buffer } | null } {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? '');
  const marker = Buffer.from(`--${boundary?.[1] ?? boundary?.[2] ?? ''}`);
  const fields: Record<string, string> = {};
  let file: { data: Buffer } | null = null;
  if (!boundary) return { fields, file };
  let start = body.indexOf(marker);
  while (start !== -1) {
    const next = body.indexOf(marker, start + marker.length);
    if (next === -1) break;
    const part = body.subarray(start + marker.length + 2, next - 2);
    const split = part.indexOf('\r\n\r\n');
    if (split !== -1) {
      const head = part.subarray(0, split).toString('utf8');
      const data = part.subarray(split + 4);
      const name = /name="([^"]*)"/i.exec(head)?.[1];
      if (name !== undefined) {
        if (/filename=/i.test(head)) file = { data: Buffer.from(data) };
        else fields[name] = data.toString('utf8');
      }
    }
    start = next;
  }
  return { fields, file };
}
