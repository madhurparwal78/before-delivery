import { withTransaction } from '../db/pool.ts';
import { appendAudit } from '../domain/audit.ts';
import { canRecipientMove } from '../domain/transitions.ts';
import {
  ApiError,
  linkClosed,
  notFound,
  storageUnavailable,
  validation,
} from '../http/errors.ts';
import { codePoints, readArray, readString } from '../http/read.ts';
import { sendBytes, sendJson, type HttpApp } from '../http/server.ts';
import { completedKey, getObject, originalKey } from '../services/storage.ts';
import { markStorageDown, recheckStorage } from '../services/health.ts';
import { VALIDATION } from '../../shared/copy.ts';
import type { Stroke } from '../../shared/types.ts';
import { touchDocument } from '../model/document.ts';
import { signViewJson } from './signView.ts';
import {
  attemptSeal,
  lockDocument,
  recordDecline,
  recordSignature,
  remainingRequired,
  resolveLink,
} from '../model/flow.ts';
import { deliverAllOrHold } from '../model/mailer.ts';

const MAX_TEXT = 200;
const MAX_TYPED = 100;
const MAX_STROKE_POINTS = 5000;

const readStrokes = (raw: unknown[]): Stroke[] | null => {
  const strokes: Stroke[] = [];
  let points = 0;
  for (const item of raw) {
    if (!Array.isArray(item)) return null;
    const stroke: Stroke = [];
    for (const point of item) {
      if (!Array.isArray(point) || point.length !== 2) return null;
      const [x, y] = point;
      if (typeof x !== 'number' || typeof y !== 'number') return null;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      stroke.push([x, y]);
      points += 1;
    }
    if (stroke.length === 0) return null;
    strokes.push(stroke);
  }
  if (strokes.length === 0 || points > MAX_STROKE_POINTS) return null;
  return strokes;
};

