import { randomUUID } from 'node:crypto';
import { requireCaller } from '../auth.ts';
import { withTransaction } from '../db/pool.ts';
import { notFound, validation } from '../http/errors.ts';
import { codePoints, readBoolean, readNumber, readString } from '../http/read.ts';
import { sendEmpty, sendJson, type HttpApp } from '../http/server.ts';
import { DEFAULT_SIZE, isBoxValid, round4 } from '../../shared/geometry.ts';
import { defaultLabel } from '../../shared/fields.ts';
import { VALIDATION } from '../../shared/copy.ts';
import type { FieldKind } from '../../shared/types.ts';
import { fieldJson, loadAggregate, touchDocument } from '../model/document.ts';
import { loadForCaller, requireCapability, requireDraft, requireRecipient } from './access.ts';

const isKind = (value: string | null): value is FieldKind =>
  value === 'signature' || value === 'initials' || value === 'date' || value === 'text';

export const registerFieldRoutes = (app: HttpApp): void => {
  app.on('POST', '/api/documents/:id/fields', async (ctx) => {
    const caller = await requireCaller(ctx);
    const aggregate = await loadForCaller(ctx, caller);
    const body = await ctx.body();
    const recipientId = readString(body, 'recipientId') ?? '';
    requireRecipient(aggregate, recipientId);
    requireCapability(caller, aggregate, 'editOwnDraft');
    requireDraft(aggregate);

    const kindRaw = readString(body, 'kind');
    const errors: Record<string, string> = {};
    if (!isKind(kindRaw)) errors['kind'] = VALIDATION.kind;
    const page = readNumber(body, 'page') ?? 0;
    const box = {
      x: round4(readNumber(body, 'x') ?? -1),
      y: round4(readNumber(body, 'y') ?? -1),
      w: round4(readNumber(body, 'w') ?? (isKind(kindRaw) ? DEFAULT_SIZE[kindRaw].w : 0)),
      h: round4(readNumber(body, 'h') ?? (isKind(kindRaw) ? DEFAULT_SIZE[kindRaw].h : 0)),
    };
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > aggregate.doc.page_count ||
      !isBoxValid(box)
    ) {
      errors['geometry'] = VALIDATION.geometry;
    }
    const labelRaw = readString(body, 'label');
    const kindCount = isKind(kindRaw)
      ? aggregate.fields.filter((field) => field.kind === kindRaw).length + 1
      : 1;
    const label =
      labelRaw === null && isKind(kindRaw) ? defaultLabel(kindRaw, kindCount) : (labelRaw ?? '');
    if (codePoints(label) < 1 || codePoints(label) > 40) errors['label'] = VALIDATION.label;
    if (Object.keys(errors).length > 0) throw validation(errors);
    if (!isKind(kindRaw)) throw validation({ kind: VALIDATION.kind });

    const required = readBoolean(body, 'required') ?? true;
    const created = await withTransaction(async (client) => {
      const id = randomUUID();
      await client.query(
        `INSERT INTO fields (id, document_id, recipient_id, kind, label, required, page, x, y, w, h)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [id, aggregate.doc.id, recipientId, kindRaw, label, required, page, box.x, box.y, box.w, box.h],
      );
      await touchDocument(client, aggregate.doc.id);
      const loaded = await loadAggregate(aggregate.doc.id, caller.teamId, client);
      const row = loaded?.fields.find((field) => field.id === id);
      if (!row) throw notFound();
      return row;
    });
    sendJson(ctx.res, 201, fieldJson(created));
  });

  app.on('PATCH', '/api/documents/:id/fields/:fieldId', async (ctx) => {
    const caller = await requireCaller(ctx);
    const aggregate = await loadForCaller(ctx, caller);
    const field = aggregate.fields.find((row) => row.id === (ctx.params['fieldId'] ?? ''));
    if (!field) throw notFound();
    const body = await ctx.body();
    const recipientId = readString(body, 'recipientId');
    if (recipientId !== null) requireRecipient(aggregate, recipientId);
    requireCapability(caller, aggregate, 'editOwnDraft');
    requireDraft(aggregate);

    const errors: Record<string, string> = {};
    const page = readNumber(body, 'page') ?? field.page;
    const box = {
      x: round4(readNumber(body, 'x') ?? field.x),
      y: round4(readNumber(body, 'y') ?? field.y),
      w: round4(readNumber(body, 'w') ?? field.w),
      h: round4(readNumber(body, 'h') ?? field.h),
    };
    if (
      !Number.isInteger(page) ||
      page < 1 ||
      page > aggregate.doc.page_count ||
      !isBoxValid(box)
    ) {
      errors['geometry'] = VALIDATION.geometry;
    }
    const label = readString(body, 'label') ?? field.label;
    if (codePoints(label) < 1 || codePoints(label) > 40) errors['label'] = VALIDATION.label;
    if (Object.keys(errors).length > 0) throw validation(errors);
    const required = readBoolean(body, 'required') ?? field.required;

    const updated = await withTransaction(async (client) => {
      await client.query(
        `UPDATE fields SET recipient_id = $2, page = $3, x = $4, y = $5, w = $6, h = $7,
                required = $8, label = $9 WHERE id = $1`,
        [
          field.id,
          recipientId ?? field.recipient_id,
          page,
          box.x,
          box.y,
          box.w,
          box.h,
          required,
          label,
        ],
      );
      await touchDocument(client, aggregate.doc.id);
      const loaded = await loadAggregate(aggregate.doc.id, caller.teamId, client);
      const row = loaded?.fields.find((item) => item.id === field.id);
      if (!row) throw notFound();
      return row;
    });
    sendJson(ctx.res, 200, fieldJson(updated));
  });

  app.on('DELETE', '/api/documents/:id/fields/:fieldId', async (ctx) => {
    const caller = await requireCaller(ctx);
    const aggregate = await loadForCaller(ctx, caller);
    const field = aggregate.fields.find((row) => row.id === (ctx.params['fieldId'] ?? ''));
    if (!field) throw notFound();
    requireCapability(caller, aggregate, 'editOwnDraft');
    requireDraft(aggregate);
    await withTransaction(async (client) => {
      await client.query('DELETE FROM fields WHERE id = $1', [field.id]);
      await touchDocument(client, aggregate.doc.id);
    });
    sendEmpty(ctx.res, 204);
  });

};
