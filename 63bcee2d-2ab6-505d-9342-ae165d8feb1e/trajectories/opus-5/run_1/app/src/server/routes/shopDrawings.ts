import {
  HK_ZONE,
  REVIEW_CODE_LABELS,
  type ReviewCode,
  type ShopDrawingStatus,
} from '../../shared/domain.js';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { dateInZone } from '../../shared/zoned.js';
import { newId } from '../db/ids.js';
import { firstRow, pool, rows, transact, type Queryable } from '../db/pool.js';
import {
  contractorHoldsContract,
  requireProject,
  requireUuid,
  type ProjectRecord,
} from '../domain/access.js';
import { isOverdue, reviewDueOn } from '../domain/reviewClock.js';
import { resubmissionAllowed } from '../domain/transitions.js';
import { Fields } from '../domain/validate.js';
import { jsonReply, type Reply } from '../http/context.js';
import { conflict, forbidden, illegalTransition, notFound, validation } from '../http/errors.js';
import type { Router } from '../http/router.js';
import type { Member } from '../http/session.js';
import { CONTENT_TYPES, EXTENSIONS } from '../services/files.js';
import { getObject, putObject } from '../services/storage.js';
import { acceptedFile, fileHeaders } from './sheets.js';

const CLOCK_RANGE_START = new Date('2025-12-31T16:00:00.000Z');

interface SubmissionRow {
  id: string;
  shop_drawing_id: string;
  submission: number;
  received_at: string;
  review_due_on: string;
  storage_key: string;
  content_type: string;
  code: ReviewCode | null;
  comments: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
}

const SUBMISSION_SELECT = `
  SELECT s.id, s.shop_drawing_id, s.submission, s.received_at, s.review_due_on, s.storage_key,
         s.content_type, s.code, s.comments, m.name AS reviewed_by_name, s.reviewed_at
    FROM shop_drawing_submissions s LEFT JOIN members m ON m.id = s.reviewed_by`;

async function latestSubmission(
  client: Queryable,
  shopDrawingId: string,
): Promise<SubmissionRow> {
  const row = await firstRow<SubmissionRow>(
    client,
    `${SUBMISSION_SELECT} WHERE s.shop_drawing_id = $1 ORDER BY s.submission DESC LIMIT 1`,
    [shopDrawingId],
  );
  if (!row) throw notFound();
  return row;
}

async function shopDrawingPayload(
  client: Queryable,
  row: { id: string; reference: string; title: string },
): Promise<unknown> {
  const latest = await latestSubmission(client, row.id);
  const status: ShopDrawingStatus = latest.code === null ? 'received' : 'returned';
  return {
    id: row.id,
    reference: row.reference,
    title: row.title,
    submission: latest.submission,
    status,
    receivedAt: new Date(latest.received_at).toISOString(),
    reviewDueOn: latest.review_due_on,
    overdue: status === 'received' && isOverdue(latest.review_due_on, dateInZone(new Date(), HK_ZONE)),
    review:
      latest.code === null
        ? null
        : {
            code: latest.code,
            comments: latest.comments ?? '',
            by: latest.reviewed_by_name,
            at: latest.reviewed_at ? new Date(latest.reviewed_at).toISOString() : null,
          },
  };
}

async function shopDrawingScope(member: Member, projectId: string): Promise<ProjectRecord> {
  const project = await requireProject(pool, projectId, member);
  if (member.role === 'contractor' && !(await contractorHoldsContract(pool, project.id, member))) {
    throw notFound();
  }
  return project;
}

/** The server instant, or an earlier time a studio role logged. */
function readReceivedAt(member: Member, value: string | undefined, now: Date): Date {
  if (value === undefined || value === '') return now;
  if (member.role === 'contractor') {
    throw validation({ receivedAt: fieldErrorCopy.contractorReceivedAt() });
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw validation({ receivedAt: fieldErrorCopy.receivedAtOutOfRange() });
  }
  if (parsed.getTime() < CLOCK_RANGE_START.getTime() || parsed.getTime() > now.getTime()) {
    throw validation({ receivedAt: fieldErrorCopy.receivedAtOutOfRange() });
  }
  return parsed;
}

function mayReview(member: Member): void {
  if (!['director', 'project_lead', 'designer'].includes(member.role)) throw forbidden();
}

function maySubmit(member: Member): void {
  if (!['director', 'project_lead', 'designer', 'contractor'].includes(member.role)) {
    throw forbidden();
  }
}

