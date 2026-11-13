import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { requireCaller } from '../auth.ts';
import { config } from '../config.ts';
import { query, withTransaction } from '../db/pool.ts';
import { appendAudit } from '../domain/audit.ts';
import { canDocumentMove } from '../domain/transitions.ts';
import {
  ApiError,
  invalidState,
  mailUnavailable,
  notFound,
  storageUnavailable,
  validation,
} from '../http/errors.ts';
import { codePoints, readString } from '../http/read.ts';
import { sendJson, type HttpApp } from '../http/server.ts';
import { markStorageDown, recheckStorage } from '../services/health.ts';
import { MailUnavailable } from '../services/mail.ts';
import { getObject, originalKey, putObject, templateKey } from '../services/storage.ts';
import { VALIDATION } from '../../shared/copy.ts';
import {
  currentRecipient,
  documentJson,
  loadAggregate,
  recipientStatus,
  touchDocument,
} from '../model/document.ts';
import {
  beginTurn,
  freshLinkToken,
  issueNewLink,
  lockDocument,
  recordVoid,
  tokenHash,
} from '../model/flow.ts';
import { deliverAllOrHold, deliverNow, reminderMail, type Outgoing } from '../model/mailer.ts';
import { templateJson } from '../model/template.ts';
import { loadForCaller, requireCapability, requireDraft, requireRecipient } from './access.ts';

