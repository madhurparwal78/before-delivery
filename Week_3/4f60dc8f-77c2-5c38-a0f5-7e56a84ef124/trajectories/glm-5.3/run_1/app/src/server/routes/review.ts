import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { App } from '../app';
import { ApiError } from '../errors';
import { newId, sha256, randomToken, loadEngagementRow, formatUtcDate, formatUtcTime } from '../domain';
import { beginIdempotency, finishIdempotency, releaseIdempotency, idempotencyKey } from '../idempotency';
import { requireStudio, setCookie } from '../middleware';
import { MILESTONE_LABELS } from '../types';
import type { Milestone, Review } from '../types';
import { canRequestRevision, canAcceptReview, acceptTarget, draftMilestoneOnAccept, reviewerPreconditions, canRegenerateLink, reviewMilestoneFor } from '../state';
import { stillKey } from '../services/storage';
import { brandReviewerEmail } from '../billing';

/**
 * Review link routes. The token is the capability; only its hash is stored.
 * Every route and page sends Referrer-Policy: no-referrer, and no money
 * amount ever reaches a review response.
 */

const REVIEW_REFERER = { 'Referrer-Policy': 'no-referrer' };

function param(req: { params: Record<string, string | string[]> }, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}

interface ReviewLinkRow {
  id: string;
  engagement_id: string;
  milestone: Milestone;
  token_hash: string;
  active: boolean;
  created_at: Date;
  expires_at: Date;
}

