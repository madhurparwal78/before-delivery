import { randomUUID } from 'node:crypto';
import { fieldMessage } from '../../shared/copy.js';
import {
  ATTACHMENT_KINDS,
  taskId,
  UPLOAD_CONTENT_TYPES,
  type AttachmentKind,
} from '../../shared/domain.js';
import type { Attachment, AttachmentChangeEvent } from '../../shared/types.js';
import { loadCycles } from '../cycles.js';
import { pool, takeWriteLock, withTransaction } from '../db/pool.js';
import { buildSnapshot, loadGraph } from '../domain/graph.js';
import type { Ctx } from '../http/context.js';
import { apiError } from '../http/errors.js';
import { json, type Reply } from '../http/reply.js';
import { markStorage } from '../services/monitor.js';
import {
  objectKey,
  putObject,
  removeObject,
  signedDownload,
  storedSize,
  StorageUnavailable,
} from '../services/storage.js';
import { refuseIfAny, type Fields } from './validate.js';

interface AttachmentRow {
  id: string;
  task: number;
  file_name: string;
  kind: AttachmentKind;
  size: string;
  content_type: string;
  object_key: string;
  created_at: Date;
}

function toAttachment(row: AttachmentRow, current: boolean): Attachment {
  return {
    id: row.id,
    task: taskId(row.task),
    file_name: row.file_name,
    kind: row.kind,
    size: Number(row.size),
    content_type: row.content_type,
    created_at: row.created_at.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    current,
  };
}

/** Newest first, with the newest of each kind marked as the current one. */
function withCurrent(rows: AttachmentRow[]): Attachment[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    const current = !seen.has(row.kind);
    seen.add(row.kind);
    return toAttachment(row, current);
  });
}

async function listRows(task: number): Promise<AttachmentRow[]> {
  const result = await pool.query<AttachmentRow>(
    `select id::text as id, task, file_name, kind, size::text as size, content_type,
            object_key, created_at
     from attachments where task = $1 order by created_at desc, id desc`,
    [task],
  );
  return result.rows;
}

export async function listAttachments(number: number): Promise<Reply> {
  return json(200, { attachments: withCurrent(await listRows(number)) });
}

const MAGIC: Record<string, (bytes: Buffer) => boolean> = {
  'application/pdf': (bytes) => bytes.subarray(0, 4).toString('latin1') === '%PDF',
  'image/png': (bytes) =>
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (bytes) =>
    bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
};

export async function uploadAttachment(ctx: Ctx, number: number): Promise<Reply> {
  const multipart = ctx.multipart as NonNullable<Ctx['multipart']>;
  const fields: Fields = { ...ctx.headerFields };
  const kindValue = multipart.fields.kind ?? '';
  if (!(ATTACHMENT_KINDS as readonly string[]).includes(kindValue)) {
    fields.kind = fieldMessage.kind;
  }
  const file = multipart.file;
  if (
    multipart.interrupted ||
    file === null ||
    file.bytes.length === 0 ||
    !(UPLOAD_CONTENT_TYPES as readonly string[]).includes(file.contentType) ||
    MAGIC[file.contentType]?.(file.bytes) !== true
  ) {
    fields.file = fieldMessage.file;
  }
  refuseIfAny(fields);

  const part = file as NonNullable<typeof file>;
  const kind = kindValue as AttachmentKind;
  const id = randomUUID();
  const key = objectKey(taskId(number), id, part.fileName);

  try {
    await putObject(key, part.bytes, part.contentType);
    const size = await storedSize(key);
    if (size !== part.bytes.length) {
      await removeObject(key);
      throw apiError.storageUnavailable();
    }
    markStorage(true);
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      markStorage(false);
      throw apiError.storageUnavailable();
    }
    throw error;
  }

  try {
    const attachment = await withTransaction(async (client) => {
      await takeWriteLock(client);
      await client.query(
        `insert into attachments (id, task, file_name, kind, size, content_type, object_key, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, number, part.fileName, kind, part.bytes.length, part.contentType, key, new Date()],
      );
      const now = new Date();
      const cycles = await loadCycles(client);
      const graph = await loadGraph(client);
      const inserted = await client.query<{ seq: string }>(
        `insert into changes (kind, actor, at, undoable, result)
         values ('attachment', $1, $2, false, '{}'::jsonb) returning seq::text as seq`,
        [ctx.actor, now],
      );
      const seq = Number((inserted.rows[0] as { seq: string }).seq);
      await client.query(
        `insert into activity (task, at, actor, kind, changes, change)
         values ($1, $2, $3, 'attached', '{}'::jsonb, $4)`,
        [number, now, ctx.actor, seq],
      );
      const rows = await client.query<AttachmentRow>(
        `select id::text as id, task, file_name, kind, size::text as size, content_type,
                object_key, created_at
         from attachments where task = $1 order by created_at desc, id desc`,
        [number],
      );
      const listed = withCurrent(rows.rows);
      const stored = listed.find((entry) => entry.id === id) as Attachment;
      const event: AttachmentChangeEvent = {
        change: seq,
        undoable: false,
        kind: 'attachment',
        attachment: stored,
        cascade: [],
        reblocked: [],
        snapshot: buildSnapshot(graph, cycles, seq, now),
      };
      await client.query('update changes set result = $2 where seq = $1', [
        seq,
        JSON.stringify(event),
      ]);
      await client.query('select pg_notify($1, $2)', ['promptside_change', String(seq)]);
      return stored;
    });
    return json(201, { attachment });
  } catch (error) {
    await removeObject(key);
    throw error;
  }
}

export async function downloadAttachment(id: string): Promise<Reply> {
  const result = await pool.query<AttachmentRow>(
    `select id::text as id, task, file_name, kind, size::text as size, content_type,
            object_key, created_at
     from attachments where id::text = $1`,
    [id],
  );
  const row = result.rows[0];
  if (!row) throw apiError.notFound();
  try {
    const size = await storedSize(row.object_key);
    if (size === null) throw apiError.storageUnavailable();
    const link = await signedDownload(row.object_key, row.file_name);
    markStorage(true);
    return { status: 302, headers: { Location: link }, json: null };
  } catch (error) {
    if (error instanceof StorageUnavailable) {
      markStorage(false);
      throw apiError.storageUnavailable();
    }
    throw error;
  }
}