export const registerRoutingRoutes = (app: HttpApp): void => {
  app.on('POST', '/api/documents/:id/send', async (ctx) => {
    const caller = await requireCaller(ctx);
    const aggregate = await loadForCaller(ctx, caller);
    const key = ctx.req.headers['idempotency-key'];
    const idempotencyKey =
      typeof key === 'string' && key.length >= 1 && key.length <= 100 ? key : null;

    if (idempotencyKey !== null) {
      const stored = await query<{ document_id: string; status: number; body: unknown }>(
        'SELECT document_id, status, body FROM idempotency_keys WHERE key = $1',
        [idempotencyKey],
      );
      const record = stored[0];
      if (record) {
        if (record.document_id !== aggregate.doc.id) {
          throw new ApiError(422, { error: 'idempotency_key_reused' });
        }
        sendJson(ctx.res, record.status, record.body);
        return;
      }
    }
    requireCapability(caller, aggregate, 'send');

    const result = await withTransaction(async (client) => {
      await lockDocument(client, aggregate.doc.id);
      const fresh = await loadAggregate(aggregate.doc.id, caller.teamId, client);
      if (!fresh) throw notFound();
      if (!canDocumentMove(fresh.doc.status, 'in_progress')) throw invalidState(fresh.doc.status);
      if (fresh.recipients.length === 0) {
        throw new ApiError(422, { error: 'no_recipients' });
      }
      const missing = fresh.recipients
        .filter(
          (recipient) =>
            !fresh.fields.some(
              (field) =>
                field.recipient_id === recipient.id &&
                field.kind === 'signature' &&
                field.required,
            ),
        )
        .map((recipient) => recipient.name);
      if (missing.length > 0) {
        throw new ApiError(422, { error: 'missing_signature_fields', recipients: missing });
      }
      const first = fresh.recipients[0];
      if (!first) throw new ApiError(422, { error: 'no_recipients' });
      const now = new Date();
      await client.query("UPDATE documents SET status = 'in_progress' WHERE id = $1", [
        fresh.doc.id,
      ]);
      await appendAudit(client, {
        documentId: fresh.doc.id,
        type: 'document.sent',
        actor: caller.email,
      });
      const invitation = await beginTurn(client, fresh, first, now);
      await touchDocument(client, fresh.doc.id);
      return { invitation };
    });
    await deliverAllOrHold([result.invitation]);
    const payload = await withTransaction(async (client) => {
      const loaded = await loadAggregate(aggregate.doc.id, caller.teamId, client);
      if (!loaded) throw notFound();
      const built = documentJson(loaded, new Date());
      if (idempotencyKey !== null) {
        await client.query(
          `INSERT INTO idempotency_keys (key, document_id, status, body) VALUES ($1, $2, $3, $4)
           ON CONFLICT (key) DO NOTHING`,
          [idempotencyKey, aggregate.doc.id, 200, JSON.stringify(built)],
        );
      }
      return built;
    });
    sendJson(ctx.res, 200, payload);
  });

  app.on('POST', '/api/documents/:id/remind', async (ctx) => {
    const caller = await requireCaller(ctx);
    const aggregate = await loadForCaller(ctx, caller);
    requireCapability(caller, aggregate, 'remind');
    if (aggregate.doc.status !== 'in_progress') throw invalidState(aggregate.doc.status);
    const now = new Date();
    const current = currentRecipient(aggregate);
    if (!current) throw invalidState(aggregate.doc.status);
    const status = recipientStatus(current, now);
    if (status !== 'invited' && status !== 'viewed') throw invalidState(status);

    const available = await withTransaction(async (client) => {
      await lockDocument(client, aggregate.doc.id);
      const fresh = await loadAggregate(aggregate.doc.id, caller.teamId, client);
      if (!fresh) throw notFound();
      if (
        fresh.doc.reminder_available_at !== null &&
        fresh.doc.reminder_available_at.getTime() > now.getTime()
      ) {
        throw new ApiError(429, {
          error: 'reminder_cooldown',
          availableAt: fresh.doc.reminder_available_at.toISOString(),
        });
      }
      const token = await reminderLink(client, fresh.doc.id, current.id);
      const message: Outgoing = reminderMail(
        fresh.doc.id,
        current.id,
        current.email,
        fresh.doc.title,
        fresh.doc.owner_name,
        token,
      );
      try {
        await deliverNow(message);
      } catch (error) {
        if (error instanceof MailUnavailable) throw mailUnavailable();
        throw error;
      }
      const availableAt = new Date(now.getTime() + config.reminderCooldownSeconds * 1000);
      await client.query('UPDATE documents SET reminder_available_at = $2 WHERE id = $1', [
        fresh.doc.id,
        availableAt,
      ]);
      await appendAudit(client, {
        documentId: fresh.doc.id,
        type: 'reminder.sent',
        actor: caller.email,
        recipientId: current.id,
      });
      await touchDocument(client, fresh.doc.id);
      return availableAt;
    });
    sendJson(ctx.res, 200, { reminderAvailableAt: available.toISOString() });
  });

  app.on('POST', '/api/documents/:id/recipients/:recipientId/new-link', async (ctx) => {
    const caller = await requireCaller(ctx);
    const aggregate = await loadForCaller(ctx, caller);
    const recipient = requireRecipient(aggregate, ctx.params['recipientId'] ?? '');
    requireCapability(caller, aggregate, 'send');
    if (aggregate.doc.status !== 'in_progress') throw invalidState(aggregate.doc.status);
    const now = new Date();
    const status = recipientStatus(recipient, now);
    if (status !== 'expired') throw invalidState(status);

    const result = await withTransaction(async (client) => {
      await lockDocument(client, aggregate.doc.id);
      const fresh = await loadAggregate(aggregate.doc.id, caller.teamId, client);
      if (!fresh) throw notFound();
      const row = fresh.recipients.find((item) => item.id === recipient.id);
      if (!row) throw notFound();
      return { mail: await issueNewLink(client, fresh, row, caller.email, now) };
    });
    await deliverAllOrHold([result.mail]);
    const after = await loadAggregate(aggregate.doc.id, caller.teamId);
    if (!after) throw notFound();
    sendJson(ctx.res, 200, documentJson(after, new Date()));
  });

  app.on('POST', '/api/documents/:id/void', async (ctx) => {
    const caller = await requireCaller(ctx);
    const aggregate = await loadForCaller(ctx, caller);
    requireCapability(caller, aggregate, 'void');
    if (!canDocumentMove(aggregate.doc.status, 'voided')) throw invalidState(aggregate.doc.status);
    const body = await ctx.body();
    const reason = readString(body, 'reason') ?? '';
    if (reason.trim() === '') throw validation({ reason: VALIDATION.reasonVoidEmpty });
    if (codePoints(reason) > 500) throw validation({ reason: VALIDATION.reasonTooLong });

    const result = await withTransaction(async (client) => {
      await lockDocument(client, aggregate.doc.id);
      const fresh = await loadAggregate(aggregate.doc.id, caller.teamId, client);
      if (!fresh) throw notFound();
      if (!canDocumentMove(fresh.doc.status, 'voided')) throw invalidState(fresh.doc.status);
      const mails = await recordVoid(client, fresh, caller.email, caller.userId, reason);
      const loaded = await loadAggregate(fresh.doc.id, caller.teamId, client);
      if (!loaded) throw notFound();
      return { payload: documentJson(loaded, new Date()), mails };
    });
    await deliverAllOrHold(result.mails);
    sendJson(ctx.res, 200, result.payload);
  });

  app.on('POST', '/api/documents/:id/template', async (ctx) => {
    const caller = await requireCaller(ctx);
    const aggregate = await loadForCaller(ctx, caller);
    requireCapability(caller, aggregate, 'saveTemplate');
    requireDraft(aggregate);
    const templateId = randomUUID();
    let original: Buffer | null;
    try {
      original = await getObject(originalKey(aggregate.doc.id));
      if (original === null) throw new Error('original missing');
      await putObject(templateKey(templateId), original);
    } catch {
      markStorageDown();
      void recheckStorage();
      throw storageUnavailable();
    }
    const template = await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO templates (id, team_id, name, status, page_count, signer_count, original_sha256)
         VALUES ($1, $2, $3, 'draft', $4, $5, $6)`,
        [
          templateId,
          caller.teamId,
          aggregate.doc.title,
          aggregate.doc.page_count,
          aggregate.recipients.length,
          aggregate.doc.original_sha256,
        ],
      );
      const orderOf = new Map(aggregate.recipients.map((row) => [row.id, row.order_index]));
      for (const field of aggregate.fields) {
        await client.query(
          `INSERT INTO template_fields (id, template_id, signer, kind, label, required, page, x, y, w, h)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            randomUUID(),
            templateId,
            orderOf.get(field.recipient_id) ?? 1,
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
      return templateJson(client, templateId);
    });
    sendJson(ctx.res, 201, template);
  });
};

/**
 * A reminder points at a link of its own, issued inside the turn's existing
 * lifetime so that the reminder never extends or revokes the signer's link.
 */
const reminderLink = async (
  client: pg.PoolClient,
  documentId: string,
  recipientId: string,
): Promise<string> => {
  const live = await client.query<{ issued_at: Date; expires_at: Date }>(
    `SELECT issued_at, expires_at FROM links
     WHERE recipient_id = $1 AND active ORDER BY issued_at DESC LIMIT 1`,
    [recipientId],
  );
  const lifetime = live.rows[0];
  if (!lifetime) throw notFound();
  const token = freshLinkToken();
  await client.query(
    `INSERT INTO links (id, document_id, recipient_id, token_hash, issued_at, expires_at, active)
     VALUES ($1, $2, $3, $4, $5, $6, true)`,
    [
      randomUUID(),
      documentId,
      recipientId,
      tokenHash(token),
      lifetime.issued_at,
      lifetime.expires_at,
    ],
  );
  return token;
};