export function registerShopDrawingRoutes(router: Router): void {
  router.get('/api/projects/:id/shop-drawings', async (context): Promise<Reply> => {
    const member = await context.member();
    const project = await shopDrawingScope(member, context.param('id'));
    const found = await rows<{ id: string; reference: string; title: string }>(
      pool,
      'SELECT id, reference, title FROM shop_drawings WHERE project_id = $1 ORDER BY reference',
      [project.id],
    );
    return jsonReply(200, {
      shopDrawings: await Promise.all(found.map((row) => shopDrawingPayload(pool, row))),
    });
  });

  router.post('/api/projects/:id/shop-drawings', async (context): Promise<Reply> => {
    const member = await context.member();
    const project = await shopDrawingScope(member, context.param('id'));
    maySubmit(member);
    const form = await context.multipart();
    const now = new Date();

    const fields = new Fields();
    const reference = fields.text('reference', form.fields.reference, {
      label: 'Reference',
      max: 20,
      oneLine: true,
    });
    const title = fields.text('title', form.fields.title, {
      label: 'Title',
      max: 120,
      oneLine: true,
    });
    fields.finish();

    const receivedAt = readReceivedAt(member, form.fields.receivedAt, now);
    const upload = form.files.find((file) => file.field === 'file');
    if (!upload) throw validation({ file: fieldErrorCopy.required('Drawing file') });
    const accepted = acceptedFile(upload.fileName, upload.bytes);

    const shopDrawingId = newId();
    const storageKey = `projects/${project.id}/shop-drawings/${shopDrawingId}/1.${
      EXTENSIONS[accepted.kind]
    }`;
    await putObject(storageKey, upload.bytes, CONTENT_TYPES[accepted.kind]);

    await transact(async (client) => {
      await client.query(
        'INSERT INTO shop_drawings (id, project_id, reference, title) VALUES ($1, $2, $3, $4)',
        [shopDrawingId, project.id, reference, title],
      );
      await client.query(
        `INSERT INTO shop_drawing_submissions (id, shop_drawing_id, submission, received_at,
                                               review_due_on, storage_key, bytes, content_type,
                                               original_name)
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8)`,
        [
          newId(),
          shopDrawingId,
          receivedAt,
          reviewDueOn(receivedAt),
          storageKey,
          upload.bytes.byteLength,
          CONTENT_TYPES[accepted.kind],
          accepted.displayName,
        ],
      );
    });

    return jsonReply(201, {
      shopDrawing: await shopDrawingPayload(pool, {
        id: shopDrawingId,
        reference,
        title,
      }),
    });
  });

  router.post('/api/shop-drawings/:id/review', async (context): Promise<Reply> => {
    const member = await context.member();
    const drawing = await loadDrawing(member, context.param('id'));
    mayReview(member);
    const latest = await latestSubmission(pool, drawing.id);
    if (latest.code !== null) {
      throw conflict('already_reviewed', {
        by: latest.reviewed_by_name ?? '',
        at: latest.reviewed_at ? new Date(latest.reviewed_at).toISOString() : '',
      });
    }

    const body = await context.json();
    const fields = new Fields();
    const code = fields.integer('code', body.code, 'Review code', 1, 4) as ReviewCode;
    const comments = fields.text('comments', body.comments ?? '', {
      label: 'Comments',
      min: 0,
      max: 2000,
    });
    if (code >= 2 && comments.trim() === '') {
      fields.add('comments', fieldErrorCopy.commentsMissing(REVIEW_CODE_LABELS[code]));
    }
    fields.finish();

    const claimed = await rows(
      pool,
      `UPDATE shop_drawing_submissions
          SET code = $2, comments = $3, reviewed_by = $4, reviewed_at = now()
        WHERE id = $1 AND code IS NULL RETURNING id`,
      [latest.id, code, comments, member.id],
    );
    if (claimed.length === 0) {
      const after = await latestSubmission(pool, drawing.id);
      throw conflict('already_reviewed', {
        by: after.reviewed_by_name ?? '',
        at: after.reviewed_at ? new Date(after.reviewed_at).toISOString() : '',
      });
    }

    return jsonReply(200, { shopDrawing: await shopDrawingPayload(pool, drawing) });
  });

  router.post('/api/shop-drawings/:id/resubmissions', async (context): Promise<Reply> => {
    const member = await context.member();
    const drawing = await loadDrawing(member, context.param('id'));
    maySubmit(member);
    const latest = await latestSubmission(pool, drawing.id);
    if (!resubmissionAllowed(latest.code)) {
      throw illegalTransition(latest.code === null ? 'received' : `code_${latest.code}`, 'resubmit');
    }

    const form = await context.multipart();
    const now = new Date();
    const receivedAt = readReceivedAt(member, form.fields.receivedAt, now);
    const upload = form.files.find((file) => file.field === 'file');
    if (!upload) throw validation({ file: fieldErrorCopy.required('Drawing file') });
    const accepted = acceptedFile(upload.fileName, upload.bytes);

    const submission = latest.submission + 1;
    const storageKey = `projects/${drawing.project_id}/shop-drawings/${drawing.id}/${submission}.${
      EXTENSIONS[accepted.kind]
    }`;
    await putObject(storageKey, upload.bytes, CONTENT_TYPES[accepted.kind]);

    await pool.query(
      `INSERT INTO shop_drawing_submissions (id, shop_drawing_id, submission, received_at,
                                             review_due_on, storage_key, bytes, content_type,
                                             original_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        newId(),
        drawing.id,
        submission,
        receivedAt,
        reviewDueOn(receivedAt),
        storageKey,
        upload.bytes.byteLength,
        CONTENT_TYPES[accepted.kind],
        accepted.displayName,
      ],
    );

    return jsonReply(201, { shopDrawing: await shopDrawingPayload(pool, drawing) });
  });

  router.get('/api/shop-drawings/:id/submissions/:n/file', async (context): Promise<Reply> => {
    const member = await context.member();
    const drawing = await loadDrawing(member, context.param('id'));
    const submission = await firstRow<SubmissionRow>(
      pool,
      `${SUBMISSION_SELECT} WHERE s.shop_drawing_id = $1 AND s.submission = $2`,
      [drawing.id, Number(context.param('n'))],
    );
    if (!submission) throw notFound();
    const bytes = await getObject(submission.storage_key);
    return {
      status: 200,
      bytes,
      contentType: submission.content_type,
      headers: fileHeaders(submission.content_type),
    };
  });
}

async function loadDrawing(
  member: Member,
  shopDrawingId: string,
): Promise<{ id: string; project_id: string; reference: string; title: string }> {
  const row = await firstRow<{
    id: string;
    project_id: string;
    reference: string;
    title: string;
  }>(pool, 'SELECT id, project_id, reference, title FROM shop_drawings WHERE id = $1', [
    requireUuid(shopDrawingId),
  ]);
  if (!row) throw notFound();
  await shopDrawingScope(member, row.project_id);
  return row;
}