export function reviewRoutes(app: App): Router {
  const router = Router();

  router.use('/api/review', (req, res, next) => {
    res.set(REVIEW_REFERER);
    next();
  });

  async function loadLink(token: string): Promise<{ link: ReviewLinkRow; expired: boolean } | null> {
    const result = await app.pool.query(
      `SELECT * FROM review_links WHERE token_hash = $1 AND active = TRUE`,
      [sha256(token)],
    );
    if (result.rows.length === 0) {
      return null;
    }
    const link = result.rows[0] as unknown as ReviewLinkRow;
    // A link's age is measured by the server from its creation.
    const ageMs = Date.now() - new Date(link.created_at).getTime();
    const ttlMs = app.config.timers.reviewLinkTtlSeconds * 1000;
    const expired = ageMs > ttlMs;
    return { link, expired };
  }

  async function buildReview(link: ReviewLinkRow, token: string): Promise<Review> {
    const engagement = await loadEngagementRow(app.pool, link.engagement_id);
    if (engagement === null) {
      throw new ApiError('not_found');
    }
    const stills = await app.pool.query(
      `SELECT id, shot_code, milestone FROM stills WHERE engagement_id = $1 AND milestone = $2`,
      [link.engagement_id, link.milestone],
    );
    const quoteLines = await app.pool.query(
      `SELECT shot_code FROM quote_lines WHERE engagement_id = $1`,
      [link.engagement_id],
    );
    const lineSet = new Set(quoteLines.rows.map(row => row.shot_code as string));
    const services = await (await import('../domain')).loadServices(app);
    const titleByCode = new Map<string, string>();
    const lockedLines = await app.pool.query(
      `SELECT shot_code, locked_title FROM quote_lines WHERE engagement_id = $1`,
      [link.engagement_id],
    );
    for (const line of lockedLines.rows) {
      const service = services.find(s => s.code === line.shot_code);
      const title = engagement.quote_locked && line.locked_title ? line.locked_title : (service ? service.title : line.shot_code);
      titleByCode.set(line.shot_code, title);
    }
    const milestone = link.milestone;
    const roundsUsed = milestone === 'look_dev' ? engagement.rounds_look_dev : engagement.rounds_final_delivery;
    const actionsOpen = canRequestRevision(engagement.state, engagement.finals_out);
    const visible = stills.rows
      .filter(still => lineSet.has(still.shot_code))
      .map(still => ({
        id: still.id as string,
        shot_code: still.shot_code as string,
        title: titleByCode.get(still.shot_code) ?? still.shot_code,
        url: `/api/review/${token}/stills/${still.id}`,
      }));
    return {
      reference: engagement.reference,
      brand_name: engagement.brand_name,
      milestone,
      state: engagement.state,
      revision_rounds_used: roundsUsed,
      revision_rounds_included: 2,
      actions_open: actionsOpen,
      stills: visible,
    };
  }

  router.get('/api/review/:token', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const found = await loadLink(param(req, 'token'));
      if (!found || found.expired) {
        res.status(404).json({ error: 'not_found', message: 'We couldn\'t find that page' });
        return;
      }
      const review = await buildReview(found.link, param(req, 'token'));
      res.json(review);
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/review/:token/stills/:stillId', async (req: Request, res: Response) => {
    const found = await loadLink(param(req, 'token'));
    if (!found || found.expired) {
      res.status(404).json({ error: 'not_found', message: 'We couldn\'t find that page' });
      return;
    }
    const still = await app.pool.query(
      `SELECT * FROM stills WHERE id = $1 AND engagement_id = $2`,
      [param(req, 'stillId'), found.link.engagement_id],
    );
    if (still.rows.length === 0) {
      res.status(404).json({ error: 'not_found', message: 'We couldn\'t find that page' });
      return;
    }
    const record = still.rows[0];
    const ext = record.content_type === 'image/png' ? 'png' : 'jpg';
    const key = stillKey(found.link.engagement_id, record.milestone, record.id, ext);
    try {
      const stream = await app.storage.getObject(key);
      res.set(REVIEW_REFERER);
      res.set('Content-Type', record.content_type);
      res.set('Content-Length', String(record.size_bytes));
      res.set('Cache-Control', 'private, no-store');
      stream.pipe(res);
    } catch {
      res.status(503).json({ error: 'storage_unavailable', message: 'File storage is offline right now. Your file was not saved. Please try again in a few minutes.' });
    }
  });

  router.post('/api/review/:token/accept', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const found = await loadLink(param(req, 'token'));
      if (!found || found.expired) {
        res.status(404).json({ error: 'not_found', message: 'We couldn\'t find that page' });
        return;
      }
      const engagement = await loadEngagementRow(app.pool, found.link.engagement_id);
      if (engagement === null) {
        throw new ApiError('not_found');
      }
      const precondition = reviewerPreconditions(engagement.state, engagement.finals_out);
      if (precondition) {
        throw precondition;
      }
      const target = acceptTarget(engagement.state);
      if (target === null) {
        throw new ApiError('invalid_state');
      }
      const milestone = draftMilestoneOnAccept(engagement.state);
      const client = await app.pool.connect();
      try {
        await client.query('BEGIN');
        const claim = await client.query(
          `UPDATE engagements SET state = $2, finals_out = FALSE WHERE id = $1 AND state = $3 RETURNING *`,
          [engagement.id, target, engagement.state],
        );
        if (claim.rows.length === 0) {
          await client.query('ROLLBACK');
          throw new ApiError('invalid_state');
        }
        if (milestone) {
          await draftMilestoneInvoice(client, app, engagement, milestone);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      const review = await buildReview(found.link, param(req, 'token'));
      res.json(review);
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/review/:token/revisions', async (req: Request, res: Response, next: NextFunction) => {
    let scope = '';
    let key = '';
    try {
      const found = await loadLink(param(req, 'token'));
      // Token validity is judged before idempotency.
      if (!found || found.expired) {
        res.status(404).json({ error: 'not_found', message: 'We couldn\'t find that page' });
        return;
      }
      const engagement = await loadEngagementRow(app.pool, found.link.engagement_id);
      if (engagement === null) {
        throw new ApiError('not_found');
      }
      const keyRaw = idempotencyKey(req);
      if (keyRaw === null) {
        throw new ApiError('idempotency_key_required');
      }
      key = keyRaw;
      scope = `revision:${engagement.id}`;
      const bodyText = JSON.stringify(req.body ?? {});
      const outcome = await beginIdempotency(app, scope, key, bodyText);
      if (outcome.replay) {
        res.status(outcome.storedStatus ?? 201).json(outcome.storedBody ?? {});
        return;
      }
      const body = req.body as Record<string, unknown>;
      const note = typeof body.note === 'string' ? body.note : '';
      if (note.trim().length < 1 || note.length > 2000) {
        await releaseIdempotency(app, scope, key);
        throw new ApiError('validation_failed', { note: 'Describe what to change.' });
      }
      const precondition = reviewerPreconditions(engagement.state, engagement.finals_out);
      if (precondition) {
        await releaseIdempotency(app, scope, key);
        throw precondition;
      }
      const milestone = found.link.milestone;
      const roundsUsed = milestone === 'look_dev' ? engagement.rounds_look_dev : engagement.rounds_final_delivery;
      const nextRound = roundsUsed + 1;
      const changeOrder = nextRound > 2;
      const client = await app.pool.connect();
      try {
        await client.query('BEGIN');
        const claim = await client.query(
          `UPDATE engagements SET state = 'revision_requested',
            rounds_look_dev = CASE WHEN $2 = 'look_dev' THEN rounds_look_dev + 1 ELSE rounds_look_dev END,
            rounds_final_delivery = CASE WHEN $2 = 'final_delivery' THEN rounds_final_delivery + 1 ELSE rounds_final_delivery END
           WHERE id = $1 AND state = $3 RETURNING *`,
          [engagement.id, milestone, engagement.state],
        );
        if (claim.rows.length === 0) {
          await client.query('ROLLBACK');
          throw new ApiError('invalid_state');
        }
        if (changeOrder) {
          await addChangeOrderLine(client, app, engagement, milestone, nextRound);
        }
        await client.query(
          `INSERT INTO outbox (id, kind, payload) VALUES ($1, 'push', $2)`,
          [newId(), JSON.stringify({ type: 'revision_requested', engagement_id: engagement.id, milestone, round: nextRound })],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      const review = await buildReview(found.link, param(req, 'token'));
      const responseBody = { review, round: nextRound, change_order: changeOrder };
      await finishIdempotency(app, scope, key, 201, responseBody);
      res.status(201).json(responseBody);
    } catch (error) {
      if (error instanceof ApiError && error.status >= 500) {
        await releaseIdempotency(app, scope, key);
      } else if (error instanceof ApiError && scope && key) {
        await releaseIdempotency(app, scope, key);
      }
      next(error);
    }
  });

  return router;
}

export async function draftMilestoneInvoice(
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  app: App,
  engagement: { id: string; reference: string; fx_rate: string },
  milestone: Milestone,
): Promise<void> {
  const quote = await (await import('../domain')).buildQuote(app, engagement as never);
  const amount = milestone === 'look_dev' ? quote.milestones.look_dev_minor : quote.milestones.final_delivery_minor;
  const description = `${MILESTONE_LABELS[milestone]} ${engagement.reference}`;
  const existing = await client.query(
    `SELECT id FROM invoices WHERE engagement_id = $1 AND milestone = $2`,
    [engagement.id, milestone],
  );
  let invoiceId: string;
  if (existing.rows.length > 0) {
    invoiceId = existing.rows[0].id as string;
    await client.query(
      `UPDATE invoices SET amount_minor = $2, balance_minor = $2, status = 'draft' WHERE id = $1`,
      [invoiceId, amount],
    );
    await client.query(`DELETE FROM invoice_lines WHERE invoice_id = $1`, [invoiceId]);
  } else {
    invoiceId = newId();
    await client.query(
      `INSERT INTO invoices (id, engagement_id, milestone, status, amount_minor, balance_minor)
       VALUES ($1, $2, $3, 'draft', $4, $4)`,
      [invoiceId, engagement.id, milestone, amount],
    );
  }
  await client.query(
    `INSERT INTO invoice_lines (id, invoice_id, description, amount_minor) VALUES ($1, $2, $3, $4)`,
    [newId(), invoiceId, description, amount],
  );
  // Any change-order lines recorded for this milestone.
  const changeOrders = await client.query(
    `SELECT id, description, amount_minor FROM invoice_change_orders WHERE engagement_id = $1 AND milestone = $2 ORDER BY round ASC`,
    [engagement.id, milestone],
  );
  for (const order of changeOrders.rows) {
    await client.query(
      `INSERT INTO invoice_lines (id, invoice_id, description, amount_minor) VALUES ($1, $2, $3, $4)`,
      [newId(), invoiceId, order.description, Number(order.amount_minor)],
    );
    const newAmount = amount + Number(order.amount_minor);
    await client.query(`UPDATE invoices SET amount_minor = $2, balance_minor = $2 WHERE id = $1`, [invoiceId, newAmount]);
  }
}

export async function addChangeOrderLine(
  client: { query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  app: App,
  engagement: { id: string; reference: string; fx_rate: string; brand_currency: 'EUR' | 'GBP' | 'USD' | 'JPY' },
  milestone: Milestone,
  round: number,
): Promise<void> {
  const amount = await (await import('../billing')).changeOrderAmountMinor(engagement.fx_rate, engagement.brand_currency);
  const description = await (await import('../billing')).changeOrderDescription(milestone, round, engagement.reference);
  await client.query(
    `INSERT INTO invoice_change_orders (id, engagement_id, milestone, round, description, amount_minor)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [newId(), engagement.id, milestone, round, description, amount],
  );
}

export function reviewUrlFor(app: App, token: string): string {
  return `${app.config.publicUrl}/review/${token}`;
}

export function linkExpiry(app: App): Date {
  return new Date(Date.now() + app.config.timers.reviewLinkTtlSeconds * 1000);
}

export function createReviewToken(): string {
  return randomToken(32);
}

export { requireStudio, setCookie, canRegenerateLink, reviewMilestoneFor, formatUtcDate, formatUtcTime, brandReviewerEmail, sha256 };
