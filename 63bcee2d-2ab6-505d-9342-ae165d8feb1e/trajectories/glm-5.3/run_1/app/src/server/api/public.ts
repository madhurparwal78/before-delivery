// Case studies, preview links, the public work index and enquiries.

import { Router } from 'express';
import express from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { one, query } from '../lib/db.js';
import { ApiError, forbidden, illegalTransition, notFound, FIELD_ERRORS } from '../lib/errors.js';
import { requireSession } from '../lib/auth.js';
import type { AuthedRequest } from '../lib/auth.js';
import { checkLength, checkOneLine, requireString, throwValidation, wrap } from './helpers.js';
import { instantText, localToInstant } from '../lib/time.js';
import type { Config } from '../lib/config.js';
import { queueMany, queueMail } from '../lib/outbox.js';

const SECTORS = ['retail', 'workplace', 'food_beverage'] as const;
const SECTOR_LABELS: Record<string, string> = { retail: 'Retail', workplace: 'Workplace', food_beverage: 'Food & beverage' };

interface CaseStudyRow {
  id: string;
  title: string;
  slug: string;
  sector: 'retail' | 'workplace' | 'food_beverage';
  brand_id: string;
  location: string;
  summary: string;
  body: string;
  featured: boolean;
  featured_order: number | null;
  state: 'draft' | 'preview_sent' | 'client_approved' | 'published' | 'withdrawn';
  published_seq: number | null;
}

async function caseStudyById(id: string): Promise<CaseStudyRow | null> {
  return one<CaseStudyRow>('SELECT * FROM case_studies WHERE id = $1', [id]);
}

async function caseStudyPayload(row: CaseStudyRow): Promise<Record<string, unknown>> {
  const brand = await one<{ id: string; name: string }>('SELECT id, name FROM brands WHERE id = $1', [row.brand_id]);
  const activeLink = await one<{ token: string }>(
    'SELECT token FROM preview_links WHERE case_study_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1',
    [row.id],
  );
  return {
    activePreviewLink: activeLink?.token ?? null,
    id: row.id,
    title: row.title,
    slug: row.slug,
    sector: row.sector,
    brand: brand,
    location: row.location,
    summary: row.summary,
    body: row.body,
    featured: row.featured,
    featuredOrder: row.featured_order,
    state: row.state,
    coverUrl: `/media/covers/${row.slug}.svg`,
  };
}

