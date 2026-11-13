import { randomUUID } from 'node:crypto';
import { requireCaller } from '../auth.ts';
import { MAX_RECIPIENTS } from '../config.ts';
import { withTransaction } from '../db/pool.ts';
import { ApiError, notFound, validation } from '../http/errors.ts';
import { codePoints, readString } from '../http/read.ts';
import { sendEmpty, sendJson, type HttpApp } from '../http/server.ts';
import { VALIDATION } from '../../shared/copy.ts';
import { loadAggregate, recipientJson, touchDocument } from '../model/document.ts';
import {
  EMAIL_PATTERN,
  loadForCaller,
  requireCapability,
  requireDraft,
  requireRecipient,
} from './access.ts';

export const registerRecipientRoutes = (app: HttpApp): void => {
  app.on('POST', '/api/documents/:id/recipients', async (ctx) => {
    const caller = await requireCaller(ctx);
    const aggregate = await loadForCaller(ctx, caller);
    requireCapability(caller, aggregate, 'editOwnDraft');
    requireDraft(aggregate);
    const body = await ctx.body();
    const name = (readString(body, 'name') ?? '').trim();
    const email = (readString(body, 'email') ?? '').trim().toLowerCase();
    const errors: Record<string, string> = {};
    if (name === '' || codePoints(name) > 120) errors['name'] = VALIDATION.name;
    if (!EMAIL_PATTERN.test(email)) errors['email'] = VALIDATION.emailInvalid;
    else if (aggregate.recipients.some((row) => row.email === email)) {
      errors['email'] = VALIDATION.emailDuplicate;
    }
    if (aggregate.recipients.length >= MAX_RECIPIENTS) errors['recipients'] = VALIDATION.recipients;
    if (Object.keys(errors).length > 0) throw validation(errors);

    const created = await withTransaction(async (client) => {
      const id = randomUUID();
      const order = aggregate.recipients.length + 1;
      await client.query(
        `INSERT INTO recipients (id, document_id, name, email, order_index, status)
         VALUES ($1, $2, $3, $4, $5, 'waiting')`,
        [id, aggregate.doc.id, name, email, order],
      );
      await touchDocument(client, aggregate.doc.id);
      const loaded = await loadAggregate(aggregate.doc.id, caller.teamId, client);
      const row = loaded?.recipients.find((item) => item.id === id);
      if (!row) throw notFound();
      return row;
    });
    sendJson(ctx.res, 201, recipientJson(created, new Date()));
  });

  app.on('PATCH', '/api/documents/:id/recipients/:recipientId', async (ctx) => {
    const caller = await requireCaller(ctx);
    const aggregate = await loadForCaller(ctx, caller);
    const recipient = requireRecipient(aggregate, ctx.params['recipientId'] ?? '');
    requireCapability(caller, aggregate, 'editOwnDraft');
    requireDraft(aggregate);
    const body = await ctx.body();
    const name = readString(body, 'name');
    const email = readString(body, 'email');
    const errors: Record<string, string> = {};
    if (name !== null && (name.trim() === '' || codePoints(name) > 120)) {
      errors['name'] = VALIDATION.name;
    }
    const lowered = email === null ? null : email.trim().toLowerCase();
    if (lowered !== null) {
      if (!EMAIL_PATTERN.test(lowered)) {
        errors['email'] = VALIDATION.emailInvalid;
      } else if (
        aggregate.recipients.some((row) => row.email === lowered && row.id !== recipient.id)
      ) {
        errors['email'] = VALIDATION.emailDuplicate;
      }
    }
    if (Object.keys(errors).length > 0) throw validation(errors);

    const updated = await withTransaction(async (client) => {
      if (name !== null) {
        await client.query('UPDATE recipients SET name = $2 WHERE id = $1', [
          recipient.id,
          name.trim(),
        ]);
      }
      if (lowered !== null) {
        await client.query('UPDATE recipients SET email = $2 WHERE id = $1', [
          recipient.id,
          lowered,
        ]);
      }
      await touchDocument(client, aggregate.doc.id);
      const loaded = await loadAggregate(aggregate.doc.id, caller.teamId, client);
      const row = loaded?.recipients.find((item) => item.id === recipient.id);
      if (!row) throw notFound();
      return row;
    });
    sendJson(ctx.res, 200, recipientJson(updated, new Date()));
  });

  app.on('DELETE', '/api/documents/:id/recipients/:recipientId', async (ctx) => {
    const caller = await requireCaller(ctx);
    const aggregate = await loadForCaller(ctx, caller);
    const recipient = requireRecipient(aggregate, ctx.params['recipientId'] ?? '');
    requireCapability(caller, aggregate, 'editOwnDraft');
    requireDraft(aggregate);
    await withTransaction(async (client) => {
      await client.query('DELETE FROM recipients WHERE id = $1', [recipient.id]);
      await client.query(
        'UPDATE recipients SET order_index = order_index - 1 WHERE document_id = $1 AND order_index > $2',
        [aggregate.doc.id, recipient.order_index],
      );
      await touchDocument(client, aggregate.doc.id);
    });
    sendEmpty(ctx.res, 204);
  });

  app.on('POST', '/api/documents/:id/recipients/:recipientId/move', async (ctx) => {
    const caller = await requireCaller(ctx);
    const aggregate = await loadForCaller(ctx, caller);
    const recipient = requireRecipient(aggregate, ctx.params['recipientId'] ?? '');
    requireCapability(caller, aggregate, 'editOwnDraft');
    requireDraft(aggregate);
    const body = await ctx.body();
    const direction = readString(body, 'direction');
    if (direction !== 'up' && direction !== 'down') {
      throw validation({ direction: 'Choose up or down.' });
    }
    const target = direction === 'up' ? recipient.order_index - 1 : recipient.order_index + 1;
    if (target < 1 || target > aggregate.recipients.length) {
      throw new ApiError(409, { error: 'cannot_move' });
    }
    const recipients = await withTransaction(async (client) => {
      const other = aggregate.recipients.find((row) => row.order_index === target);
      if (!other) throw new ApiError(409, { error: 'cannot_move' });
      await client.query('UPDATE recipients SET order_index = 0 WHERE id = $1', [recipient.id]);
      await client.query('UPDATE recipients SET order_index = $2 WHERE id = $1', [
        other.id,
        recipient.order_index,
      ]);
      await client.query('UPDATE recipients SET order_index = $2 WHERE id = $1', [
        recipient.id,
        target,
      ]);
      await touchDocument(client, aggregate.doc.id);
      const loaded = await loadAggregate(aggregate.doc.id, caller.teamId, client);
      if (!loaded) throw notFound();
      return loaded.recipients;
    });
    const now = new Date();
    sendJson(ctx.res, 200, { recipients: recipients.map((row) => recipientJson(row, now)) });
  });

};
