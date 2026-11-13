import { createHash, randomUUID } from 'node:crypto';
import busboy from 'busboy';
import { requireCaller } from '../auth.ts';
import { MAX_UPLOAD_BYTES } from '../config.ts';
import { query, withTransaction } from '../db/pool.ts';
import { appendAudit } from '../domain/audit.ts';
import { allows } from '../domain/roles.ts';
import { ApiError, forbidden, invalidState, notFound, storageUnavailable, tooLarge, validation } from '../http/errors.ts';
import { isTimeZone, readString } from '../http/read.ts';
import { sendBytes, sendJson, type Ctx, type HttpApp } from '../http/server.ts';
import { inspectUpload } from '../pdf/inspect.ts';
import { completedKey, getObject, originalKey, putObject } from '../services/storage.ts';
import { markStorageDown, recheckStorage } from '../services/health.ts';
import { VALIDATION } from '../../shared/copy.ts';
import type { DocumentFilter } from '../../shared/types.ts';
import { documentJson, listDocuments, loadAggregate, touchDocument } from '../model/document.ts';
import { loadForCaller, requireCapability, requireDraft, titleError } from './access.ts';

interface UploadPart {
  fileName: string;
  bytes: Buffer;
  title: string | null;
  oversized: boolean;
}

const readUpload = (ctx: Ctx): Promise<UploadPart> =>
  new Promise((resolve, reject) => {
    const contentType = ctx.req.headers['content-type'] ?? '';
    if (!contentType.includes('multipart/form-data')) {
      reject(validation({ file: VALIDATION.file }));
      return;
    }
    const parser = busboy({
      headers: ctx.req.headers,
      limits: { files: 1, fileSize: MAX_UPLOAD_BYTES + 1, fields: 8 },
    });
    const chunks: Buffer[] = [];
    let fileName = '';
    let title: string | null = null;
    let oversized = false;
    let seenFile = false;

    parser.on('file', (name, stream, info) => {
      if (name !== 'file') {
        stream.resume();
        return;
      }
      seenFile = true;
      fileName = info.filename ?? '';
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('limit', () => {
        oversized = true;
      });
      stream.on('end', () => undefined);
    });
    parser.on('field', (name, value) => {
      if (name === 'title') title = value;
    });
    parser.on('close', () => {
      if (!seenFile) {
        reject(validation({ file: VALIDATION.file }));
        return;
      }
      resolve({ fileName, bytes: Buffer.concat(chunks), title, oversized });
    });
    parser.on('error', (error: unknown) => reject(error));
    ctx.req.pipe(parser);
  });

const defaultTitle = (fileName: string): string => {
  const base = fileName.replace(/^.*[\\/]/, '');
  return base.toLowerCase().endsWith('.pdf') ? base.slice(0, -4) : base;
};

const uploadRefusalStatus: Record<string, number> = {
  not_a_pdf: 415,
  pdf_encrypted: 422,
  pdf_has_scripts: 422,
  pdf_rotated: 422,
  too_many_pages: 422,
};

