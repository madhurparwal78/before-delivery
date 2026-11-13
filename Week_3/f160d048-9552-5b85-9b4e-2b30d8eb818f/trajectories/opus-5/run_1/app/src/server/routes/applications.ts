import type { Stage } from '../../shared/reference';
import { config } from '../config';
import { db, transaction } from '../db/pool';
import { COPY, emailValue, FieldErrors, phoneValue, textBetween } from '../domain/validate';
import { assertPdf, chargeUploadRate, dateOnly, requestFingerprint, withApplyLock } from '../domain/uploads';
import { ApiError } from '../errors';
import type { Context } from '../http/context';
import { HANDLED, type Router } from '../http/router';
import { sendJson } from '../http/respond';
import { uuid } from '../ids';
import { getObject, putAndConfirm, removeObject, resumeKey, StorageUnavailable } from '../services/storage';
import { findJob } from './jobs';

export interface ApplicationRow {
  id: string;
  job_id: string;
  user_id: string;
  candidate_name: string;
  contact_email: string;
  phone: string;
  cover_note: string;
  stage: Stage;
  resume_file_id: string;
  applied_at: Date;
  updated_at: Date;
  company_id: string;
  job_title: string;
  company_name: string;
}

export const APPLICATION_COLUMNS = `a.id, a.job_id, a.user_id, a.candidate_name, a.contact_email, a.phone,
  a.cover_note, a.stage, a.resume_file_id, a.applied_at, a.updated_at, j.company_id, j.title AS job_title,
  c.name AS company_name`;

export const APPLICATION_FROM = `FROM applications a
  JOIN jobs j ON j.id = a.job_id
  JOIN companies c ON c.id = j.company_id`;

/** Only what the candidate typed, plus the stage and dates. */
export function applicantBody(row: ApplicationRow): Record<string, unknown> {
  return {
    id: row.id,
    job_id: row.job_id,
    candidate_name: row.candidate_name,
    contact_email: row.contact_email,
    phone: row.phone,
    cover_note: row.cover_note,
    stage: row.stage,
    applied_on: dateOnly(row.applied_at),
    updated_on: dateOnly(row.updated_at),
    resume_file_id: row.resume_file_id,
  };
}

export async function findApplication(id: string): Promise<ApplicationRow | null> {
  return db.one<ApplicationRow>(`SELECT ${APPLICATION_COLUMNS} ${APPLICATION_FROM} WHERE a.id = $1`, [id]);
}

