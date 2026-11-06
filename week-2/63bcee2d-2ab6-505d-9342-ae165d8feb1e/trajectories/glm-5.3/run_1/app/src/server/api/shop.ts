// Shop drawings: submissions, the Hong Kong working-day review clock,
// review codes and resubmission.

import { Router } from 'express';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { one, query, withTransaction } from '../lib/db.js';
import { ApiError, forbidden, illegalTransition, notFound, storageUnavailable, FIELD_ERRORS } from '../lib/errors.js';
import { requireSession } from '../lib/auth.js';
import { scopedProject } from '../lib/scope.js';
import { checkLength, parseMultipart, throwValidation, wrap } from './helpers.js';
import { detectSheetFile, sha256Hex, svgContainsScript } from '../lib/files.js';
import { dateText, hkDateOf, hkToday, reviewDueOn } from '../lib/time.js';
import type { Config } from '../lib/config.js';
import type { Storage } from '../lib/s3.js';
import { STUDIO_ROLES } from '../lib/types.js';
import { memberSummaryOf } from './projects.js';

const FILE_LIMIT = 10_000_000;
export const CODE_LABELS: Record<number, string> = {
  1: 'Code 1 Proceed',
  2: 'Code 2 Proceed with comments',
  3: 'Code 3 Revise and resubmit',
  4: 'Code 4 Rejected',
};

interface ShopDrawingRow {
  id: string;
  project_id: string;
  reference: string;
  title: string;
}

async function shopDrawingById(id: string): Promise<ShopDrawingRow | null> {
  return one<ShopDrawingRow>('SELECT id, project_id, reference, title FROM shop_drawings WHERE id = $1', [id]);
}

async function currentSubmission(shopDrawingId: string): Promise<{
  id: string; submission: number; status: string; received_at: Date; review_due_on: string;
} | null> {
  return one(
    'SELECT id, submission, status, received_at, review_due_on FROM shop_submissions WHERE shop_drawing_id = $1 ORDER BY submission DESC LIMIT 1',
    [shopDrawingId],
  );
}

async function shopDrawingPayload(id: string): Promise<Record<string, unknown> | null> {
  const drawing = await shopDrawingById(id);
  if (!drawing) return null;
  const submission = await currentSubmission(id);
  if (!submission) return null;
  const review = await one<{ code: number; comments: string | null; by_member: string; at: Date }>(
    'SELECT code, comments, by_member, at FROM shop_reviews WHERE submission_id = $1',
    [submission.id],
  );
  const overdue = submission.status === 'received' && hkToday() > submission.review_due_on;
  return {
    id: drawing.id,
    reference: drawing.reference,
    title: drawing.title,
    submission: submission.submission,
    status: submission.status,
    receivedAt: submission.received_at.toISOString(),
    reviewDueOn: submission.review_due_on,
    overdue,
    review: review
      ? {
          code: review.code,
          comments: review.comments,
          by: await memberSummaryOf(review.by_member),
          at: review.at.toISOString(),
        }
      : null,
  };
}

