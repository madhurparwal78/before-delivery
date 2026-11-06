import { randomBytes } from 'node:crypto';
import { HK_ZONE, SECTORS, type CaseStudyState, type Sector } from '../../shared/domain.js';
import { fieldErrorCopy } from '../../shared/fieldErrors.js';
import { formatInstant } from '../../shared/format.js';
import { instantOfWallClock, parseWallClockMinutes } from '../../shared/zoned.js';
import { config } from '../config.js';
import { newId } from '../db/ids.js';
import { firstRow, pool, rows, transact, type Queryable } from '../db/pool.js';
import { requireUuid } from '../domain/access.js';
import { caseStudyAllows, caseStudyStateAfter } from '../domain/transitions.js';
import { Fields } from '../domain/validate.js';
import { jsonReply, noContent, type Reply } from '../http/context.js';
import { conflict, forbidden, illegalTransition, notFound } from '../http/errors.js';
import type { Router } from '../http/router.js';
import { nudgeMailDelivery, queueMail } from '../services/mail.js';

const SLUG = /^[a-z0-9-]{3,80}$/;

interface CaseStudyRow {
  id: string;
  title: string;
  slug: string;
  sector: Sector;
  brand_id: string;
  brand_name: string;
  location: string;
  summary: string;
  body: string;
  featured: boolean;
  featured_order: number | null;
  state: CaseStudyState;
  published_at: string | null;
}

const CASE_STUDY_SELECT = `
  SELECT cs.id, cs.title, cs.slug, cs.sector, cs.brand_id, b.name AS brand_name, cs.location,
         cs.summary, cs.body, cs.featured, cs.featured_order, cs.state, cs.published_at
    FROM case_studies cs JOIN brands b ON b.id = cs.brand_id`;

async function previewLinksOf(client: Queryable, caseStudyId: string): Promise<unknown[]> {
  const found = await rows<{ id: string; token: string; expires_at: string; revoked_at: string | null }>(
    client,
    `SELECT id, token, expires_at, revoked_at FROM preview_links WHERE case_study_id = $1
      ORDER BY created_at DESC`,
    [caseStudyId],
  );
  return found.map((link) => ({
    id: link.id,
    url: `${config.baseUrl}/preview/${link.token}`,
    expiresAt: new Date(link.expires_at).toISOString(),
    revoked: link.revoked_at !== null,
  }));
}

async function caseStudyPayload(client: Queryable, row: CaseStudyRow): Promise<unknown> {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    sector: row.sector,
    brand: { id: row.brand_id, name: row.brand_name },
    location: row.location,
    summary: row.summary,
    body: row.body,
    featured: row.featured,
    featuredOrder: row.featured_order,
    state: row.state,
    publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
    coverUrl: `/media/covers/${row.slug}.svg`,
    previewLinks: await previewLinksOf(client, row.id),
  };
}

async function loadCaseStudy(id: string): Promise<CaseStudyRow> {
  const row = await firstRow<CaseStudyRow>(pool, `${CASE_STUDY_SELECT} WHERE cs.id = $1`, [
    requireUuid(id),
  ]);
  if (!row) throw notFound();
  return row;
}

