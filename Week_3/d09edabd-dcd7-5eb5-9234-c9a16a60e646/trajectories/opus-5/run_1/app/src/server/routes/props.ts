import { createHash, randomUUID } from 'node:crypto';
import { limits } from '../config.js';
import { errors } from '../errors.js';
import type { Route } from '../http.js';
import { requireMember } from '../domain/session.js';
import { FieldCollector } from '../domain/validate.js';
import { sendDownload } from '../domain/download.js';
import { propKey } from '../domain/versions.js';
import { one, query } from '../services/db.js';
import { deleteObject, getObject, putObject } from '../services/storage.js';
import { propsInUse, reply } from './support.js';
import type { Prop } from '../../shared/types.js';

interface PropRow {
  id: string;
  name: string;
  width_mm: number;
  depth_mm: number;
  height_mm: number;
  content_type: string;
  bytes: number;
  sha256: string;
}

function toProp(row: PropRow): Prop {
  return {
    id: row.id,
    name: row.name,
    widthMm: row.width_mm,
    depthMm: row.depth_mm,
    heightMm: row.height_mm,
    contentType: row.content_type,
    bytes: row.bytes,
    sha256: row.sha256,
    fileUrl: `/api/props/${row.id}/file`,
  };
}

/** Only a binary glTF 2.0 or a self-contained JSON glTF 2.0 is accepted. */
function gltfContentType(bytes: Buffer): string | null {
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'glTF') {
    return bytes.readUInt32LE(4) === 2 ? 'model/gltf-binary' : null;
  }
  try {
    const parsed = JSON.parse(bytes.toString('utf8')) as { asset?: { version?: unknown } };
    return parsed.asset?.version === '2.0' ? 'model/gltf+json' : null;
  } catch {
    return null;
  }
}

function sizeField(
  fields: Record<string, string>,
  name: string,
  collector: FieldCollector,
): number | null {
  const raw = fields[name];
  const value = Number(raw);
  if (raw === undefined || !Number.isInteger(value) || value < 10 || value > 30_000) {
    collector.add(name, 'must be 10 to 30000 millimetres');
    return null;
  }
  return value;
}

export const propRoutes: Route[] = [
  {
    method: 'POST',
    pattern: '/api/props',
    body: 'multipart',
    bodyLimit: limits.multipart,
    async handler(ctx) {
      const member = await requireMember(ctx);
      const { fields, files } = ctx.multipart;
      const collector = new FieldCollector();
      const file = files.file;
      const contentType = file ? gltfContentType(file.bytes) : null;
      if (!file || contentType === null) collector.add('file', 'not a glTF 2.0 file');
      const name = fields.name;
      if (name === undefined || name.length < 1 || name.length > 60) {
        collector.add('name', 'must be 1 to 60 characters');
      }
      const widthMm = sizeField(fields, 'widthMm', collector);
      const depthMm = sizeField(fields, 'depthMm', collector);
      const heightMm = sizeField(fields, 'heightMm', collector);
      collector.throwIfAny();
      const bytes = (file as { bytes: Buffer }).bytes;
      const id = randomUUID();
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      await putObject(propKey(id, contentType as string), bytes, contentType as string);
      try {
        await query(
          `insert into props (id, workspace_id, name, width_mm, depth_mm, height_mm,
             content_type, bytes, sha256)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            member.workspaceId,
            name,
            widthMm,
            depthMm,
            heightMm,
            contentType,
            bytes.length,
            sha256,
          ],
        );
      } catch (error) {
        await deleteObject(propKey(id, contentType as string)).catch(() => undefined);
        throw error;
      }
      const row = await one<PropRow>(
        `select id, name, width_mm, depth_mm, height_mm, content_type, bytes, sha256
           from props where id = $1`,
        [id],
      );
      if (!row) throw errors.notFound();
      return reply(201, { prop: toProp(row) });
    },
  },
  {
    method: 'GET',
    pattern: '/api/props',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const list = await query<PropRow>(
        `select id, name, width_mm, depth_mm, height_mm, content_type, bytes, sha256
           from props where workspace_id = $1 order by created_seq desc`,
        [member.workspaceId],
      );
      return { props: list.map(toProp) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/props/:propId/file',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const row = await one<PropRow>(
        `select id, name, width_mm, depth_mm, height_mm, content_type, bytes, sha256
           from props where id = $1 and workspace_id = $2`,
        [ctx.params.propId, member.workspaceId],
      );
      if (!row) throw errors.notFound();
      const bytes = await getObject(propKey(row.id, row.content_type));
      if (bytes === null) throw errors.storageUnavailable();
      sendDownload(
        ctx.res,
        {
          name: row.name,
          contentType: row.content_type,
          bytes: row.bytes,
          sha256: row.sha256,
        },
        bytes,
        ctx.header('if-none-match'),
      );
      return null;
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/props/:propId',
    body: 'none',
    async handler(ctx) {
      const member = await requireMember(ctx);
      const row = await one<PropRow>(
        `select id, name, width_mm, depth_mm, height_mm, content_type, bytes, sha256
           from props where id = $1 and workspace_id = $2`,
        [ctx.params.propId, member.workspaceId],
      );
      if (!row) throw errors.notFound();
      if (await propsInUse(row.id)) throw errors.propInUse();
      await deleteObject(propKey(row.id, row.content_type));
      await query(`delete from props where id = $1`, [row.id]);
      return undefined;
    },
  },
];
