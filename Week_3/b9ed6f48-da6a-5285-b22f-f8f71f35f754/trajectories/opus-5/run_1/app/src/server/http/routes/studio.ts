import { Router } from 'express';
import { AppError } from '../../errors.js';
import { copy, STATUS_LABELS, type ItemStatus } from '../../../shared/copy.js';
import { newId, pool, query } from '../../db/index.js';
import { UPLOAD_FILE_LIMIT_BYTES } from '../../config.js';
import { body } from '../boundary.js';
import { requireCurator } from '../auth.js';
import { FieldErrors, readInteger, readStringArray, readText } from '../validate.js';
import { parseMultipart, safeFileName, signatureMatches } from '../multipart.js';
import { actorKindFor, isItemStatus, judgeTransition } from '../../../shared/lifecycle.js';
import {
  listCuratorItems,
  loadItem,
  nextSourceId,
  toCuratorItem,
  type ItemHandle,
} from '../../domain/archive.js';
import { record } from '../../domain/audit.js';
import { LEAD_CURATOR_EMAIL } from '../../seed/archive.js';
import { putObject } from '../../services/storage.js';
import * as mail from '../../services/mail.js';
import { findUserByEmail } from '../../services/pocketbase.js';

export const studioRouter = Router();

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export function readIsoInstant(value: unknown): number | null {
  if (typeof value !== 'string' || !ISO_WITH_OFFSET.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

const ALLOWED_TYPES: Record<string, string[]> = {
  narration: ['audio/mpeg', 'audio/ogg'],
  image: ['image/png', 'image/jpeg', 'image/webp'],
  scan: ['image/png', 'image/jpeg', 'application/pdf'],
};

studioRouter.use((request, _response, next) => {
  requireCurator(request);
  next();
});

studioRouter.get('/items', async (request, response) => {
  const errors = new FieldErrors();
  const typeText = request.query.type;
  let type: 'chapter' | 'event' | null = null;
  if (typeof typeText === 'string' && typeText !== '') {
    if (typeText !== 'chapter' && typeText !== 'event') errors.add('type', 'Choose chapters or events.');
    else type = typeText;
  }
  const statusText = request.query.status;
  let status: ItemStatus | null = null;
  if (typeof statusText === 'string' && statusText !== '') {
    if (!isItemStatus(statusText)) errors.add('status', 'Choose a lifecycle status.');
    else status = statusText;
  }
  errors.throwIfAny();
  response.json({ items: await listCuratorItems({ type, status }) });
});

studioRouter.post('/events', async (request, response) => {
  const user = requireCurator(request);
  const input = body(request);
  const errors = new FieldErrors();
  const chapter = readInteger(input.chapter);
  if (chapter === null || chapter < 1 || chapter > 8) errors.add('chapter', 'Choose a chapter from I to VIII.');
  const year = readInteger(input.year);
  if (year === null || year < 1600 || year > 2100) errors.add('year', 'Choose a year from 1600 to 2100.');
  const title = readText(input.title)?.trim() ?? '';
  if (title.length < 3 || title.length > 120) errors.add('title', copy.titleLength);
  const summary = readText(input.summary)?.trim() ?? '';
  if (summary.length < 10 || summary.length > 600) errors.add('summary', 'Give a summary of 10 to 600 characters.');
  const sourceIds = input.source_ids === undefined ? [] : readStringArray(input.source_ids);
  if (sourceIds === null || sourceIds.length > 5) errors.add('source_ids', 'Cite up to five sources.');
  else {
    const known = await query<{ id: string }>('SELECT id FROM sources WHERE id = ANY($1::text[])', [sourceIds]);
    if (known.length !== new Set(sourceIds).size) errors.add('source_ids', 'Cite up to five existing sources.');
  }
  errors.throwIfAny();
  const id = newId('ev');
  await pool.query(
    `INSERT INTO timeline_events (id, chapter, year, title, summary, source_ids, status, owner_email)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'draft', $7)`,
    [id, chapter, year, title, summary, JSON.stringify(sourceIds), user.email],
  );
  await record({ actorEmail: user.email, action: 'item_created', targetType: 'event', targetId: id });
  const handle = (await loadItem(id)) as ItemHandle;
  response.status(201).json({ item: toCuratorItem(handle) });
});

studioRouter.patch('/items/:id', async (request, response) => {
  const user = requireCurator(request);
  const handle = await loadItem(request.params.id as string);
  if (!handle) throw new AppError('not_found');
  if (actorKindFor(user.role, handle.ownerEmail, user.email) === 'other') throw new AppError('forbidden');
  if (handle.status !== 'draft') throw new AppError('not_editable');
  const input = body(request);
  const errors = new FieldErrors();
  const changes: Record<string, string | number> = {};
  if (handle.type === 'chapter') {
    if (input.title !== undefined) {
      const title = readText(input.title)?.trim() ?? '';
      if (title.length < 3 || title.length > 120) errors.add('title', copy.titleLength);
      else changes.title = title;
    }
    if (input.era !== undefined) {
      const era = readText(input.era)?.trim() ?? '';
      if (era.length < 3 || era.length > 60) errors.add('era', 'Give an era of 3 to 60 characters.');
      else changes.era = era;
    }
    if (input.body !== undefined) {
      const text = readText(input.body)?.trim() ?? '';
      if (text.length < 10) errors.add('body', 'Give a body of at least 10 characters.');
      else changes.body = text;
    }
    if (input.sightline_deg !== undefined) {
      const degrees = readInteger(input.sightline_deg);
      if (degrees === null || degrees < -60 || degrees > 60 || degrees % 3 !== 0) {
        errors.add('sightline_deg', 'Choose a multiple of 3 from -60 to 60.');
      } else changes.sightline_deg = degrees;
    }
    errors.throwIfAny();
    for (const [column, value] of Object.entries(changes)) {
      await pool.query(`UPDATE archive_chapters SET ${column} = $2 WHERE number = $1`, [handle.chapter, value]);
    }
  } else {
    if (input.chapter !== undefined) {
      const chapter = readInteger(input.chapter);
      if (chapter === null || chapter < 1 || chapter > 8) errors.add('chapter', 'Choose a chapter from I to VIII.');
      else changes.chapter = chapter;
    }
    if (input.year !== undefined) {
      const year = readInteger(input.year);
      if (year === null || year < 1600 || year > 2100) errors.add('year', 'Choose a year from 1600 to 2100.');
      else changes.year = year;
    }
    if (input.title !== undefined) {
      const title = readText(input.title)?.trim() ?? '';
      if (title.length < 3 || title.length > 120) errors.add('title', copy.titleLength);
      else changes.title = title;
    }
    if (input.summary !== undefined) {
      const summary = readText(input.summary)?.trim() ?? '';
      if (summary.length < 10 || summary.length > 600) {
        errors.add('summary', 'Give a summary of 10 to 600 characters.');
      } else changes.summary = summary;
    }
    errors.throwIfAny();
    for (const [column, value] of Object.entries(changes)) {
      await pool.query(`UPDATE timeline_events SET ${column} = $2 WHERE id = $1`, [handle.id, value]);
    }
  }
  await record({
    actorEmail: user.email,
    action: 'item_edited',
    targetType: handle.type,
    targetId: handle.id,
    detail: { fields: Object.keys(changes) },
  });
  const updated = (await loadItem(handle.id)) as ItemHandle;
  response.json({ item: toCuratorItem(updated) });
});

async function applyStatus(
  handle: ItemHandle,
  to: ItemStatus,
  publishAt: Date | null,
  reason: string | null,
): Promise<boolean> {
  const rows =
    handle.type === 'chapter'
      ? await query<{ number: number }>(
          `UPDATE archive_chapters SET status = $3, publish_at = $4, withdraw_reason = $5
           WHERE number = $1 AND status = $2 RETURNING number`,
          [handle.chapter, handle.status, to, publishAt, reason],
        )
      : await query<{ id: string }>(
          `UPDATE timeline_events SET status = $3, publish_at = $4, withdraw_reason = $5
           WHERE id = $1 AND status = $2 RETURNING id`,
          [handle.id, handle.status, to, publishAt, reason],
        );
  return rows.length > 0;
}

studioRouter.post('/items/:id/transitions', async (request, response) => {
  const user = requireCurator(request);
  const handle = await loadItem(request.params.id as string);
  if (!handle) throw new AppError('not_found');
  const input = body(request);
  const to = readText(input.to);
  if (!isItemStatus(to)) {
    throw new AppError('illegal_transition', { context: { statusLabel: STATUS_LABELS[handle.status] } });
  }
  const actor = actorKindFor(user.role, handle.ownerEmail, user.email);
  const verdict = judgeTransition(handle.status, to, actor);
  if (verdict.kind === 'lead_only') throw new AppError('lead_only');
  if (verdict.kind === 'forbidden') throw new AppError('forbidden');
  if (verdict.kind === 'illegal') {
    throw new AppError('illegal_transition', { context: { statusLabel: STATUS_LABELS[handle.status] } });
  }

  const errors = new FieldErrors();
  let publishAt: Date | null = null;
  if (verdict.rule.needsPublishAt) {
    const instant = readIsoInstant(input.publish_at);
    if (instant === null) errors.add('publish_at', copy.timeAfterNow);
    else if (instant <= Date.now()) errors.add('publish_at', copy.timeAfterNow);
    else publishAt = new Date(instant);
  }
  let reason: string | null = null;
  if (verdict.rule.needsReason) {
    const text = readText(input.reason)?.trim() ?? '';
    if (text.length < 3 || text.length > 500) errors.add('reason', copy.reasonLength);
    else reason = text;
  }
  errors.throwIfAny();

  const applied = await applyStatus(handle, to, publishAt, reason);
  if (!applied) {
    const latest = await loadItem(handle.id);
    throw new AppError('illegal_transition', {
      context: { statusLabel: STATUS_LABELS[latest?.status ?? handle.status] },
    });
  }
  await record({
    actorEmail: user.email,
    action: 'transition',
    targetType: handle.type,
    targetId: handle.id,
    detail: { from: handle.status, to, ...(reason ? { reason } : {}) },
  });

  if (to === 'review') {
    const lead = await findUserByEmail(LEAD_CURATOR_EMAIL).catch(() => null);
    await mail.send(
      mail.reviewNoticeMessage({
        recipientEmail: LEAD_CURATOR_EMAIL,
        recipientName: lead?.name ?? 'Lead curator',
        itemTitle: handle.title,
      }),
    );
  }
  if (to === 'withdrawn') {
    const owner = await findUserByEmail(handle.ownerEmail).catch(() => null);
    await mail.send(
      mail.withdrawalNoticeMessage({
        recipientEmail: handle.ownerEmail,
        recipientName: owner?.name ?? 'Curator',
        itemTitle: handle.title,
        reason: reason ?? '',
      }),
    );
  }

  const updated = (await loadItem(handle.id)) as ItemHandle;
  response.json({ item: toCuratorItem(updated) });
});

studioRouter.post('/sources', async (request, response) => {
  const user = requireCurator(request);
  const citation = readText(body(request).citation)?.trim() ?? '';
  const errors = new FieldErrors();
  if (citation.length < 5 || citation.length > 300) errors.add('citation', 'Give a citation of 5 to 300 characters.');
  errors.throwIfAny();
  const { id, ordinal } = await nextSourceId();
  await pool.query('INSERT INTO sources (id, ordinal, citation) VALUES ($1, $2, $3)', [id, ordinal, citation]);
  await record({ actorEmail: user.email, action: 'source_created', targetType: 'source', targetId: id });
  response.status(201).json({ source: { id, citation, cited_by: [] } });
});

studioRouter.post('/media', async (request, response) => {
  const user = requireCurator(request);
  const form = parseMultipart(
    request.parsedBody?.raw ?? Buffer.alloc(0),
    request.headers['content-type'] ?? '',
  );
  if (!form) throw new AppError('unsupported_media_type');
  const itemId = form.fields.get('item_id') ?? '';
  const handle = await loadItem(itemId);
  if (!handle) throw new AppError('not_found');

  const errors = new FieldErrors();
  const kind = form.fields.get('kind') ?? '';
  const allowed = ALLOWED_TYPES[kind];
  if (!allowed) errors.add('kind', 'Choose narration, image or scan.');
  const file = form.files.get('file');
  const transcript = form.fields.get('transcript') ?? '';
  if (!file || file.content.length === 0) errors.add('file', copy.uploadType);
  else if (file.content.length > UPLOAD_FILE_LIMIT_BYTES) errors.add('file', copy.uploadSize);
  else if (allowed && (!allowed.includes(file.contentType) || !signatureMatches(file.contentType, file.content))) {
    errors.add('file', copy.uploadType);
  }
  if (kind === 'narration' && transcript.trim().length === 0) errors.add('transcript', copy.transcriptRequired);
  errors.throwIfAny();

  const upload = file as NonNullable<typeof file>;
  const id = newId('media');
  const filename = safeFileName(upload.fileName);
  const objectKey = `media/${id}/${filename}`;
  try {
    await putObject(objectKey, upload.content, upload.contentType);
  } catch (error) {
    if (error instanceof AppError && error.code === 'storage_unavailable') {
      throw new AppError('storage_unavailable', { context: { storageContext: 'upload' } });
    }
    throw error;
  }
  const ordinal = (
    await query<{ count: string }>('SELECT COUNT(*)::text AS count FROM media WHERE item_id = $1 AND kind = $2', [
      handle.id,
      kind,
    ])
  )[0];
  await pool.query(
    `INSERT INTO media (id, kind, item_type, item_id, filename, bytes, content_type, object_key, transcript, ordinal)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      kind,
      handle.type,
      handle.id,
      filename,
      upload.content.length,
      upload.contentType,
      objectKey,
      kind === 'narration' ? transcript : null,
      Number(ordinal?.count ?? '0'),
    ],
  );
  await record({
    actorEmail: user.email,
    action: 'media_uploaded',
    targetType: handle.type,
    targetId: handle.id,
    detail: { media_id: id, kind },
  });
  response.status(201).json({
    media: {
      id,
      kind,
      item_id: handle.id,
      filename,
      bytes: upload.content.length,
      content_type: upload.contentType,
      key: objectKey,
    },
  });
});
