import { crc32, deflateSync } from 'node:zlib';
import { COMPANY_SIZES, isStage, type Stage } from '../../shared/reference';
import { config } from '../config';
import { advanceOffset, serverNow } from '../db/clock';
import { db } from '../db/pool';
import { hashPassword } from '../domain/passwords';
import { alertLabel } from '../domain/alerts';
import { refs } from '../domain/validate';
import { ApiError } from '../errors';
import type { Context, Role } from '../http/context';
import { sendJson } from '../http/respond';
import { HANDLED, type Router } from '../http/router';
import { closeAllStreams } from '../services/live';
import { runDueJobs } from '../services/due';
import { markKey, putAndConfirm, resumeKey } from '../services/storage';
import { reindexAll } from '../services/sync';
import { SESSION_DAYS } from '../http/context';
import { token, uuid } from '../ids';

function requireGradingToken(ctx: Context): void {
  if (!config.gradingToken || ctx.header('x-grading-token') !== config.gradingToken) {
    throw new ApiError('not_found');
  }
}

function invalid(field: string, copy: string): never {
  throw new ApiError('validation_failed', { fields: { [field]: copy } });
}

function asArray(value: unknown, field: string): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) invalid(field, 'Use a list.');
  return value as Record<string, unknown>[];
}

function text(item: Record<string, unknown>, name: string, field: string): string {
  const value = item[name];
  if (typeof value !== 'string' || value.trim() === '') invalid(field, `Give ${name}.`);
  return (value as string).trim();
}

function optionalText(item: Record<string, unknown>, name: string): string | null {
  const value = item[name];
  return typeof value === 'string' ? value : null;
}

function integer(item: Record<string, unknown>, name: string, field: string): number {
  const value = item[name];
  if (!Number.isInteger(value)) invalid(field, `Give ${name}.`);
  return value as number;
}

function dateValue(item: Record<string, unknown>, name: string, fallback: Date): Date {
  const value = item[name];
  if (value === undefined || value === null) return fallback;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) invalid(name, 'Give an ISO 8601 time.');
  return parsed;
}

function smallPdf(): Buffer {
  return Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    'latin1',
  );
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

function smallPng(): Buffer {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const pixels = deflateSync(Buffer.from([0x00, 0x16, 0x5c, 0x5a]));
  return Buffer.concat([header, pngChunk('IHDR', ihdr), pngChunk('IDAT', pixels), pngChunk('IEND', Buffer.alloc(0))]);
}

