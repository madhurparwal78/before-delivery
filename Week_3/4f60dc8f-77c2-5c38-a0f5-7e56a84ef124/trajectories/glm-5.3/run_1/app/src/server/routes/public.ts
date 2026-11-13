import { Router } from 'express';
import type { Request, Response } from 'express';
import type { App } from '../app';
import { ApiError } from '../errors';
import { newId, landingPath, sha256, randomToken } from '../domain';
import { createClientSession, setCookie, createStudioSession, clearCookie } from '../middleware';
import { createHash } from 'node:crypto';
import type { CurrencyCode } from '../types';

export function publicRoutes(app: App): Router {
  const router = Router();

  router.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/api/status', async (_req, res) => {
    const statuses = await app.clientStatuses();
    res.json(statuses);
  });

  router.get('/api/content', async (_req, res, next) => {
    try {
      const content = await app.pocketbase.getContent();
      res.json(content);
    } catch (error) {
      next(new ApiError('content_unavailable'));
    }
  });

  router.get('/api/work/:slug', async (req, res, next) => {
    try {
      const study = await app.pocketbase.getCaseStudy(req.params.slug);
      if (!study) {
        throw new ApiError('not_found');
      }
      res.json(study);
    } catch (error) {
      if (error instanceof ApiError) {
        next(error);
        return;
      }
      next(new ApiError('content_unavailable'));
    }
  });

  router.get('/api/search', async (req, res, next) => {
    try {
      const raw = typeof req.query.q === 'string' ? req.query.q : '';
      const trimmed = raw.trim();
      if (trimmed.length > 100) {
        throw new ApiError('validation_failed', { q: 'Use up to 100 characters.' });
      }
      if (trimmed.length === 0) {
        res.json({ query: '', hits: [] });
        return;
      }
      const hits = await app.search.search(trimmed);
      res.json({
        query: trimmed,
        hits: hits.map(hit => ({ kind: hit.kind, title: hit.title, summary: hit.summary, url: hit.url })),
      });
    } catch (error) {
      if (error instanceof ApiError) {
        next(error);
        return;
      }
      next(new ApiError('search_unavailable'));
    }
  });

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  router.post('/api/projects/start', async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const brandName = typeof body.brand_name === 'string' ? body.brand_name.trim() : '';
      const contactName = typeof body.contact_name === 'string' ? body.contact_name.trim() : '';
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const currency = typeof body.currency === 'string' ? body.currency : '';
      const financeEmail = typeof body.finance_email === 'string' && body.finance_email.trim().length > 0
        ? body.finance_email.trim().toLowerCase() : email;
      const reviewerEmail = typeof body.reviewer_email === 'string' && body.reviewer_email.trim().length > 0
        ? body.reviewer_email.trim().toLowerCase() : email;

      const fields: Record<string, string> = {};
      if (brandName.length < 1 || brandName.length > 80) {
        fields.brand_name = 'Enter your brand name.';
      }
      if (contactName.length < 1 || contactName.length > 80) {
        fields.contact_name = 'Enter your name.';
      }
      if (!EMAIL_RE.test(email)) {
        fields.email = 'Enter a valid email address.';
      }
      if (title.length < 1 || title.length > 120) {
        fields.title = 'Enter a project title.';
      }
      if (!['EUR', 'GBP', 'USD', 'JPY'].includes(currency)) {
        fields.currency = 'Choose EUR, GBP, USD or JPY.';
      }
      if (!EMAIL_RE.test(financeEmail)) {
        fields.finance_email = 'Enter a valid email address.';
      }
      if (!EMAIL_RE.test(reviewerEmail)) {
        fields.reviewer_email = 'Enter a valid email address.';
      }
      if (Object.keys(fields).length > 0) {
        throw new ApiError('validation_failed', fields);
      }

      const existing = await app.pool.query(
        `SELECT 1 FROM contacts WHERE lower(email) = ANY($1)`,
        [[email, financeEmail, reviewerEmail]],
      );
      if (existing.rows.length > 0) {
        throw new ApiError('email_taken');
      }

      const client = await app.pool.connect();
      try {
        await client.query('BEGIN');
        const brandId = newId();
        await client.query(
          `INSERT INTO brands (id, name, currency) VALUES ($1, $2, $3)`,
          [brandId, brandName, currency],
        );
        const ownerContactId = newId();
        await client.query(
          `INSERT INTO contacts (id, brand_id, name, email, role) VALUES ($1, $2, $3, $4, 'owner')`,
          [ownerContactId, brandId, contactName, email],
        );
        if (financeEmail !== email) {
          await client.query(
            `INSERT INTO contacts (id, brand_id, name, email, role) VALUES ($1, $2, $3, $4, 'finance')`,
            [newId(), brandId, 'Finance contact', financeEmail],
          );
        }
        if (reviewerEmail !== email) {
          await client.query(
            `INSERT INTO contacts (id, brand_id, name, email, role) VALUES ($1, $2, $3, $4, 'reviewer')`,
            [newId(), brandId, 'Reviewer', reviewerEmail],
          );
        }
        const counter = await client.query(`SELECT nextval('engagement_reference_seq') AS n`);
        const reference = `GW-${counter.rows[0].n}`;
        const engagementId = newId();
        const rates = await import('../domain').then(m => m.allRatesInEffect);
        const rate = currency === 'GBP' ? '1.0000' : (await rates(app.pool))[currency as 'EUR' | 'USD' | 'JPY'];
        await client.query(
          `INSERT INTO engagements (id, brand_id, reference, title, state, fx_rate) VALUES ($1, $2, $3, $4, 'quoted', $5)`,
          [engagementId, brandId, reference, title, rate],
        );
        await client.query('COMMIT');

        const engagement = await import('../domain').then(m => m.loadEngagement(app, engagementId, { onlyIssuedInvoices: false }));
        const token = await createClientSession(app, brandId, ownerContactId);
        setCookie(res, 'gw_session', token);
        res.status(201).json({ engagement });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/session/code', async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!EMAIL_RE.test(email)) {
        throw new ApiError('validation_failed', { email: 'Enter a valid email address.' });
      }
      // The sign-in code window: at most three counted requests per email.
      const windowSeconds = app.config.timers.signinCodeWindowSeconds;
      const cutoff = new Date(Date.now() - windowSeconds * 1000);
      const counted = await app.pool.query(
        `SELECT created_at FROM code_requests WHERE email = $1 AND created_at >= $2 ORDER BY created_at ASC`,
        [email, cutoff.toISOString()],
      );
      if (counted.rows.length >= 3) {
        const oldest = new Date(counted.rows[0].created_at);
        const retryAfter = Math.max(1, Math.ceil((oldest.getTime() + windowSeconds * 1000 - Date.now()) / 1000));
        throw new ApiError('too_many_requests', { email: 'Too many codes were requested. Try again in a few minutes.' }, { 'Retry-After': String(retryAfter) });
      }
      await app.pool.query(
        `INSERT INTO code_requests (id, email) VALUES ($1, $2)`,
        [newId(), email],
      );
      const known = await app.pool.query(`SELECT 1 FROM contacts WHERE lower(email) = $1`, [email]);
      if (known.rows.length === 0) {
        res.status(202).json({ status: 'sent' });
        return;
      }
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expires = new Date(Date.now() + app.config.timers.signinCodeTtlSeconds * 1000);
      const client = await app.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE signin_codes SET used = TRUE WHERE email = $1`,
          [email],
        );
        await client.query(
          `INSERT INTO signin_codes (id, email, code, expires_at) VALUES ($1, $2, $3, $4)`,
          [newId(), email, code, expires.toISOString()],
        );
        await client.query(
          `INSERT INTO outbox (id, kind, payload) VALUES ($1, 'email', $2)`,
          [newId(), JSON.stringify({ type: 'sign_in_code', email, code })],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      res.status(202).json({ status: 'sent' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/session', async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const code = typeof body.code === 'string' ? body.code.trim() : '';
      const nextPath = typeof body.next === 'string' ? body.next : undefined;
      const result = await app.pool.query(
        `SELECT * FROM signin_codes WHERE email = $1 AND used = FALSE ORDER BY created_at DESC LIMIT 1`,
        [email],
      );
      if (result.rows.length === 0) {
        throw new ApiError('code_invalid');
      }
      const row = result.rows[0];
      const expiresAt = new Date(row.expires_at);
      // A code is accepted at exactly its TTL age.
      if (Date.now() > expiresAt.getTime()) {
        throw new ApiError('code_invalid');
      }
      if (row.attempts >= 5) {
        throw new ApiError('code_invalid');
      }
      if (row.code !== code) {
        await app.pool.query(`UPDATE signin_codes SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
        throw new ApiError('code_invalid');
      }
      await app.pool.query(`UPDATE signin_codes SET used = TRUE WHERE id = $1`, [row.id]);
      const contact = await app.pool.query(
        `SELECT c.id, c.brand_id, c.name, c.email, b.name AS brand_name, b.currency
         FROM contacts c JOIN brands b ON b.id = c.brand_id WHERE lower(c.email) = $1`,
        [email],
      );
      if (contact.rows.length === 0) {
        throw new ApiError('code_invalid');
      }
      const contactRow = contact.rows[0];
      const token = await createClientSession(app, contactRow.brand_id, contactRow.id);
      setCookie(res, 'gw_session', token);
      res.json({
        brand: { id: contactRow.brand_id, name: contactRow.brand_name, currency: contactRow.currency },
        contact: { name: contactRow.name, email: contactRow.email },
        landing: landingPath(nextPath),
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/api/session', (req, res) => {
    clearCookie(res, 'gw_session');
    res.status(204).end();
  });

  router.post('/api/studio/session', async (req, res, next) => {
    try {
      const body = req.body as Record<string, unknown>;
      const password = typeof body.password === 'string' ? body.password : '';
      const stored = await app.pool.query(`SELECT value FROM studio_state WHERE id = 'founder_password_hash'`);
      if (stored.rows.length === 0) {
        throw new ApiError('invalid_credentials');
      }
      const hash = createHash('sha256').update(password).digest('hex');
      if (hash !== stored.rows[0].value) {
        throw new ApiError('invalid_credentials');
      }
      const token = await createStudioSession(app);
      setCookie(res, 'gw_studio', token);
      res.json({ role: 'founder' });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/api/studio/session', (_req, res) => {
    clearCookie(res, 'gw_studio');
    res.status(204).end();
  });

  return router;
}

export function hashPassword(password: string): string {
  return sha256(password);
}

export function currencyOf(value: string): CurrencyCode | null {
  if (value === 'EUR' || value === 'GBP' || value === 'USD' || value === 'JPY') {
    return value;
  }
  return null;
}