export function caseStudiesRouter(config: Config): Router {
  const router = Router();
  router.use('/api', requireSession(config.timing.sessionIdleTimeout));

  router.get('/api/case-studies', wrap(async (req, res) => {
    if (req.member!.role !== 'director') throw forbidden();
    const rows = await query<CaseStudyRow>('SELECT * FROM case_studies ORDER BY published_seq NULLS FIRST, slug');
    res.json({ caseStudies: await Promise.all(rows.map(caseStudyPayload)) });
  }));

  router.post('/api/case-studies', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (member.role !== 'director') throw forbidden();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const title = requireString(body.title, 'title', 'Title', errors);
    checkLength(title, 'title', 'Title', 120, errors);
    const slug = requireString(body.slug, 'slug', 'Slug', errors);
    if (slug && !/^[a-z0-9][a-z0-9-]{2,79}$/.test(slug)) errors.slug = 'Slug must be 3 to 80 lowercase letters, digits and hyphens.';
    const sector = typeof body.sector === 'string' ? body.sector : '';
    if (!SECTORS.includes(sector as never)) errors.sector = FIELD_ERRORS.required('Sector');
    const brandId = requireString(body.brandId, 'brandId', 'Brand', errors);
    const location = requireString(body.location, 'location', 'Location', errors);
    checkLength(location, 'location', 'Location', 120, errors);
    const summary = requireString(body.summary, 'summary', 'Summary', errors);
    checkLength(summary, 'summary', 'Summary', 400, errors);
    const articleBody = requireString(body.body, 'body', 'Body', errors);
    checkLength(articleBody, 'body', 'Body', 8000, errors);
    if (slug) {
      const existing = await one('SELECT id FROM case_studies WHERE slug = $1', [slug]);
      if (existing) throw new ApiError(409, { error: 'slug_exists' });
    }
    if (brandId) {
      const brand = await one('SELECT id FROM brands WHERE id = $1', [brandId]);
      if (!brand) throw notFound();
    }
    throwValidation(errors);
    const id = randomUUID();
    const featured = body.featured === true;
    let featuredOrder: number | null = null;
    if (featured) {
      const maxRow = await one<{ max: string | null }>('SELECT max(featured_order) AS max FROM case_studies');
      featuredOrder = maxRow?.max === null || maxRow?.max === undefined ? 1 : parseInt(maxRow.max, 10) + 1;
    }
    await query(
      'INSERT INTO case_studies (id, title, slug, sector, brand_id, location, summary, body, featured, featured_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, title, slug, sector, brandId, location, summary, articleBody, featured, featuredOrder],
    );
    res.status(201).json({ caseStudy: await caseStudyPayload((await caseStudyById(id))!) });
  }));

  router.post('/api/case-studies/:id/preview-links', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (member.role !== 'director') throw forbidden();
    const caseStudy = await caseStudyById(req.params.id);
    if (!caseStudy) throw notFound();
    if (caseStudy.state !== 'draft' && caseStudy.state !== 'preview_sent') {
      throw illegalTransition(caseStudy.state, 'send_preview');
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const expiresRaw = requireString(body.expiresAt, 'expiresAt', 'Link expires at', errors);
    let expiresAt: Date | null = null;
    if (expiresRaw) {
      expiresAt = localToInstant(expiresRaw);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
        errors.expiresAt = FIELD_ERRORS.expiryAfterNow;
      }
    }
    throwValidation(errors);
    const token = randomBytes(24).toString('base64url');
    await query('UPDATE preview_links SET revoked_at = now() WHERE case_study_id = $1 AND revoked_at IS NULL', [caseStudy.id]);
    await query('INSERT INTO preview_links (id, token, case_study_id, expires_at) VALUES ($1,$2,$3,$4)', [
      randomUUID(),
      token,
      caseStudy.id,
      expiresAt,
    ]);
    await query("UPDATE case_studies SET state = 'preview_sent' WHERE id = $1", [caseStudy.id]);
    // One message to each client approver of the brand.
    const approvers = await query<{ email: string; name: string }>(
      `SELECT m.email, m.name FROM members m WHERE m.role = 'client_approver' AND m.brand_id = $1 AND m.status = 'active'`,
      [caseStudy.brand_id],
    );
    const approverCount = approvers.length;
    await queueMany(
      approvers.map((approver) => ({
        to: approver.email,
        subject: `Case study preview: ${caseStudy.title}`,
        body: [
          `${approver.name}, a new case study is ready for your review.`,
          `${config.baseUrl}/preview/${token}`,
          `The link works until ${instantText(expiresAt!, 'HK')}.`,
        ].join('\n'),
      })),
    );
    res.status(201).json({
      previewLink: {
        id: token,
        url: `${config.baseUrl}/preview/${token}`,
        expiresAt: expiresAt!.toISOString(),
      },
      approverCount,
    });
  }));

  router.delete('/api/preview-links/:id', wrap(async (req, res) => {
    const member = req.member!;
    if (member.role !== 'director') throw forbidden();
    const link = await one<{ id: string }>('SELECT id FROM preview_links WHERE token = $1 AND revoked_at IS NULL', [req.params.id]);
    if (!link) throw notFound();
    await query('UPDATE preview_links SET revoked_at = now() WHERE id = $1', [link.id]);
    res.status(204).end();
  }));

  router.post('/api/case-studies/:id/approve', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    const caseStudy = await caseStudyById(req.params.id);
    if (!caseStudy) throw notFound();
    if (member.role !== 'client_approver' || member.brandId !== caseStudy.brand_id) throw forbidden();
    if (caseStudy.state !== 'preview_sent') throw illegalTransition(caseStudy.state, 'approve');
    await query("UPDATE case_studies SET state = 'client_approved' WHERE id = $1", [caseStudy.id]);
    res.json({ caseStudy: await caseStudyPayload((await caseStudyById(caseStudy.id))!) });
  }));

  router.post('/api/case-studies/:id/publish', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (member.role !== 'director') throw forbidden();
    const caseStudy = await caseStudyById(req.params.id);
    if (!caseStudy) throw notFound();
    if (caseStudy.state !== 'client_approved') throw illegalTransition(caseStudy.state, 'publish');
    const seq = await one<{ value: string }>(
      "INSERT INTO counter_state (name, value) VALUES ('case_study_pub_seq', 1) ON CONFLICT (name) DO UPDATE SET value = counter_state.value + 1 RETURNING value",
    );
    await query("UPDATE case_studies SET state = 'published', published_at = now(), published_seq = $1 WHERE id = $2", [
      parseInt(seq!.value, 10),
      caseStudy.id,
    ]);
    res.json({ caseStudy: await caseStudyPayload((await caseStudyById(caseStudy.id))!) });
  }));

  router.post('/api/case-studies/:id/withdraw', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const member = req.member!;
    if (member.role !== 'director') throw forbidden();
    const caseStudy = await caseStudyById(req.params.id);
    if (!caseStudy) throw notFound();
    if (caseStudy.state !== 'published') throw illegalTransition(caseStudy.state, 'withdraw');
    await query("UPDATE case_studies SET state = 'withdrawn' WHERE id = $1", [caseStudy.id]);
    res.json({ caseStudy: await caseStudyPayload((await caseStudyById(caseStudy.id))!) });
  }));

  router.get('/api/enquiries', wrap(async (req, res) => {
    if (req.member!.role !== 'director') throw forbidden();
    const rows = await query<{
      id: string; reference: string; name: string; company: string; email: string; phone: string | null;
      sector: string; region: string; sites: number; opening_month: string; message: string; created_at: Date;
    }>('SELECT * FROM enquiries ORDER BY created_at DESC');
    res.json({
      enquiries: rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        name: row.name,
        company: row.company,
        email: row.email,
        phone: row.phone,
        sector: row.sector,
        region: row.region,
        sites: row.sites,
        openingMonth: row.opening_month,
        message: row.message,
        createdAt: row.created_at.toISOString(),
      })),
    });
  }));

  return router;
}