export const registerSignRoutes = (app: HttpApp): void => {
  app.on('GET', '/api/sign/:token', async (ctx) => {
    const now = new Date();
    const context = await resolveLink(ctx.params['token'] ?? '', undefined, now);
    if (context === null) throw notFound();
    if (context.state === 'your_turn' && canRecipientMove(context.recipient.stored_status, 'viewed')) {
      await withTransaction(async (client) => {
        await client.query("UPDATE recipients SET status = 'viewed' WHERE id = $1", [
          context.recipient.id,
        ]);
        await appendAudit(client, {
          documentId: context.aggregate.doc.id,
          type: 'recipient.viewed',
          actor: context.recipient.email,
          recipientId: context.recipient.id,
        });
        await touchDocument(client, context.aggregate.doc.id);
      });
      const refreshed = await resolveLink(ctx.params['token'] ?? '', undefined, now);
      if (refreshed === null) throw notFound();
      sendJson(ctx.res, 200, signViewJson(refreshed, now));
      return;
    }
    sendJson(ctx.res, 200, signViewJson(context, now));
  });

  app.on('GET', '/api/sign/:token/original.pdf', async (ctx) => {
    const context = await resolveLink(ctx.params['token'] ?? '');
    if (context === null) throw notFound();
    if (context.state !== 'your_turn') throw linkClosed(context.state);
    let bytes: Buffer | null;
    try {
      bytes = await getObject(originalKey(context.aggregate.doc.id));
    } catch {
      markStorageDown();
      void recheckStorage();
      throw storageUnavailable();
    }
    if (bytes === null) throw storageUnavailable();
    sendBytes(ctx.res, 200, 'application/pdf', bytes, { 'cache-control': 'private, max-age=300' });
  });

  app.on('GET', '/sign/:token/completed.pdf', async (ctx) => {
    const context = await resolveLink(ctx.params['token'] ?? '');
    if (context === null) throw notFound();
    if (context.aggregate.doc.status !== 'completed') throw linkClosed(context.state);
    let bytes: Buffer | null;
    try {
      bytes = await getObject(completedKey(context.aggregate.doc.id));
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

  app.on('PUT', '/api/sign/:token/fields/:fieldId', async (ctx) => {
    const body = await ctx.body();
    const token = ctx.params['token'] ?? '';
    const fieldId = ctx.params['fieldId'] ?? '';
    const updated = await withTransaction(async (client) => {
      const context = await resolveLink(token, client);
      if (context === null) throw notFound();
      const field = context.aggregate.fields.find((row) => row.id === fieldId);
      if (!field || field.recipient_id !== context.recipient.id) throw notFound();
      if (context.state !== 'your_turn') throw linkClosed(context.state);
      if (field.kind === 'date') throw new ApiError(422, { error: 'read_only' });

      if (field.kind === 'text') {
        const value = readString(body, 'value');
        if (value === null) throw validation({ value: VALIDATION.value });
        if (codePoints(value) > MAX_TEXT) throw validation({ value: VALIDATION.value });
        await client.query('UPDATE fields SET value = $2, strokes = NULL WHERE id = $1', [
          field.id,
          value === '' ? null : value,
        ]);
      } else {
        const typed = readString(body, 'typed');
        const strokesRaw = readArray(body, 'strokes');
        if (typed !== null) {
          if (codePoints(typed) < 1 || codePoints(typed) > MAX_TYPED) {
            throw validation({ typed: VALIDATION.typed });
          }
          await client.query('UPDATE fields SET value = $2, strokes = NULL WHERE id = $1', [
            field.id,
            `typed:${typed}`,
          ]);
        } else if (strokesRaw !== null) {
          const strokes = readStrokes(strokesRaw);
          if (strokes === null) throw validation({ strokes: VALIDATION.strokes });
          await client.query('UPDATE fields SET value = $2, strokes = $3 WHERE id = $1', [
            field.id,
            'drawn',
            JSON.stringify(strokes),
          ]);
        } else {
          throw validation({ typed: VALIDATION.typed });
        }
      }
      await touchDocument(client, context.aggregate.doc.id);
      const after = await resolveLink(token, client);
      const row = after?.aggregate.fields.find((item) => item.id === field.id);
      if (!row) throw notFound();
      return row;
    });
    sendJson(ctx.res, 200, {
      id: updated.id,
      recipientId: updated.recipient_id,
      kind: updated.kind,
      label: updated.label,
      required: updated.required,
      page: updated.page,
      x: updated.x,
      y: updated.y,
      w: updated.w,
      h: updated.h,
      value: updated.value,
    });
  });

  app.on('POST', '/api/sign/:token/finish', async (ctx) => {
    const token = ctx.params['token'] ?? '';
    const now = new Date();
    const result = await withTransaction(async (client) => {
      const peek = await resolveLink(token, client, now);
      if (peek === null) throw notFound();
      await lockDocument(client, peek.aggregate.doc.id);
      const context = await resolveLink(token, client, now);
      if (context === null) throw notFound();
      if (context.state !== 'your_turn') throw linkClosed(context.state);
      const remaining = remainingRequired(context.aggregate, context.recipient.id);
      if (remaining > 0) {
        throw new ApiError(422, { error: 'incomplete_fields', remaining });
      }
      return recordSignature(client, context.aggregate, context.recipient, now);
    });
    await deliverAllOrHold(result.mails);
    sendJson(ctx.res, 200, { state: result.state });
    const sealDocumentId = result.sealDocumentId;
    if (sealDocumentId !== null) {
      setTimeout(() => void attemptSeal(sealDocumentId), 0);
    }
  });

  app.on('POST', '/api/sign/:token/decline', async (ctx) => {
    const token = ctx.params['token'] ?? '';
    const body = await ctx.body();
    const reason = readString(body, 'reason') ?? '';
    const now = new Date();
    const mails = await withTransaction(async (client) => {
      const peek = await resolveLink(token, client, now);
      if (peek === null) throw notFound();
      await lockDocument(client, peek.aggregate.doc.id);
      const context = await resolveLink(token, client, now);
      if (context === null) throw notFound();
      if (context.state !== 'your_turn') throw linkClosed(context.state);
      if (reason.trim() === '') throw validation({ reason: VALIDATION.reasonDeclineEmpty });
      if (codePoints(reason) > 500) throw validation({ reason: VALIDATION.reasonTooLong });
      return recordDecline(client, context.aggregate, context.recipient, reason, now);
    });
    await deliverAllOrHold(mails);
    sendJson(ctx.res, 200, { state: 'declined' });
  });
};
