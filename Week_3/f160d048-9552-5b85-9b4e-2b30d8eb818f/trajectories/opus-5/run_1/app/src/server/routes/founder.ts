import { COMPANY_SIZES, type CityId, type RoleFamilyId } from '../../shared/reference';
import { config } from '../config';
import { db, transaction } from '../db/pool';
import { approvedPayReports, companyHit, findCompanyBySlug } from '../domain/projection';
import { COPY, emailValue, FieldErrors, refs, textBetween } from '../domain/validate';
import { ApiError } from '../errors';
import type { Context, Role } from '../http/context';
import { sendJson } from '../http/respond';
import { HANDLED, type Router } from '../http/router';
import { publish } from '../services/live';
import { letters, queueLetter } from '../services/mail';
import { pendingCount } from '../services/mail';
import * as mailService from '../services/smtp';
import * as searchService from '../services/search';
import * as storageService from '../services/storage';
import { flushSyncQuietly, pendingSyncCount, queueSync } from '../services/sync';
import { hashPassword } from '../domain/passwords';
import { token, uuid } from '../ids';

interface MemberRow {
  id: string;
  display_name: string;
  email: string;
  role: Role;
  company_slug: string | null;
}

const MEMBER_COLUMNS = `u.id, u.display_name, u.email, u.role, c.slug AS company_slug`;