export function publicRouter(config: Config): Router {
  const router = Router();

  // Preview by token: works while unrevoked, unexpired, and the case study isn't withdrawn.
  router.get('/api/preview/:token', wrap(async (req, res) => {
    const link = await one<{ id: string; case_study_id: string; expires_at: Date; revoked_at: Date | null }>(
      'SELECT id, case_study_id, expires_at, revoked_at FROM preview_links WHERE token = $1',
      [req.params.token],
    );
    if (!link || link.revoked_at || Date.now() > link.expires_at.getTime()) throw notFound();
    const caseStudy = await caseStudyById(link.case_study_id);
    if (!caseStudy || caseStudy.state === 'withdrawn' || caseStudy.state === 'draft') throw notFound();
    // Approval needs a signed-in approver of the brand; the link itself is read-only.
    const member = await loadOptionalMember(req);
    const canApprove = member !== null && member.role === 'client_approver' && member.brandId === caseStudy.brand_id && caseStudy.state === 'preview_sent';
    res.json({
      caseStudy: {
        id: caseStudy.id,
        title: caseStudy.title,
        sector: caseStudy.sector,
        location: caseStudy.location,
        summary: caseStudy.summary,
        body: caseStudy.body,
        coverUrl: `/media/covers/${caseStudy.slug}.svg`,
        slug: caseStudy.slug,
      },
      canApprove,
    });
  }));

  router.get('/api/public/case-studies', wrap(async (req, res) => {
    const sector = typeof req.query.sector === 'string' ? req.query.sector : null;
    let sql = "SELECT * FROM case_studies WHERE state = 'published'";
    const params: unknown[] = [];
    if (sector && SECTORS.includes(sector as never)) {
      params.push(sector);
      sql += ' AND sector = $1';
    }
    sql += ' ORDER BY published_seq DESC';
    const rows = await query<CaseStudyRow>(sql, params);
    res.json({
      caseStudies: await Promise.all(
        rows.map((row) => ({
          slug: row.slug,
          title: row.title,
          sector: row.sector,
          location: row.location,
          summary: row.summary,
          coverUrl: `/media/covers/${row.slug}.svg`,
        })),
      ),
    });
  }));

  router.get('/api/public/case-studies/:slug', wrap(async (req, res) => {
    const row = await one<CaseStudyRow>("SELECT * FROM case_studies WHERE slug = $1 AND state = 'published'", [req.params.slug]);
    if (!row) throw notFound();
    res.json({
      caseStudy: {
        slug: row.slug,
        title: row.title,
        sector: row.sector,
        location: row.location,
        summary: row.summary,
        body: row.body,
        coverUrl: `/media/covers/${row.slug}.svg`,
      },
    });
  }));

  router.get('/api/public/sectors', wrap(async (_req, res) => {
    const rows = await query<{ sector: string; count: string }>(
      "SELECT sector, count(*)::text AS count FROM case_studies WHERE state = 'published' GROUP BY sector",
    );
    const counts: Record<string, number> = { retail: 0, workplace: 0, food_beverage: 0 };
    let total = 0;
    for (const row of rows) {
      counts[row.sector] = parseInt(row.count, 10);
      total += parseInt(row.count, 10);
    }
    res.json({
      total,
      sectors: [
        { key: 'retail', label: SECTOR_LABELS.retail, count: counts.retail },
        { key: 'workplace', label: SECTOR_LABELS.workplace, count: counts.workplace },
        { key: 'food_beverage', label: SECTOR_LABELS.food_beverage, count: counts.food_beverage },
      ],
    });
  }));

  router.get('/api/public/featured', wrap(async (_req, res) => {
    const rows = await query<CaseStudyRow>(
      "SELECT * FROM case_studies WHERE state = 'published' AND featured = true ORDER BY featured_order",
    );
    res.json({
      caseStudies: await Promise.all(
        rows.map((row) => ({
          slug: row.slug,
          title: row.title,
          sector: row.sector,
          location: row.location,
          summary: row.summary,
          coverUrl: `/media/covers/${row.slug}.svg`,
        })),
      ),
    });
  }));

  // ---- Enquiries ----

  router.post('/api/enquiries', express.json({ limit: '65536b' }), wrap(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: Record<string, string> = {};
    const name = requireString(body.name, 'name', 'Your name', errors);
    if (name) {
      checkLength(name, 'name', 'Your name', 120, errors);
      checkOneLine(name, 'name', 'Your name', errors);
    }
    const company = requireString(body.company, 'company', 'Company', errors);
    if (company) {
      checkLength(company, 'company', 'Company', 120, errors);
      checkOneLine(company, 'company', 'Company', errors);
    }
    const email = requireString(body.email, 'email', 'Email', errors).trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = FIELD_ERRORS.badEmail('Email');
    const phone = typeof body.phone === 'string' ? body.phone : '';
    if (phone && phone.length > 30) errors.phone = FIELD_ERRORS.tooLong('Phone (optional)', 30);
    const sector = typeof body.sector === 'string' ? body.sector : '';
    if (!SECTORS.includes(sector as never)) errors.sector = FIELD_ERRORS.required('Sector');
    const region = typeof body.region === 'string' ? body.region : '';
    if (!['HK', 'SG', 'MO'].includes(region)) errors.region = FIELD_ERRORS.required('Region');
    const sites = body.sites;
    if (typeof sites !== 'number' || !Number.isInteger(sites) || sites < 1 || sites > 200) {
      errors.sites = FIELD_ERRORS.range('Number of sites', '1 and 200');
    }
    const openingMonth = typeof body.openingMonth === 'string' ? body.openingMonth : '';
    if (!/^\d{4}-\d{2}$/.test(openingMonth)) {
      errors.openingMonth = FIELD_ERRORS.required('Target opening month');
    } else {
      const now = new Date();
      const currentMonth = `${now.getUTCFullYear()}-${(now.getUTCMonth() + 1).toString().padStart(2, '0')}`;
      if (openingMonth < currentMonth) errors.openingMonth = FIELD_ERRORS.futureDate('Target opening month');
    }
    const message = requireString(body.message, 'message', 'Tell us about the rollout', errors);
    if (message) checkLength(message, 'message', 'Tell us about the rollout', 2000, errors);
    throwValidation(errors);
    // Rate limit: at most 3 accepted per email within the window.
    const recent = await query<{ created_at: Date }>(
      'SELECT created_at FROM enquiries WHERE lower(email) = $1 AND created_at > now() - ($2 || \' seconds\')::interval ORDER BY created_at',
      [email, config.timing.enquiryRateWindow],
    );
    if (recent.length >= 3) {
      const oldest = recent[0].created_at.getTime();
      const retrySeconds = Math.max(1, Math.ceil((oldest + config.timing.enquiryRateWindow * 1000 - Date.now()) / 1000));
      res.setHeader('Retry-After', String(retrySeconds));
      throw new ApiError(429, { error: 'rate_limited', retryAfterSeconds: retrySeconds });
    }
    const seq = await one<{ value: string }>(
      "INSERT INTO counter_state (name, value) VALUES ('enquiry_seq', 1) ON CONFLICT (name) DO UPDATE SET value = counter_state.value + 1 RETURNING value",
    );
    const reference = `ENQ-${parseInt(seq!.value, 10).toString().padStart(4, '0')}`;
    const id = randomUUID();
    await query(
      'INSERT INTO enquiries (id, reference, name, company, email, phone, sector, region, sites, opening_month, message) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [id, reference, name, company, email, phone || null, sector, region, sites, openingMonth, message],
    );
    // Notify each studio director, acknowledge the enquirer.
    const directors = await query<{ email: string; name: string }>(
      "SELECT email, name FROM members WHERE role = 'director' AND status = 'active'",
    );
    await queueMany(
      directors.map((director) => ({
        to: director.email,
        subject: `New enquiry from ${name} at ${company}`,
        replyTo: email,
        body: [
          `Enquiry ${reference}`,
          `Name: ${name}`,
          `Company: ${company}`,
          `Email: ${email}`,
          `Phone: ${phone || '—'}`,
          `Sector: ${SECTOR_LABELS[sector]}`,
          `Region: ${region}`,
          `Number of sites: ${sites}`,
          `Target opening month: ${openingMonth}`,
          `Message: ${message}`,
        ].join('\n'),
      })),
    );
    await queueMail({
      to: email,
      subject: "We've received your enquiry",
      body: [`Thanks ${name},`, `Your enquiry ${reference} is with our studio.`, `Here's a copy of your message:`, '', message].join('\n'),
    });
    res.status(201).json({ enquiry: { reference } });
  }));

  return router;
}

async function loadOptionalMember(req: express.Request) {
  const { loadSession } = await import('../lib/auth.js');
  try {
    const member = await loadSession(req, 43200);
    if (member && member.status === 'active') return member;
    return null;
  } catch {
    return null;
  }
}

export type { AuthedRequest };
