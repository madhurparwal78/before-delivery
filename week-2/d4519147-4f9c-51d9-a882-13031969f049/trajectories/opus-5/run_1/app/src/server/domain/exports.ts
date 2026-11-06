import { createHash } from 'node:crypto';
import { config } from '../config';
import { newId } from '../crypto';
import { query, queryOne, withTransaction } from '../db';
import { errors } from '../http/errors';
import { StorageUnavailable, confirmObject, putObject } from '../services/storage';
import type { Derived, ExportFileRecord, ExportRecord, PageDocument } from '../../shared/types';
import { writeDiagramEvent } from './audit';
import { renderExport, type ExportPage } from './exporter';
import type { DiagramAccess } from './access';
import type { SessionUser } from './sessions';

interface ExportRow {
  id: string;
  status: 'pending' | 'ready' | 'failed';
  page_ids: string[];
  files: ExportFileRecord[];
  created_by_email: string;
  created_at: Date;
}

function toRecord(row: ExportRow): ExportRecord {
  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    createdBy: row.created_by_email,
    pageIds: row.page_ids,
    files: row.files,
  };
}

export async function listExports(diagramId: string): Promise<ExportRecord[]> {
  const rows = await query<ExportRow>(
    `select id, status, page_ids, files, created_by_email, created_at
     from exports where diagram_id = $1 order by seq desc`,
    [diagramId],
  );
  return rows.map(toRecord);
}

export async function loadExport(diagramId: string, exportId: string): Promise<ExportRecord | null> {
  const row = await queryOne<ExportRow>(
    `select id, status, page_ids, files, created_by_email, created_at
     from exports where diagram_id = $1 and id = $2`,
    [diagramId, exportId],
  );
  return row ? toRecord(row) : null;
}

export function exportObjectKey(diagramId: string, exportId: string, format: 'png' | 'svg' | 'json'): string {
  return `exports/${diagramId}/${exportId}/diagram.${format}`;
}

interface PageRow {
  id: string;
  doc: PageDocument;
  derived: Derived;
}

async function resolvePages(diagramId: string, requested: string[] | null): Promise<PageRow[]> {
  const rows = await query<PageRow>('select id, doc, derived from pages where diagram_id = $1 order by seq', [
    diagramId,
  ]);
  if (!requested) return rows;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const resolved: PageRow[] = [];
  for (const pageId of requested) {
    const row = byId.get(pageId);
    if (!row) throw errors.notFound();
    resolved.push(row);
  }
  return resolved;
}

export interface CreateExportResult {
  record: ExportRecord;
  replayed: boolean;
}

export function readPageIds(json: unknown): string[] | null {
  const body = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
  if (body.pageIds === undefined || body.pageIds === null) return null;
  if (!Array.isArray(body.pageIds)) throw errors.validation({ pageIds: 'invalid' });
  const ids: string[] = [];
  for (const value of body.pageIds) {
    if (typeof value !== 'string') throw errors.validation({ pageIds: 'invalid' });
    ids.push(value);
  }
  return ids;
}

/**
 * Creates an export, confirming all three objects in storage before it is ready.
 * The idempotency key is scoped to one person and one diagram.
 */