export function registerFounderRoutes(router: Router): void {
  router.get('/api/founder/health', async (ctx: Context) => {
    ctx.requireRole('founder');
    const [search, storage, mail] = await Promise.all([
      searchService.isAvailable(),
      storageService.isAvailable(),
      mailService.isAvailable(),
    ]);
    return {
      database: 'ok',
      search: search ? 'ok' : 'unavailable',
      storage: storage ? 'ok' : 'unavailable',
      mail: mail ? 'ok' : 'unavailable',
      outbox_pending: await pendingCount(),
      search_sync_pending: await pendingSyncCount(),
    };
  });

  router.get('/api/founder/members', async (ctx: Context) => {
    ctx.requireRole('founder');
    const rows = await db.query<MemberRow>(
      `SELECT ${MEMBER_COLUMNS} FROM users u LEFT JOIN companies c ON c.id = u.company_id ORDER BY u.created_at, u.id`,
    );
    return { members: rows };
  });

  router.post('/api/founder/moderators', async (ctx: Context) => {
    ctx.requireRole('founder');
    const body = ctx.json();
    const userId = typeof body['user_id'] === 'string' ? body['user_id'] : '';
    if (userId === '') throw new ApiError('validation_failed', { fields: { user_id: COPY.user_id } });
    const user = await db.one<{ id: string; role: Role }>('SELECT id, role FROM users WHERE id = $1', [userId]);
    if (!user) throw new ApiError('not_found');
    if (user.role !== 'member') throw new ApiError('invalid_transition');
    await db.query(`UPDATE users SET role = 'moderator' WHERE id = $1`, [userId]);
    return db.one<MemberRow>(
      `SELECT ${MEMBER_COLUMNS} FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE u.id = $1`,
      [userId],
    );
  });

  router.post('/api/founder/companies', async (ctx: Context) => {
    ctx.requireRole('founder');
    const body = ctx.json();
    const errors = new FieldErrors();
    const name = textBetween(body['name'], 2, 120);
    const slugValue = textBetween(body['slug'], 2, 80);
    const slug = slugValue && /^[a-z0-9-]+$/.test(slugValue) ? slugValue : null;
    const city = refs.isCityId(body['city']) ? (body['city'] as CityId) : null;
    const size =
      typeof body['size'] === 'string' && COMPANY_SIZES.includes(body['size'] as never) ? body['size'] : null;
    const domainValue = textBetween(body['email_domain'], 3, 120);
    const domain = domainValue && /^[a-z0-9.-]+\.[a-z]+$/i.test(domainValue) ? domainValue.toLowerCase() : null;
    if (!name) errors.add('name', COPY.name);
    if (!slug) errors.add('slug', COPY.slug);
    if (!city) errors.add('city', COPY.city);
    if (!size) errors.add('size', COPY.size);
    if (!domain) errors.add('email_domain', COPY.email_domain);
    errors.throwIfAny();

    const taken = await db.one<{ id: string }>('SELECT id FROM companies WHERE slug = $1 OR name = $2', [slug, name]);
    if (taken) throw new ApiError('validation_failed', { fields: { slug: 'That slug or name is already used.' } });

    const now = await ctx.now();
    const id = uuid();
    await transaction(async (tx) => {
      await tx.query(
        `INSERT INTO companies (id, slug, name, city, size, verified, email_domain, created_at)
         VALUES ($1, $2, $3, $4, $5, false, $6, $7)`,
        [id, slug, name, city, size, domain, now],
      );
      await queueSync(tx, now, 'company', id, 'upsert');
    });
    await flushSyncQuietly('company', id);
    const company = await findCompanyBySlug(slug as string);
    sendJson(ctx.res, 201, await companyHit(company as NonNullable<typeof company>));
    return HANDLED;
  });

  router.post('/api/founder/employer-users', async (ctx: Context) => {
    ctx.requireRole('founder');
    const body = ctx.json();
    const errors = new FieldErrors();
    const companySlug = typeof body['company_slug'] === 'string' ? body['company_slug'].trim() : '';
    const displayName = textBetween(body['display_name'], 2, 40);
    const email = emailValue(body['email']);
    const role = body['role'] === 'employer_admin' || body['role'] === 'recruiter' ? (body['role'] as Role) : null;
    if (companySlug !== '') {
      const company = await findCompanyBySlug(companySlug);
      if (!company) throw new ApiError('not_found');
    }
    if (companySlug === '') errors.add('company_slug', COPY.company_id);
    if (!displayName) errors.add('display_name', COPY.display_name);
    if (!email) errors.add('email', COPY.email);
    if (!role) errors.add('role', COPY.role);
    errors.throwIfAny();

    const company = await findCompanyBySlug(companySlug);
    const existing = await db.one<{ id: string }>('SELECT id FROM users WHERE email_lower = $1', [
      (email as string).toLowerCase(),
    ]);
    if (existing)
      throw new ApiError('validation_failed', { fields: { email: 'That address already has an account.' } });

    const now = await ctx.now();
    const id = uuid();
    const passwordHash = await hashPassword(token());
    await transaction(async (tx) => {
      await tx.query(
        `INSERT INTO users (id, display_name, email, email_lower, password_hash, role, company_id, unlocked, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8)`,
        [id, displayName, email, (email as string).toLowerCase(), passwordHash, role, company?.id ?? null, now],
      );
      const value = token();
      await tx.query(
        `INSERT INTO email_tokens (token, kind, user_id, email, created_at) VALUES ($1, 'set_password', $2, $3, $4)`,
        [value, id, email, now],
      );
      await queueLetter(tx, now, letters.setPassword(email as string, value));
    });
    sendJson(ctx.res, 201, {
      id,
      display_name: displayName,
      email,
      role,
      company_slug: company?.slug ?? null,
    });
    return HANDLED;
  });

  router.post('/api/founder/companies/:slug/revoke-verification', async (ctx: Context) => {
    ctx.requireRole('founder');
    const company = await findCompanyBySlug(ctx.param('slug'));
    if (!company) throw new ApiError('not_found');
    const now = await ctx.now();
    await transaction(async (tx) => {
      await tx.query('UPDATE companies SET verified = false WHERE id = $1', [company.id]);
      await queueSync(tx, now, 'company', company.id, 'upsert');
      await publish(tx, now, 'company.changed', { slug: company.slug }, { all: true });
    });
    await flushSyncQuietly('company', company.id);
    return companyHit({ ...company, verified: false });
  });

  /** The console shows every threshold row and never a pay figure. */
  router.get('/api/founder/thresholds', async (ctx: Context) => {
    ctx.requireRole('founder');
    const companies = await db.query<{ id: string; slug: string }>('SELECT id, slug FROM companies ORDER BY slug');
    const rows: Array<{
      company_slug: string;
      role_family: RoleFamilyId;
      city: CityId;
      report_count: number;
      threshold: number;
      shown: boolean;
    }> = [];
    for (const company of companies) {
      const reports = await approvedPayReports(company.id);
      const counts = new Map<string, number>();
      for (const report of reports) {
        const key = `${report.role_family}:${report.city}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const [key, count] of counts) {
        const [roleFamily, city] = key.split(':') as [RoleFamilyId, CityId];
        rows.push({
          company_slug: company.slug,
          role_family: roleFamily,
          city,
          report_count: count,
          threshold: config.minPayReports,
          shown: count >= config.minPayReports,
        });
      }
    }
    return { rows };
  });
}
