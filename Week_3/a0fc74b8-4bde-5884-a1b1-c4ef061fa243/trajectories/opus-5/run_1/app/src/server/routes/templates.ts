import { randomUUID } from 'node:crypto';
import { requireCaller, type Caller } from '../auth.ts';
import { queryOne, withTransaction } from '../db/pool.ts';
import { appendAudit } from '../domain/audit.ts';
import { allows } from '../domain/roles.ts';
import { forbidden, invalidState, notFound, storageUnavailable, validation } from '../http/errors.ts';
import { isEmail, readObjectArray, readString } from '../http/read.ts';
import { sendJson, type HttpApp } from '../http/server.ts';
import { markStorageDown, recheckStorage } from '../services/health.ts';
import { getObject, originalKey, putObject, templateKey } from '../services/storage.ts';
import { VALIDATION } from '../../shared/copy.ts';
import type { TemplateStatus } from '../../shared/types.ts';
import { documentJson, loadAggregate } from '../model/document.ts';
import {
  listTemplatesForTeam,
  templateJson,
  type TemplateFieldRow,
  type TemplateRow,
} from '../model/template.ts';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const loadTemplate = async (
  id: string,
  caller: Caller,
  requireShared: boolean,
): Promise<TemplateRow> => {
  if (!UUID_PATTERN.test(id)) throw notFound();
  const row = await queryOne<TemplateRow>(
    'SELECT id, team_id, name, status, page_count, signer_count, original_sha256 FROM templates WHERE id = $1 AND team_id = $2',
    [id, caller.teamId],
  );
  if (!row) throw notFound();
  if (requireShared && caller.role !== 'owner' && row.status !== 'shared') throw notFound();
  return row;
};

export const registerTemplateRoutes = (app: HttpApp): void => {
  app.on('GET', '/api/templates', async (ctx) => {
    const caller = await requireCaller(ctx);
    const templates = await listTemplatesForTeam(caller.teamId, caller.role !== 'owner');
    sendJson(ctx.res, 200, { templates });
  });

  app.on('GET', '/api/templates/:id', async (ctx) => {
    const caller = await requireCaller(ctx);
    const row = await loadTemplate(ctx.params['id'] ?? '', caller, true);
    const payload = await withTransaction((client) => templateJson(client, row.id));
    sendJson(ctx.res, 200, payload);
  });

  const transition = (from: TemplateStatus, to: TemplateStatus): boolean =>
    (from === 'draft' && to === 'shared') || (from === 'shared' && to === 'retired');

  for (const [path, next] of [
    ['share', 'shared'],
    ['retire', 'retired'],
  ] as const) {
    app.on('POST', `/api/templates/:id/${path}`, async (ctx) => {
      const caller = await requireCaller(ctx);
      const row = await loadTemplate(ctx.params['id'] ?? '', caller, false);
      if (!allows({ userId: caller.userId, role: caller.role }, 'shareTemplate', null)) {
        throw forbidden();
      }
      if (!transition(row.status, next)) throw invalidState(row.status);
      const payload = await withTransaction(async (client) => {
        await client.query('UPDATE templates SET status = $2 WHERE id = $1', [row.id, next]);
        return templateJson(client, row.id);
      });
      sendJson(ctx.res, 200, payload);
    });
  }

  app.on('POST', '/api/templates/:id/use', async (ctx) => {
    const caller = await requireCaller(ctx);
    const row = await loadTemplate(ctx.params['id'] ?? '', caller, true);
    if (!allows({ userId: caller.userId, role: caller.role }, 'useTemplate', null)) {
      throw forbidden();
    }
    if (row.status !== 'shared') throw invalidState(row.status);
    const body = await ctx.body();
    const signers = readObjectArray(body, 'signers') ?? [];
    const cleaned = signers.map((signer) => ({
      name: (readString(signer, 'name') ?? '').trim(),
      email: (readString(signer, 'email') ?? '').trim().toLowerCase(),
    }));
    const emails = new Set(cleaned.map((signer) => signer.email));
    if (
      cleaned.length !== row.signer_count ||
      cleaned.some((signer) => signer.name === '' || !isEmail(signer.email)) ||
      emails.size !== cleaned.length
    ) {
      throw validation({ signers: VALIDATION.signers });
    }

    const documentId = randomUUID();
    try {
      const original = await getObject(templateKey(row.id));
      if (original === null) throw new Error('template original missing');
      await putObject(originalKey(documentId), original);
    } catch {
      markStorageDown();
      void recheckStorage();
      throw storageUnavailable();
    }

    const aggregate = await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO documents (id, team_id, owner_id, title, status, page_count, original_sha256)
         VALUES ($1, $2, $3, $4, 'draft', $5, $6)`,
        [documentId, caller.teamId, caller.userId, row.name, row.page_count, row.original_sha256],
      );
      const recipientIds = new Map<number, string>();
      for (const [index, signer] of cleaned.entries()) {
        const recipientId = randomUUID();
        recipientIds.set(index + 1, recipientId);
        await client.query(
          `INSERT INTO recipients (id, document_id, name, email, order_index, status)
           VALUES ($1, $2, $3, $4, $5, 'waiting')`,
          [recipientId, documentId, signer.name, signer.email, index + 1],
        );
      }
      const fields = await client.query<TemplateFieldRow>(
        `SELECT signer, kind, label, required, page, x, y, w, h
         FROM template_fields WHERE template_id = $1 ORDER BY seq`,
        [row.id],
      );
      for (const field of fields.rows) {
        const recipientId = recipientIds.get(field.signer) ?? recipientIds.get(1);
        if (recipientId === undefined) continue;
        await client.query(
          `INSERT INTO fields (id, document_id, recipient_id, kind, label, required, page, x, y, w, h)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            randomUUID(),
            documentId,
            recipientId,
            field.kind,
            field.label,
            field.required,
            field.page,
            field.x,
            field.y,
            field.w,
            field.h,
          ],
        );
      }
      await appendAudit(client, { documentId, type: 'document.created', actor: caller.email });
      const loaded = await loadAggregate(documentId, caller.teamId, client);
      if (!loaded) throw notFound();
      return loaded;
    });
    sendJson(ctx.res, 201, documentJson(aggregate, new Date()));
  });
};