export async function createExport(
  user: SessionUser,
  access: DiagramAccess,
  requestedPageIds: string[] | null,
  idempotencyKey: string | null,
): Promise<CreateExportResult> {
  const pages = await resolvePages(access.diagramId, requestedPageIds);

  if (idempotencyKey) {
    await query(
      `delete from idempotency_keys where user_id = $1 and diagram_id = $2 and key = $3
         and created_at < now() - interval '1 second' * $4`,
      [user.id, access.diagramId, idempotencyKey, config.idempotencyKeySeconds],
    );
    const claimed = await query<{ state: string; response: ExportRecord | null }>(
      `insert into idempotency_keys (user_id, diagram_id, key, state)
       values ($1, $2, $3, 'in_progress')
       on conflict (user_id, diagram_id, key) do nothing
       returning state, response`,
      [user.id, access.diagramId, idempotencyKey],
    );
    if (claimed.length === 0) {
      const existing = await queryOne<{ state: string; response: ExportRecord | null }>(
        'select state, response from idempotency_keys where user_id = $1 and diagram_id = $2 and key = $3',
        [user.id, access.diagramId, idempotencyKey],
      );
      if (existing?.state === 'done' && existing.response) return { record: existing.response, replayed: true };
      throw errors.conflict('idempotency_in_progress', 'That export is already being prepared.');
    }
  }

  try {
    if (requestedPageIds) {
      if (requestedPageIds.length === 0) throw errors.validation({ pageIds: 'empty' });
      if (new Set(requestedPageIds).size !== requestedPageIds.length) {
        throw errors.validation({ pageIds: 'repeated' });
      }
    }

    const exportId = newId();
    const createdAt = new Date();
    await query(
      `insert into exports (id, diagram_id, status, page_ids, files, created_by, created_by_email, created_at)
       values ($1, $2, 'pending', $3, '[]'::jsonb, $4, $5, $6)`,
      [
        exportId,
        access.diagramId,
        JSON.stringify(pages.map((page) => page.id)),
        user.id,
        user.email,
        createdAt,
      ],
    );

    const exportPages: ExportPage[] = pages.map((page) => ({ doc: page.doc, derived: page.derived }));
    const rendered = renderExport({ id: access.diagramId, title: access.title }, exportPages, createdAt);
    const payloads: Array<{ format: 'png' | 'svg' | 'json'; bytes: Buffer; contentType: string }> = [
      { format: 'png', bytes: rendered.png, contentType: 'image/png' },
      { format: 'svg', bytes: Buffer.from(rendered.svg, 'utf8'), contentType: 'image/svg+xml' },
      { format: 'json', bytes: Buffer.from(rendered.json, 'utf8'), contentType: 'application/json' },
    ];

    try {
      const files: ExportFileRecord[] = [];
      for (const payload of payloads) {
        const key = exportObjectKey(access.diagramId, exportId, payload.format);
        const sha256 = createHash('sha256').update(payload.bytes).digest('hex');
        await putObject(key, payload.bytes, payload.contentType);
        const confirmed = await confirmObject(key, { sizeBytes: payload.bytes.length, sha256 });
        if (!confirmed) throw new StorageUnavailable('storage did not confirm the export files');
        files.push({ format: payload.format, sizeBytes: payload.bytes.length, sha256 });
      }
      const record = await withTransaction(async (client) => {
        await client.query(`update exports set status = 'ready', files = $2 where id = $1`, [
          exportId,
          JSON.stringify(files),
        ]);
        await writeDiagramEvent(client, access.diagramId, user.email, 'export.created', { exportId });
        return {
          id: exportId,
          status: 'ready' as const,
          createdAt: createdAt.toISOString(),
          createdBy: user.email,
          pageIds: pages.map((page) => page.id),
          files,
        };
      });
      if (idempotencyKey) {
        await query(
          `update idempotency_keys set state = 'done', response = $4
           where user_id = $1 and diagram_id = $2 and key = $3`,
          [user.id, access.diagramId, idempotencyKey, JSON.stringify(record)],
        );
      }
      return { record, replayed: false };
    } catch (error) {
      await withTransaction(async (client) => {
        await client.query(`update exports set status = 'failed', files = '[]'::jsonb where id = $1`, [exportId]);
        await writeDiagramEvent(client, access.diagramId, user.email, 'export.failed', { exportId });
      });
      if (error instanceof StorageUnavailable) throw errors.storageUnavailable();
      throw error;
    }
  } catch (error) {
    if (idempotencyKey) {
      await query(
        `delete from idempotency_keys where user_id = $1 and diagram_id = $2 and key = $3 and state = 'in_progress'`,
        [user.id, access.diagramId, idempotencyKey],
      );
    }
    throw error;
  }
}

export function readIdempotencyKey(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  if (header.length < 1 || header.length > 64) return null;
  for (const char of header) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x21 || code > 0x7e) return null;
  }
  return header;
}