export function shopDrawingsRouter(config: Config, storage: Storage): Router {
  const router = Router();
  router.use('/api', requireSession(config.timing.sessionIdleTimeout));

  router.get('/api/projects/:id/shop-drawings', wrap(async (req, res) => {
    const member = req.member!;
    const project = await scopedProject(req, req.params.id);
    if (member.role === 'client_approver') throw notFound();
    if (member.role === 'contractor' && member.companyId !== project.contractCompany) throw notFound();
    const rows = await query<{ id: string }>('SELECT id FROM shop_drawings WHERE project_id = $1 ORDER BY reference', [project.id]);
    const drawings = [];
    for (const row of rows) {
      const payload = await shopDrawingPayload(row.id);
      if (payload) drawings.push(payload);
    }
    res.json({ shopDrawings: drawings });
  }));

  router.post(
    '/api/projects/:id/shop-drawings',
    express.raw({ type: 'multipart/form-data', limit: '10100000b' }),
    wrap(async (req, res) => {
      const member = req.member!;
      const project = await scopedProject(req, req.params.id);
      const studioRoles = ['director', 'project_lead', 'designer'];
      const isContractor = member.role === 'contractor' && member.companyId === project.contractCompany;
      if (!isContractor && !studioRoles.includes(member.role)) {
        if (member.role === 'client_approver' || (member.role === 'contractor' && member.companyId !== project.contractCompany)) throw notFound();
        throw forbidden();
      }
      const parsed = parseMultipart(req.body as Buffer, req.headers['content-type'] ?? '');
      const file = parsed.files.find((f) => f.fieldName === 'file');
      const reference = parsed.fields.reference ?? '';
      const title = parsed.fields.title ?? '';
      const receivedAtRaw = parsed.fields.receivedAt ?? '';
      const errors: Record<string, string> = {};
      if (!file) errors.file = FIELD_ERRORS.required('File');
      if (file && file.data.length > FILE_LIMIT) errors.file = FIELD_ERRORS.fileTooLarge(file.fileName, FILE_LIMIT);
      if (file && file.data.length > 0) {
        const kind = detectSheetFile(file.data);
        if (!kind) errors.file = FIELD_ERRORS.unsupportedFile(file.fileName);
        else if (kind.kind === 'svg' && svgContainsScript(file.data)) errors.file = FIELD_ERRORS.svgScript(file.fileName);
      }
      if (!reference || reference.length > 20) errors.reference = FIELD_ERRORS.range('Reference', '1 and 20 characters');
      if (!title) errors.title = FIELD_ERRORS.required('Title');
      checkLength(title, 'title', 'Title', 120, errors);
      // A contractor sending receivedAt gets 422.
      let receivedAt: Date = new Date();
      if (receivedAtRaw) {
        if (!STUDIO_ROLES.includes(member.role)) {
          errors.receivedAt = FIELD_ERRORS.contractorReceivedAt;
        } else {
          const parsedDate = new Date(receivedAtRaw.endsWith('Z') ? receivedAtRaw : `${receivedAtRaw}Z`);
          if (Number.isNaN(parsedDate.getTime())) {
            errors.receivedAt = FIELD_ERRORS.receivedAtRange;
          } else if (parsedDate.getTime() < Date.parse('2026-01-01T00:00:00+08:00') || parsedDate.getTime() > Date.now()) {
            errors.receivedAt = FIELD_ERRORS.receivedAtRange;
          } else {
            receivedAt = parsedDate;
          }
        }
      }
      const existing = reference ? await one<{ id: string }>('SELECT id FROM shop_drawings WHERE project_id = $1 AND reference = $2', [project.id, reference]) : null;
      if (existing) {
        // This is a resubmission path only after Code 3/4; otherwise refused.
        const submission = await currentSubmission(existing.id);
        const review = submission ? await one<{ code: number }>('SELECT code FROM shop_reviews WHERE submission_id = $1', [submission.id]) : null;
        if (!review || (review.code !== 3 && review.code !== 4)) {
          errors.reference = 'This drawing already exists.';
        }
      }
      throwValidation(errors);
      const kind = detectSheetFile(file!.data)!;
      try {
        let drawingId = existing?.id ?? randomUUID();
        if (!existing) {
          await query('INSERT INTO shop_drawings (id, project_id, reference, title) VALUES ($1,$2,$3,$4)', [drawingId, project.id, reference, title]);
        }
        const last = await one<{ submission: number }>(
          'SELECT submission FROM shop_submissions WHERE shop_drawing_id = $1 ORDER BY submission DESC LIMIT 1',
          [drawingId],
        );
        const submissionNumber = (last?.submission ?? 0) + 1;
        const key = `projects/${project.id}/shop-drawings/${drawingId}/${submissionNumber}.${kind.ext}`;
        await storage.put(key, file!.data, kind.contentType);
        await withTransaction(async (client) => {
          await client.query(
            `INSERT INTO shop_submissions (id, shop_drawing_id, submission, received_at, review_due_on, file_bytes, sha256, content_type, file_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [randomUUID(), drawingId, submissionNumber, receivedAt, reviewDueOn(receivedAt), file!.data.length, sha256Hex(file!.data), kind.contentType, file!.fileName],
          );
        });
        res.status(201).json({ shopDrawing: await shopDrawingPayload(drawingId) });
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw storageUnavailable();
      }
    }),
  );

  router.post('/api/shop-drawings/:id/review', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (!['director', 'project_lead', 'designer'].includes(member.role)) throw forbidden();
    const drawing = await shopDrawingById(req.params.id);
    if (!drawing) throw notFound();
    const project = await scopedProject(req, drawing.project_id);
    void project;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const code = typeof body.code === 'number' ? body.code : 0;
    const comments = typeof body.comments === 'string' ? body.comments : '';
    const errors: Record<string, string> = {};
    if (![1, 2, 3, 4].includes(code)) errors.code = FIELD_ERRORS.required('Review code');
    if ([2, 3, 4].includes(code) && !comments) errors.comments = FIELD_ERRORS.commentsMissing(CODE_LABELS[code]);
    if (comments) {
      const count = [...comments].length;
      if (count > 2000) errors.comments = FIELD_ERRORS.tooLong('Comments', 2000);
    }
    throwValidation(errors);
    await withTransaction(async (client) => {
      const submission = (
        await client.query<{ id: string; status: string }>(
          'SELECT id, status FROM shop_submissions WHERE shop_drawing_id = $1 ORDER BY submission DESC LIMIT 1 FOR UPDATE',
          [drawing.id],
        )
      ).rows[0] as { id: string; status: string } | undefined;
      if (!submission) throw notFound();
      const existing = (
        await client.query<{ by_member: string; at: Date }>('SELECT by_member, at FROM shop_reviews WHERE submission_id = $1', [submission.id])
      ).rows[0] as { by_member: string; at: Date } | undefined;
      if (existing) {
        throw new ApiError(409, {
          error: 'already_reviewed',
          by: (await memberRowName(existing.by_member)) ?? 'Someone',
          at: existing.at.toISOString(),
        });
      }
      await client.query('INSERT INTO shop_reviews (id, submission_id, code, comments, by_member) VALUES ($1,$2,$3,$4,$5)', [
        randomUUID(),
        submission.id,
        code,
        comments || null,
        member.id,
      ]);
      await client.query("UPDATE shop_submissions SET status = 'returned' WHERE id = $1", [submission.id]);
    });
    res.json({ shopDrawing: await shopDrawingPayload(drawing.id) });
  }));

  router.post(
    '/api/shop-drawings/:id/resubmissions',
    express.raw({ type: 'multipart/form-data', limit: '10100000b' }),
    wrap(async (req, res) => {
      const member = req.member!;
      const drawing = await shopDrawingById(req.params.id);
      if (!drawing) throw notFound();
      const project = await scopedProject(req, drawing.project_id);
      const studioRoles = ['director', 'project_lead', 'designer'];
      const isContractor = member.role === 'contractor' && member.companyId === project.contractCompany;
      if (!isContractor && !studioRoles.includes(member.role)) {
        if (member.role === 'client_approver' || (member.role === 'contractor' && member.companyId !== project.contractCompany)) throw notFound();
        throw forbidden();
      }
      const last = await currentSubmission(drawing.id);
      if (!last) throw notFound();
      const review = await one<{ code: number }>('SELECT code FROM shop_reviews WHERE submission_id = $1', [last.id]);
      if (!review || (review.code !== 3 && review.code !== 4)) {
        throw illegalTransition(review ? `code_${review.code}_returned` : 'received', 'resubmit');
      }
      const parsed = parseMultipart(req.body as Buffer, req.headers['content-type'] ?? '');
      const file = parsed.files.find((f) => f.fieldName === 'file');
      const receivedAtRaw = parsed.fields.receivedAt ?? '';
      const errors: Record<string, string> = {};
      if (!file) errors.file = FIELD_ERRORS.required('File');
      if (file && file.data.length > FILE_LIMIT) errors.file = FIELD_ERRORS.fileTooLarge(file.fileName, FILE_LIMIT);
      if (file && file.data.length > 0) {
        const kind = detectSheetFile(file.data);
        if (!kind) errors.file = FIELD_ERRORS.unsupportedFile(file.fileName);
        else if (kind.kind === 'svg' && svgContainsScript(file.data)) errors.file = FIELD_ERRORS.svgScript(file.fileName);
      }
      let receivedAt = new Date();
      if (receivedAtRaw) {
        if (!STUDIO_ROLES.includes(member.role)) {
          errors.receivedAt = FIELD_ERRORS.contractorReceivedAt;
        } else {
          const parsedDate = new Date(receivedAtRaw.endsWith('Z') ? receivedAtRaw : `${receivedAtRaw}Z`);
          if (Number.isNaN(parsedDate.getTime()) || parsedDate.getTime() < Date.parse('2026-01-01T00:00:00+08:00') || parsedDate.getTime() > Date.now()) {
            errors.receivedAt = FIELD_ERRORS.receivedAtRange;
          } else {
            receivedAt = parsedDate;
          }
        }
      }
      throwValidation(errors);
      const kind = detectSheetFile(file!.data)!;
      try {
        const submissionNumber = last.submission + 1;
        const key = `projects/${project.id}/shop-drawings/${drawing.id}/${submissionNumber}.${kind.ext}`;
        await storage.put(key, file!.data, kind.contentType);
        await withTransaction(async (client) => {
          await client.query(
            `INSERT INTO shop_submissions (id, shop_drawing_id, submission, received_at, review_due_on, file_bytes, sha256, content_type, file_name)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [randomUUID(), drawing.id, submissionNumber, receivedAt, reviewDueOn(receivedAt), file!.data.length, sha256Hex(file!.data), kind.contentType, file!.fileName],
          );
        });
        res.status(201).json({ shopDrawing: await shopDrawingPayload(drawing.id) });
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw storageUnavailable();
      }
    }),
  );

  router.get('/api/shop-drawings/:id/submissions/:n/file', wrap(async (req, res) => {
    const drawing = await shopDrawingById(req.params.id);
    if (!drawing) throw notFound();
    const project = await scopedProject(req, drawing.project_id);
    const submission = await one<{ content_type: string; submission: number }>(
      'SELECT content_type, submission FROM shop_submissions WHERE shop_drawing_id = $1 AND submission = $2',
      [drawing.id, parseInt(req.params.n, 10)],
    );
    if (!submission) throw notFound();
    const ext = extOf(submission.content_type);
    try {
      const data = await storage.get(`projects/${project.id}/shop-drawings/${drawing.id}/${submission.submission}.${ext}`);
      res.setHeader('Content-Type', submission.content_type);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (submission.content_type === 'image/svg+xml') res.setHeader('Content-Security-Policy', 'sandbox');
      res.send(data);
    } catch {
      throw storageUnavailable();
    }
  }));

  return router;
}

async function memberRowName(id: string): Promise<string | null> {
  const row = await one<{ name: string }>('SELECT name FROM members WHERE id = $1', [id]);
  return row?.name ?? null;
}

function extOf(contentType: string): string {
  if (contentType === 'image/svg+xml') return 'svg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  return 'pdf';
}

export { dateText, hkDateOf };