export const registerDocumentRoutes = (app: HttpApp): void => {
  app.on('GET', '/api/documents', async (ctx) => {
    const caller = await requireCaller(ctx);
    const raw = ctx.url.searchParams.get('filter') ?? 'all';
    const filter: DocumentFilter =
      raw === 'in_progress' || raw === 'completed' || raw === 'closed' ? raw : 'all';
    const documents = await listDocuments(caller.teamId, filter, new Date());
    sendJson(ctx.res, 200, { documents });
  });

  app.on('POST', '/api/documents', async (ctx) => {
    const part = await readUpload(ctx);
    const caller = await requireCaller(ctx);
    if (!allows({ userId: caller.userId, role: caller.role }, 'upload', null)) throw forbidden();
    if (part.oversized || part.bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw tooLarge(MAX_UPLOAD_BYTES);
    }
    const title = (part.title ?? '').trim() === '' ? defaultTitle(part.fileName) : (part.title ?? '');
    const problem = titleError(title);
    if (problem !== null) throw validation({ title: problem });
    if (part.bytes.byteLength === 0) throw validation({ file: VALIDATION.file });

    const verdict = inspectUpload(part.bytes);
    if (!verdict.ok) {
      const status = uploadRefusalStatus[verdict.refusal] ?? 422;
      const body: Record<string, unknown> = { error: verdict.refusal };
      if (verdict.refusal === 'too_many_pages') body['limit'] = 60;
      throw new ApiError(status, body);
    }

    const documentId = randomUUID();
    try {
      await putObject(originalKey(documentId), part.bytes);
    } catch {
      markStorageDown();
      void recheckStorage();
      throw storageUnavailable();
    }
    const sha = createHash('sha256').update(part.bytes).digest('hex');
    const aggregate = await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO documents (id, team_id, owner_id, title, status, page_count, original_sha256)
         VALUES ($1, $2, $3, $4, 'draft', $5, $6)`,
        [documentId, caller.teamId, caller.userId, title, verdict.pageCount, sha],
      );
      await appendAudit(client, {
        documentId,
        type: 'document.created',
        actor: caller.email,
      });
      const loaded = await loadAggregate(documentId, caller.teamId, client);
      if (!loaded) throw notFound();
      return loaded;
    });
    sendJson(ctx.res, 201, documentJson(aggregate, new Date()));
  });

  app.on('GET', '/api/documents/:id', async (ctx) => {
    const caller = await requireCaller(ctx);
    const aggregate = await loadForCaller(ctx, caller);
    sendJson(ctx.res, 200, documentJson(aggregate, new Date()));
  });

  app.on('PATCH', '/api/documents/:id', async (ctx) => {
    const caller = await requireCaller(ctx);
    const aggregate = await loadForCaller(ctx, caller);
    requireCapability(caller, aggregate, 'editOwnDraft');
    requireDraft(aggregate);
    const body = await ctx.body();
    const errors: Record<string, string> = {};
    const title = readString(body, 'title');
    const timeZone = readString(body, 'timeZone');
    if (title !== null) {
      const problem = titleError(title);
      if (problem !== null) errors['title'] = problem;
    }
    if (timeZone !== null && !isTimeZone(timeZone)) errors['timeZone'] = VALIDATION.timeZone;
    if (Object.keys(errors).length > 0) throw validation(errors);

    const updated = await withTransaction(async (client) => {
      if (title !== null) {
        await client.query('UPDATE documents SET title = $2 WHERE id = $1', [
          aggregate.doc.id,
          title,
        ]);
      }
      if (timeZone !== null) {
        await client.query('UPDATE documents SET time_zone = $2 WHERE id = $1', [
          aggregate.doc.id,
          timeZone,
        ]);
      }
      await touchDocument(client, aggregate.doc.id);
      const loaded = await loadAggregate(aggregate.doc.id, caller.teamId, client);
      if (!loaded) throw notFound();
      return loaded;
    });
    sendJson(ctx.res, 200, documentJson(updated, new Date()));
  });

  app.on('GET', '/api/documents/:id/original.pdf', async (ctx) => {
    const caller = await requireCaller(ctx);
    const aggregate = await loadForCaller(ctx, caller);
    let bytes: Buffer | null;
    try {
      bytes = await getObject(originalKey(aggregate.doc.id));
    } catch {
      markStorageDown();
      void recheckStorage();
      throw storageUnavailable();
    }
    if (bytes === null) throw storageUnavailable();
    sendBytes(ctx.res, 200, 'application/pdf', bytes, { 'cache-control': 'private, max-age=300' });
  });

  app.on('GET', '/api/documents/:id/completed.pdf', async (ctx) => {
    const caller = await requireCaller(ctx);
    const aggregate = await loadForCaller(ctx, caller);
    if (aggregate.doc.status !== 'completed') throw invalidState(aggregate.doc.status);
    let bytes: Buffer | null;
    try {
      bytes = await getObject(completedKey(aggregate.doc.id));
    } catch {
      markStorageDown();
      void recheckStorage();
      throw storageUnavailable();
    }
    if (bytes === null) throw storageUnavailable();
    sendBytes(ctx.res, 200, 'application/pdf', bytes, {
      'content-disposition': 'attachment; filename="completed.pdf"',
    });
  });

  app.on('GET', '/api/documents/:id/audit', async (ctx) => {
    const caller = await requireCaller(ctx);
    const aggregate = await loadForCaller(ctx, caller);
    const events = await query<{
      seq: number;
      type: string;
      actor: string;
      recipient_id: string | null;
      at_text: string;
      prev_hash: string;
      hash: string;
    }>(
      `SELECT seq, type, actor, recipient_id, at_text, prev_hash, hash
       FROM audit_events WHERE document_id = $1 ORDER BY seq`,
      [aggregate.doc.id],
    );
    sendJson(ctx.res, 200, {
      events: events.map((row) => ({
        seq: row.seq,
        type: row.type,
        actor: row.actor,
        recipientId: row.recipient_id,
        at: row.at_text,
        prevHash: row.prev_hash,
        hash: row.hash,
      })),
    });
  });

};