export function registerCaseStudyRoutes(router: Router): void {
  router.get('/api/case-studies', async (context): Promise<Reply> => {
    await context.memberWithRole('director');
    const found = await rows<CaseStudyRow>(
      pool,
      `${CASE_STUDY_SELECT} ORDER BY cs.featured_order NULLS LAST, cs.created_at DESC`,
    );
    return jsonReply(200, {
      caseStudies: await Promise.all(found.map((row) => caseStudyPayload(pool, row))),
    });
  });

  router.post('/api/case-studies', async (context): Promise<Reply> => {
    await context.memberWithRole('director');
    const body = await context.json();

    if (typeof body.slug === 'string') {
      const clash = await firstRow(pool, 'SELECT 1 FROM case_studies WHERE slug = $1', [body.slug]);
      if (clash) throw conflict('slug_exists');
    }

    const fields = new Fields();
    const title = fields.text('title', body.title, { label: 'Title', max: 120, oneLine: true });
    const slug = typeof body.slug === 'string' ? body.slug : '';
    if (!SLUG.test(slug)) fields.add('slug', fieldErrorCopy.required('Slug'));
    const sector = fields.enumeration<Sector>('sector', body.sector, 'Sector', SECTORS);
    const location = fields.text('location', body.location, {
      label: 'Location',
      max: 120,
      oneLine: true,
    });
    const summary = fields.text('summary', body.summary, { label: 'Summary', max: 400 });
    const text = fields.text('body', body.body, { label: 'Body', max: 8000 });
    let brandId = '';
    if (typeof body.brandId !== 'string') {
      fields.add('brandId', fieldErrorCopy.required('Brand'));
    } else {
      const brand = await firstRow(pool, 'SELECT 1 FROM brands WHERE id = $1', [
        requireUuid(body.brandId),
      ]);
      if (!brand) fields.add('brandId', fieldErrorCopy.required('Brand'));
      else brandId = body.brandId;
    }
    fields.finish();

    const featured = body.featured === true;
    const caseStudyId = newId();
    const nextOrder = featured
      ? ((
          await firstRow<{ next: number }>(
            pool,
            'SELECT COALESCE(MAX(featured_order), 0) + 1 AS next FROM case_studies',
          )
        )?.next ?? 1)
      : null;
    await pool.query(
      `INSERT INTO case_studies (id, title, slug, sector, brand_id, location, summary, body,
                                 featured, featured_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        caseStudyId,
        title,
        slug,
        sector,
        brandId,
        location,
        summary,
        text,
        featured,
        nextOrder,
      ],
    );
    return jsonReply(201, { caseStudy: await caseStudyPayload(pool, await loadCaseStudy(caseStudyId)) });
  });

  router.post('/api/case-studies/:id/preview-links', async (context): Promise<Reply> => {
    await context.memberWithRole('director');
    const study = await loadCaseStudy(context.param('id'));
    if (!caseStudyAllows(study.state, 'send_preview')) {
      throw illegalTransition(study.state, 'send_preview');
    }

    const body = await context.json();
    const fields = new Fields();
    const wall = typeof body.expiresAt === 'string' ? parseWallClockMinutes(body.expiresAt) : null;
    const instant = wall ? instantOfWallClock(wall, HK_ZONE) : null;
    if (!instant) {
      fields.add('expiresAt', fieldErrorCopy.required('Link expires at'));
    } else if (instant.getTime() <= Date.now()) {
      fields.add('expiresAt', fieldErrorCopy.expiryNotAfterNow());
    }
    fields.finish();
    if (!instant) throw notFound();

    const token = randomBytes(32).toString('base64url');
    const linkId = newId();
    const approvers = await rows<{ email: string }>(
      pool,
      `SELECT email FROM members WHERE role = 'client_approver' AND brand_id = $1
         AND status = 'active' ORDER BY name`,
      [study.brand_id],
    );

    await transact(async (client) => {
      await client.query(
        'UPDATE preview_links SET revoked_at = now() WHERE case_study_id = $1 AND revoked_at IS NULL',
        [study.id],
      );
      await client.query(
        'INSERT INTO preview_links (id, case_study_id, token, expires_at) VALUES ($1, $2, $3, $4)',
        [linkId, study.id, token, instant],
      );
      await client.query(
        `UPDATE case_studies SET state = $2 WHERE id = $1`,
        [study.id, caseStudyStateAfter('send_preview')],
      );
      for (const approver of approvers) {
        await queueMail(client, {
          to: approver.email,
          subject: `Case study preview: ${study.title}`,
          body: [
            `Marrow Hall Interiors would like your approval to publish "${study.title}".`,
            '',
            'Read the preview here:',
            `${config.baseUrl}/preview/${token}`,
            '',
            `The link works until ${formatInstant(instant, HK_ZONE)}.`,
          ].join('\n'),
        });
      }
    });
    nudgeMailDelivery();

    return jsonReply(201, {
      previewLink: {
        id: linkId,
        url: `${config.baseUrl}/preview/${token}`,
        expiresAt: instant.toISOString(),
      },
      approversNotified: approvers.length,
    });
  });

  router.delete('/api/preview-links/:id', async (context): Promise<Reply> => {
    await context.memberWithRole('director');
    const link = await firstRow<{ id: string }>(
      pool,
      'SELECT id FROM preview_links WHERE id = $1',
      [requireUuid(context.param('id'))],
    );
    if (!link) throw notFound();
    await pool.query('UPDATE preview_links SET revoked_at = now() WHERE id = $1', [link.id]);
    return noContent();
  });

  router.get('/api/preview/:token', async (context): Promise<Reply> => {
    const row = await firstRow<CaseStudyRow>(
      pool,
      `${CASE_STUDY_SELECT}
         JOIN preview_links pl ON pl.case_study_id = cs.id
        WHERE pl.token = $1 AND pl.revoked_at IS NULL AND pl.expires_at > now()
          AND cs.state <> 'withdrawn'`,
      [context.param('token')],
    );
    if (!row) throw notFound();

    let canApprove = false;
    const token = context.sessionToken;
    if (token) {
      const viewer = await context.member().catch(() => null);
      canApprove =
        viewer !== null &&
        viewer.role === 'client_approver' &&
        viewer.brandId === row.brand_id &&
        row.state === 'preview_sent';
    }

    return jsonReply(200, {
      caseStudy: {
        id: row.id,
        title: row.title,
        slug: row.slug,
        sector: row.sector,
        location: row.location,
        summary: row.summary,
        body: row.body,
        state: row.state,
        coverUrl: `/media/covers/${row.slug}.svg`,
      },
      canApprove,
    });
  });

  router.post('/api/case-studies/:id/approve', async (context): Promise<Reply> => {
    const member = await context.member();
    const study = await loadCaseStudy(context.param('id'));
    if (member.role !== 'client_approver') throw forbidden();
    if (member.brandId !== study.brand_id) throw notFound();
    if (!caseStudyAllows(study.state, 'approve')) throw illegalTransition(study.state, 'approve');
    await pool.query('UPDATE case_studies SET state = $2 WHERE id = $1 AND state = $3', [
      study.id,
      caseStudyStateAfter('approve'),
      study.state,
    ]);
    return jsonReply(200, { caseStudy: await caseStudyPayload(pool, await loadCaseStudy(study.id)) });
  });

  router.post('/api/case-studies/:id/publish', async (context): Promise<Reply> => {
    await context.memberWithRole('director');
    const study = await loadCaseStudy(context.param('id'));
    if (!caseStudyAllows(study.state, 'publish')) throw illegalTransition(study.state, 'publish');
    await pool.query(
      'UPDATE case_studies SET state = $2, published_at = now() WHERE id = $1 AND state = $3',
      [study.id, caseStudyStateAfter('publish'), study.state],
    );
    return jsonReply(200, { caseStudy: await caseStudyPayload(pool, await loadCaseStudy(study.id)) });
  });

  router.post('/api/case-studies/:id/withdraw', async (context): Promise<Reply> => {
    await context.memberWithRole('director');
    const study = await loadCaseStudy(context.param('id'));
    if (!caseStudyAllows(study.state, 'withdraw')) throw illegalTransition(study.state, 'withdraw');
    await transact(async (client) => {
      await client.query('UPDATE case_studies SET state = $2 WHERE id = $1 AND state = $3', [
        study.id,
        caseStudyStateAfter('withdraw'),
        study.state,
      ]);
      await client.query(
        'UPDATE preview_links SET revoked_at = now() WHERE case_study_id = $1 AND revoked_at IS NULL',
        [study.id],
      );
    });
    return jsonReply(200, { caseStudy: await caseStudyPayload(pool, await loadCaseStudy(study.id)) });
  });
}