export function registerGradingRoutes(router: Router): void {
  router.post('/api/grading/setup', async (ctx: Context) => {
    requireGradingToken(ctx);
    const body = ctx.json();
    const now = await serverNow();
    const ids: Record<string, string> = {};
    const sessions: Record<string, string> = {};
    const companyIdByKey = new Map<string, string>();
    const userIdByKey = new Map<string, string>();
    const channelIdByKey = new Map<string, string>();
    const jobIdByKey = new Map<string, string>();
    const postIdByKey = new Map<string, string>();
    const touchedCompanies = new Set<string>();

    const resolveCompany = async (reference: string, field: string): Promise<string> => {
      const byKey = companyIdByKey.get(reference);
      if (byKey) return byKey;
      const row = await db.one<{ id: string }>('SELECT id FROM companies WHERE slug = $1', [reference]);
      if (!row) invalid(field, 'Unknown company.');
      return (row as { id: string }).id;
    };
    const resolveUser = (reference: string, field: string): string => {
      const id = userIdByKey.get(reference);
      if (!id) invalid(field, 'Unknown user.');
      return id as string;
    };

    for (const item of asArray(body['companies'], 'companies')) {
      const key = text(item, 'key', 'companies');
      const slug = text(item, 'slug', 'slug');
      const name = text(item, 'name', 'name');
      const city = refs.isCityId(item['city']) ? String(item['city']) : invalid('city', 'Choose a city.');
      const size = COMPANY_SIZES.includes(item['size'] as never)
        ? String(item['size'])
        : invalid('size', 'Choose a size.');
      const emailDomain = text(item, 'email_domain', 'email_domain');
      const taken = await db.one<{ id: string }>('SELECT id FROM companies WHERE slug = $1 OR name = $2', [slug, name]);
      if (taken) invalid('slug', 'That slug or name is already used.');
      const id = uuid();
      await db.query(
        `INSERT INTO companies (id, slug, name, city, size, verified, email_domain, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, slug, name, city, size, item['verified'] === true, emailDomain, now],
      );
      if (item['mark'] === true) {
        const fileId = uuid();
        await putAndConfirm(markKey(id), smallPng(), 'image/png');
        await db.query(
          `INSERT INTO stored_files (id, kind, storage_key, content_type, byte_size, company_id, created_at)
           VALUES ($1, 'mark', $2, 'image/png', $3, $4, $5)`,
          [fileId, markKey(id), smallPng().length, id, now],
        );
        await db.query('UPDATE companies SET mark_file_id = $2 WHERE id = $1', [id, fileId]);
      }
      companyIdByKey.set(key, id);
      ids[key] = id;
      touchedCompanies.add(id);
    }

    for (const item of asArray(body['users'], 'users')) {
      const key = text(item, 'key', 'users');
      const role = item['role'];
      const roles: Role[] = ['member', 'moderator', 'employer_admin', 'recruiter', 'founder'];
      if (!roles.includes(role as Role)) invalid('role', 'Choose a role.');
      const displayName = text(item, 'display_name', 'display_name');
      const email = text(item, 'email', 'email');
      const password = text(item, 'password', 'password');
      const needsCompany = role === 'employer_admin' || role === 'recruiter';
      const companyReference = optionalText(item, 'company');
      if (needsCompany && !companyReference) invalid('company', 'Give a company.');
      const companyId = companyReference ? await resolveCompany(companyReference, 'company') : null;
      const existing = await db.one<{ id: string }>('SELECT id FROM users WHERE email_lower = $1', [
        email.toLowerCase(),
      ]);
      if (existing) invalid('email', 'That address already has an account.');
      const id = uuid();
      await db.query(
        `INSERT INTO users (id, display_name, email, email_lower, password_hash, role, company_id, unlocked, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          displayName,
          email,
          email.toLowerCase(),
          await hashPassword(password),
          role,
          companyId,
          item['unlocked'] === true,
          now,
        ],
      );
      const sessionToken = token();
      await db.query('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)', [
        sessionToken,
        id,
        now,
        new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000),
      ]);
      userIdByKey.set(key, id);
      ids[key] = id;
      sessions[key] = sessionToken;
    }

    for (const item of asArray(body['channels'], 'channels')) {
      const key = text(item, 'key', 'channels');
      const slug = text(item, 'slug', 'slug');
      const name = text(item, 'name', 'name');
      const id = uuid();
      await db.query('INSERT INTO channels (id, slug, name) VALUES ($1, $2, $3) ON CONFLICT (slug) DO NOTHING', [
        id,
        slug,
        name,
      ]);
      const stored = await db.one<{ id: string }>('SELECT id FROM channels WHERE slug = $1', [slug]);
      channelIdByKey.set(key, stored?.id ?? id);
      ids[key] = stored?.id ?? id;
    }

    for (const item of asArray(body['posts'], 'posts')) {
      const key = text(item, 'key', 'posts');
      const kind = item['kind'];
      if (kind !== 'review' && kind !== 'pay_report' && kind !== 'interview_note') invalid('kind', 'Choose a kind.');
      const state = item['state'];
      if (!['pending', 'claimed', 'approved', 'rejected'].includes(String(state))) invalid('state', 'Choose a state.');
      const companyId = await resolveCompany(text(item, 'company', 'company'), 'company');
      const authorId = resolveUser(text(item, 'author', 'author'), 'author');
      const claimedBy = optionalText(item, 'claimed_by')
        ? resolveUser(optionalText(item, 'claimed_by') as string, 'claimed_by')
        : null;
      const decidedBy = optionalText(item, 'decided_by')
        ? resolveUser(optionalText(item, 'decided_by') as string, 'decided_by')
        : null;
      const createdAt = dateValue(item, 'created_at', now);
      const id = uuid();

      if (kind === 'review') {
        await db.query(
          `INSERT INTO posts (id, kind, company_id, author_id, state, created_at, updated_at, claimed_by, claimed_at,
                              lease_started_at, decided_by, decided_at, reason,
                              overall, work_life, pay, management, title, pros, cons)
           VALUES ($1, 'review', $2, $3, $4, $5, $5, $6, $7, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            id,
            companyId,
            authorId,
            state,
            createdAt,
            claimedBy,
            state === 'claimed' ? createdAt : null,
            decidedBy,
            state === 'approved' || state === 'rejected' ? createdAt : null,
            optionalText(item, 'reason'),
            integer(item, 'overall', 'overall'),
            integer(item, 'work_life', 'work_life'),
            integer(item, 'pay', 'pay'),
            integer(item, 'management', 'management'),
            text(item, 'title', 'title'),
            text(item, 'pros', 'pros'),
            text(item, 'cons', 'cons'),
          ],
        );
      } else if (kind === 'pay_report') {
        await db.query(
          `INSERT INTO posts (id, kind, company_id, author_id, state, created_at, updated_at, claimed_by, claimed_at,
                              lease_started_at, decided_by, decided_at, reason,
                              role_family, city, annual_pay, years_experience)
           VALUES ($1, 'pay_report', $2, $3, $4, $5, $5, $6, $7, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            id,
            companyId,
            authorId,
            state,
            createdAt,
            claimedBy,
            state === 'claimed' ? createdAt : null,
            decidedBy,
            state === 'approved' || state === 'rejected' ? createdAt : null,
            optionalText(item, 'reason'),
            refs.isRoleFamilyId(item['role_family'])
              ? String(item['role_family'])
              : invalid('role_family', 'Choose a role.'),
            refs.isCityId(item['city']) ? String(item['city']) : invalid('city', 'Choose a city.'),
            integer(item, 'annual_pay', 'annual_pay'),
            integer(item, 'years_experience', 'years_experience'),
          ],
        );
      } else {
        const outcome = item['outcome'];
        if (outcome !== 'offer' && outcome !== 'no_offer' && outcome !== 'no_reply')
          invalid('outcome', 'Choose what happened.');
        await db.query(
          `INSERT INTO posts (id, kind, company_id, author_id, state, created_at, updated_at, claimed_by, claimed_at,
                              lease_started_at, decided_by, decided_at, reason,
                              role_family, difficulty, outcome, body_text)
           VALUES ($1, 'interview_note', $2, $3, $4, $5, $5, $6, $7, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            id,
            companyId,
            authorId,
            state,
            createdAt,
            claimedBy,
            state === 'claimed' ? createdAt : null,
            decidedBy,
            state === 'approved' || state === 'rejected' ? createdAt : null,
            optionalText(item, 'reason'),
            refs.isRoleFamilyId(item['role_family'])
              ? String(item['role_family'])
              : invalid('role_family', 'Choose a role.'),
            integer(item, 'difficulty', 'difficulty'),
            outcome,
            text(item, 'text', 'text'),
          ],
        );
      }
      postIdByKey.set(key, id);
      ids[key] = id;
      touchedCompanies.add(companyId);
    }

    for (const item of asArray(body['replies'], 'replies')) {
      const reviewReference = text(item, 'review', 'review');
      const reviewId = postIdByKey.get(reviewReference) ?? reviewReference;
      const review = await db.one<{ company_id: string }>(`SELECT company_id FROM posts WHERE id = $1`, [reviewId]);
      if (!review) invalid('review', 'Unknown review.');
      resolveUser(text(item, 'by', 'by'), 'by');
      await db.query(
        'INSERT INTO review_replies (review_id, company_id, body, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [reviewId, (review as { company_id: string }).company_id, text(item, 'body', 'body'), now],
      );
      touchedCompanies.add((review as { company_id: string }).company_id);
    }

    for (const item of asArray(body['jobs'], 'jobs')) {
      const key = text(item, 'key', 'jobs');
      const companyId = await resolveCompany(text(item, 'company', 'company'), 'company');
      const status = item['status'];
      if (status !== 'draft' && status !== 'listed' && status !== 'closed') invalid('status', 'Choose a status.');
      const listedAt = status === 'listed' ? dateValue(item, 'listed_at', now) : null;
      const id = uuid();
      await db.query(
        `INSERT INTO jobs (id, company_id, title, role_family, city, remote, pay_low, pay_high, description, status,
                           listed_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [
          id,
          companyId,
          text(item, 'title', 'title'),
          refs.isRoleFamilyId(item['role_family'])
            ? String(item['role_family'])
            : invalid('role_family', 'Choose a role.'),
          refs.isCityId(item['city']) ? String(item['city']) : invalid('city', 'Choose a city.'),
          refs.isWorkPatternId(item['remote']) ? String(item['remote']) : invalid('remote', 'Choose a work pattern.'),
          integer(item, 'pay_low', 'pay_low'),
          integer(item, 'pay_high', 'pay_high'),
          text(item, 'description', 'description'),
          status,
          listedAt,
          dateValue(item, 'listed_at', now),
        ],
      );
      jobIdByKey.set(key, id);
      ids[key] = id;
    }

    for (const item of asArray(body['saved_jobs'], 'saved_jobs')) {
      const userId = resolveUser(text(item, 'user', 'user'), 'user');
      const jobReference = text(item, 'job', 'job');
      const jobId = jobIdByKey.get(jobReference) ?? jobReference;
      await db.query('INSERT INTO saved_jobs (user_id, job_id, saved_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [
        userId,
        jobId,
        now,
      ]);
    }

    for (const item of asArray(body['alerts'], 'alerts')) {
      const key = text(item, 'key', 'alerts');
      const userId = resolveUser(text(item, 'user', 'user'), 'user');
      const cities = asStringList(item['city'], refs.isCityId, 'city');
      const roles = asStringList(item['role'], refs.isRoleFamilyId, 'role');
      const remotes = asStringList(item['remote'], refs.isWorkPatternId, 'remote');
      const bands = asStringList(item['band'], refs.isPayBandId, 'band');
      const id = uuid();
      await db.query(
        `INSERT INTO alerts (id, user_id, q, cities, role_families, remotes, bands, new_count, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8)`,
        [id, userId, optionalText(item, 'q') ?? '', cities, roles, remotes, bands, now],
      );
      ids[key] = id;
      ids[`${key}_label`] = alertLabel({
        q: optionalText(item, 'q') ?? '',
        cities,
        role_families: roles,
        remotes,
        bands,
      });
    }

    for (const item of asArray(body['applications'], 'applications')) {
      const key = text(item, 'key', 'applications');
      const userId = resolveUser(text(item, 'user', 'user'), 'user');
      const jobReference = text(item, 'job', 'job');
      const jobId = jobIdByKey.get(jobReference) ?? jobReference;
      const stage: Stage = isStage(item['stage']) ? (item['stage'] as Stage) : 'submitted';
      const appliedAt = dateValue(item, 'applied_at', now);
      const fileId = uuid();
      const pdf = smallPdf();
      await putAndConfirm(resumeKey(fileId), pdf, 'application/pdf');
      await db.query(
        `INSERT INTO stored_files (id, kind, storage_key, content_type, byte_size, created_at)
         VALUES ($1, 'resume', $2, 'application/pdf', $3, $4)`,
        [fileId, resumeKey(fileId), pdf.length, appliedAt],
      );
      const id = uuid();
      await db.query(
        `INSERT INTO applications (id, job_id, user_id, candidate_name, contact_email, phone, cover_note, stage,
                                   resume_file_id, applied_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, '', '', $6, $7, $8, $8)`,
        [
          id,
          jobId,
          userId,
          text(item, 'candidate_name', 'candidate_name'),
          text(item, 'contact_email', 'contact_email'),
          stage,
          fileId,
          appliedAt,
        ],
      );
      await db.query('INSERT INTO application_stages (application_id, stage, at) VALUES ($1, $2, $3)', [
        id,
        stage,
        appliedAt,
      ]);
      ids[key] = id;
    }

    for (const item of asArray(body['channel_posts'], 'channel_posts')) {
      const key = text(item, 'key', 'channel_posts');
      const channelReference = text(item, 'channel', 'channel');
      let channelId = channelIdByKey.get(channelReference) ?? null;
      if (!channelId) {
        const row = await db.one<{ id: string }>('SELECT id FROM channels WHERE slug = $1', [channelReference]);
        if (!row) invalid('channel', 'Unknown channel.');
        channelId = (row as { id: string }).id;
      }
      const id = uuid();
      await db.query(
        'INSERT INTO channel_posts (id, channel_id, author_id, body, created_at) VALUES ($1, $2, $3, $4, $5)',
        [
          id,
          channelId,
          resolveUser(text(item, 'author', 'author'), 'author'),
          text(item, 'body', 'body'),
          dateValue(item, 'created_at', now),
        ],
      );
      ids[key] = id;
    }

    await reindexAll();
    sendJson(ctx.res, 201, { ids, sessions });
    return HANDLED;
  });

  router.post('/api/grading/clock', async (ctx: Context) => {
    requireGradingToken(ctx);
    const body = ctx.json();
    const seconds = body['advance_seconds'];
    if (!Number.isInteger(seconds) || (seconds as number) < 0 || (seconds as number) > 31536000) {
      throw new ApiError('validation_failed', { fields: { advance_seconds: 'Give 0 to 31536000 seconds.' } });
    }
    const now = await advanceOffset(seconds as number);
    await runDueJobs();
    return { now: now.toISOString() };
  });

  router.post('/api/grading/live/close', async (ctx: Context) => {
    requireGradingToken(ctx);
    return { closed: closeAllStreams() };
  });
}

function asStringList(value: unknown, check: (item: unknown) => boolean, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every(check)) invalid(field, 'Use valid values.');
  return value as string[];
}