export function registerApplicationRoutes(router: Router): void {
  router.post(
    '/api/jobs/:id/applications',
    async (ctx: Context) => {
      const body = ctx.multipart();
      const job = await findJob(ctx.param('id'));
      if (!job || job.status === 'draft') throw new ApiError('not_found');
      const member = ctx.requireRole('member');
      const now = await ctx.now();
      await chargeUploadRate(member.id, now);

      const key = ctx.header('idempotency-key') ?? '';
      const resume = body.files['resume'];
      const fingerprint = requestFingerprint(
        [
          body.fields['candidate_name'] ?? '',
          body.fields['contact_email'] ?? '',
          body.fields['phone'] ?? '',
          body.fields['cover_note'] ?? '',
        ],
        resume?.bytes ?? Buffer.alloc(0),
      );

      const created = await withApplyLock(member.id, job.id, async () => {
        if (key !== '') {
          const stored = await db.one<{ request_hash: string; response: Record<string, unknown> }>(
            'SELECT request_hash, response FROM apply_keys WHERE key = $1 AND user_id = $2 AND created_at > $3',
            [key, member.id, new Date(now.getTime() - config.applyKeyTtlSeconds * 1000)],
          );
          if (stored) {
            if (stored.request_hash === fingerprint) return stored.response;
            throw new ApiError('idempotency_mismatch');
          }
        }
        if (job.status === 'closed') throw new ApiError('job_closed');
        const existing = await db.one<{ id: string }>(
          'SELECT id FROM applications WHERE job_id = $1 AND user_id = $2',
          [job.id, member.id],
        );
        if (existing) throw new ApiError('duplicate_application');

        const errors = new FieldErrors();
        const candidateName = textBetween(body.fields['candidate_name'], 2, 100);
        const contactEmail = emailValue(body.fields['contact_email']);
        const phone = phoneValue(body.fields['phone']);
        const coverNote = textBetween(body.fields['cover_note'] ?? '', 0, 2000);
        if (!candidateName) errors.add('candidate_name', COPY.candidate_name);
        if (!contactEmail) errors.add('contact_email', COPY.email);
        if (phone === null) errors.add('phone', COPY.phone);
        if (coverNote === null) errors.add('cover_note', COPY.cover_note);
        if (!resume) errors.add('resume', COPY.resume);
        if (key === '') errors.add('idempotency_key', COPY.idempotency_key);
        errors.throwIfAny();
        assertPdf((resume as { bytes: Buffer }).bytes);

        const fileId = uuid();
        const storageKey = resumeKey(fileId);
        try {
          await putAndConfirm(storageKey, (resume as { bytes: Buffer }).bytes, 'application/pdf');
        } catch (error) {
          if (error instanceof StorageUnavailable) throw new ApiError('storage_unavailable');
          throw error;
        }

        try {
          return await transaction(async (tx) => {
            const applicationId = uuid();
            await tx.query(
              `INSERT INTO stored_files (id, kind, storage_key, content_type, byte_size, created_at)
             VALUES ($1, 'resume', $2, 'application/pdf', $3, $4)`,
              [fileId, storageKey, (resume as { bytes: Buffer }).bytes.length, now],
            );
            await tx.query(
              `INSERT INTO applications (id, job_id, user_id, candidate_name, contact_email, phone, cover_note,
                                       stage, resume_file_id, applied_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted', $8, $9, $9)`,
              [
                applicationId,
                job.id,
                member.id,
                candidateName,
                contactEmail,
                phone ?? '',
                coverNote ?? '',
                fileId,
                now,
              ],
            );
            await tx.query(`INSERT INTO application_stages (application_id, stage, at) VALUES ($1, 'submitted', $2)`, [
              applicationId,
              now,
            ]);
            const response = {
              id: applicationId,
              job_id: job.id,
              stage: 'submitted',
              resume_file_id: fileId,
              applied_on: dateOnly(now),
            };
            await tx.query(
              `INSERT INTO apply_keys (key, user_id, job_id, request_hash, response, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
              [key, member.id, job.id, fingerprint, JSON.stringify(response), now],
            );
            return response as Record<string, unknown>;
          });
        } catch (error) {
          await removeObject(storageKey);
          throw error;
        }
      });

      sendJson(ctx.res, 201, created);
      return HANDLED;
    },
    'multipart',
  );

  router.get('/api/me/applications', async (ctx: Context) => {
    const member = ctx.requireRole('member');
    const rows = await db.query<ApplicationRow>(
      `SELECT ${APPLICATION_COLUMNS} ${APPLICATION_FROM} WHERE a.user_id = $1 ORDER BY a.applied_at DESC, a.id`,
      [member.id],
    );
    return {
      applications: rows.map((row) => ({
        id: row.id,
        job_id: row.job_id,
        job_title: row.job_title,
        company_name: row.company_name,
        stage: row.stage,
        applied_on: dateOnly(row.applied_at),
        updated_on: dateOnly(row.updated_at),
      })),
    };
  });

  router.get('/api/applications/:id', async (ctx: Context) => {
    const member = ctx.requireRole('member');
    const row = await findApplication(ctx.param('id'));
    if (!row || row.user_id !== member.id) throw new ApiError('not_found');
    return {
      id: row.id,
      job_id: row.job_id,
      job_title: row.job_title,
      company_name: row.company_name,
      stage: row.stage,
      applied_on: dateOnly(row.applied_at),
      updated_on: dateOnly(row.updated_at),
      candidate_name: row.candidate_name,
      contact_email: row.contact_email,
      phone: row.phone,
      cover_note: row.cover_note,
      resume_file_id: row.resume_file_id,
    };
  });

  router.get('/api/files/:id', async (ctx: Context) => {
    const file = await db.one<{
      id: string;
      kind: string;
      storage_key: string;
      content_type: string;
      company_id: string | null;
    }>('SELECT id, kind, storage_key, content_type, company_id FROM stored_files WHERE id = $1', [ctx.param('id')]);
    if (!file) throw new ApiError('not_found');

    if (file.kind === 'resume') {
      const application = await db.one<{ user_id: string; company_id: string }>(
        `SELECT a.user_id, j.company_id FROM applications a JOIN jobs j ON j.id = a.job_id WHERE a.resume_file_id = $1`,
        [file.id],
      );
      const viewer = ctx.user;
      const maySee =
        application !== null &&
        viewer !== null &&
        (viewer.id === application.user_id ||
          (viewer.company_id === application.company_id &&
            (viewer.role === 'employer_admin' || viewer.role === 'recruiter')));
      if (!maySee) throw new ApiError('not_found');
    }

    let bytes: Buffer;
    try {
      bytes = await getObject(file.storage_key);
    } catch {
      throw new ApiError('not_found');
    }
    ctx.res.writeHead(200, {
      'content-type': file.content_type,
      'content-length': bytes.length,
      'cache-control': 'no-store',
      'content-disposition': file.kind === 'resume' ? 'attachment; filename="resume.pdf"' : 'inline',
    });
    ctx.res.end(bytes);
    return HANDLED;
  });
}
