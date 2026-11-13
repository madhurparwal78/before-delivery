import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { App } from '../app';
import { ApiError } from '../errors';
import { newId, sha256, randomToken, loadEngagement, loadEngagementRow, buildQuote } from '../domain';
import { requireStudio } from '../middleware';
import { MILESTONE_LABELS } from '../types';
import type { CaseStudy, Milestone, ServiceRecord } from '../types';
import { stillKey } from '../services/storage';
import { canSendForReview, canRegenerateLink, canCancel, canPostStills, reviewMilestoneFor } from '../state';
import { formatMoney } from '../money';
import { brandReviewerEmail, changeOrderAmountMinor, changeOrderDescription, shareLineDescription, invoiceHtml, escapeHtml } from '../billing';
import { cancelEngagement } from '../cancel';
import { refreshOverdue } from '../invoices';
import { createReviewToken, linkExpiry, reviewUrlFor } from './review';
import { formatUtcDate, formatUtcTime } from '../domain';

/**
 * Studio routes for the founder. Issue concurrency (one issue per invoice),
 * review-link creation and content management are decided here.
 */

function param(req: { params: Record<string, string | string[]> }, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}

export function studioRoutes(app: App): Router {
  const router = Router();

  router.use('/api/studio', requireStudio(app));
  // Studio sign-in lives in the public routes.

  router.get('/api/studio/health', async (_req, res) => {
    const statuses = await app.statuses.get(app);
    res.json({
      postgres: statuses.postgres,
      killbill: statuses.killbill,
      minio: statuses.minio,
      mailpit: statuses.mailpit,
      pocketbase: statuses.pocketbase,
      rabbitmq: statuses.rabbitmq,
      gotenberg: statuses.gotenberg,
      meilisearch: statuses.meilisearch,
      ntfy: statuses.ntfy,
    });
  });

  router.get('/api/studio/engagements', async (_req, res) => {
    const result = await app.pool.query(
      `SELECT e.id, e.reference, e.title, e.state, b.name AS brand_name
       FROM engagements e JOIN brands b ON b.id = e.brand_id ORDER BY e.reference ASC`,
    );
    res.json({ engagements: result.rows });
  });

  router.get('/api/studio/engagements/:id', async (req, res) => {
    const row = await loadEngagementRow(app.pool, param(req, 'id'));
    if (row === null) {
      throw new ApiError('not_found');
    }
    await refreshOverdue(app, row);
    const engagement = await loadEngagement(app, row.id, { onlyIssuedInvoices: false });
    const stills = await app.pool.query(
      `SELECT id, shot_code, milestone FROM stills WHERE engagement_id = $1 ORDER BY created_at ASC`,
      [row.id],
    );
    const link = await app.pool.query(
      `SELECT expires_at FROM review_links WHERE engagement_id = $1 AND active = TRUE ORDER BY created_at DESC LIMIT 1`,
      [row.id],
    );
    res.json({
      ...engagement,
      stills: stills.rows,
      review_link: link.rows.length > 0 ? { expires_at: new Date(link.rows[0].expires_at).toISOString() } : null,
    });
  });

  router.get('/api/studio/engagements/:id/files/:fileId/content', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const row = await loadEngagementRow(app.pool, param(req, 'id'));
      if (row === null) {
        throw new ApiError('not_found');
      }
      const file = await app.pool.query(
        `SELECT * FROM intake_files WHERE id = $1 AND engagement_id = $2`,
        [param(req, 'fileId'), param(req, 'id')],
      );
      if (file.rows.length === 0) {
        throw new ApiError('not_found');
      }
      const record = file.rows[0];
      const ext = record.kind === 'model' ? 'glb' : record.kind === 'step' ? 'step' : 'pdf';
      const key = `intake/${param(req, 'id')}/${record.id}.${ext}`;
      try {
        const stream = await app.storage.getObject(key);
        res.setHeader('Content-Type', record.kind === 'model' ? 'model/gltf-binary' : record.kind === 'step' ? 'model/step' : 'application/pdf');
        res.setHeader('Content-Length', String(record.size_bytes));
        res.setHeader('Content-Disposition', studioDownloadDisposition(record.name));
        stream.pipe(res);
      } catch {
        throw new ApiError('storage_unavailable');
      }
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/studio/engagements/:id/stills', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const row = await loadEngagementRow(app.pool, param(req, 'id'));
      if (row === null) {
        throw new ApiError('not_found');
      }
      if (!canPostStills(row.state)) {
        throw new ApiError('invalid_state');
      }
      const body = req.body as Record<string, unknown>;
      const shotCode = typeof body.shot_code === 'string' ? body.shot_code : '';
      const milestone = typeof body.milestone === 'string' ? body.milestone : '';
      if (milestone !== 'look_dev' && milestone !== 'final_delivery') {
        throw new ApiError('validation_failed', { milestone: 'Choose look_dev or final_delivery.' });
      }
      const line = await app.pool.query(
        `SELECT 1 FROM quote_lines WHERE engagement_id = $1 AND shot_code = $2`,
        [row.id, shotCode],
      );
      if (line.rows.length === 0) {
        throw new ApiError('validation_failed', { shot_code: 'Choose a shot in this engagement\'s quote.' });
      }
      // The still bytes arrive as base64 JSON for studio uploads.
      const data = typeof body.data === 'string' ? Buffer.from(body.data, 'base64') : null;
      if (!data || data.length === 0) {
        throw new ApiError('validation_failed', { shot_code: 'Choose a shot in this engagement\'s quote.' });
      }
      const isPng = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const isJpeg = data.subarray(0, 3).toString('hex') === 'ffd8ff';
      if (!isPng && !isJpeg) {
        throw new ApiError('file_type_mismatch');
      }
      if (data.length > 20_000_000) {
        throw new ApiError('file_too_large');
      }
      const contentType = isPng ? 'image/png' : 'image/jpeg';
      const stillId = newId();
      const ext = isPng ? 'png' : 'jpg';
      const key = stillKey(row.id, milestone, stillId, ext);
      const { Readable } = await import('node:stream');
      try {
        await app.storage.putObject(key, Readable.from([data]), data.length, contentType);
        await app.storage.statObject(key);
      } catch {
        throw new ApiError('storage_unavailable');
      }
      const client = await app.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `DELETE FROM stills WHERE engagement_id = $1 AND shot_code = $2 AND milestone = $3`,
          [row.id, shotCode, milestone],
        );
        await client.query(
          `INSERT INTO stills (id, engagement_id, shot_code, milestone, content_type, size_bytes) VALUES ($1, $2, $3, $4, $5, $6)`,
          [stillId, row.id, shotCode, milestone, contentType, data.length],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
      res.status(201).json({ id: stillId, shot_code: shotCode, milestone });
    } catch (error) {
      next(error);
    }
  });

  async function createLink(row: { id: string }, milestone: Milestone): Promise<{ url: string; expires_at: string; reviewer_email: string }> {
    const token = createReviewToken();
    const expiresAt = linkExpiry(app);
    const reviewerEmail = await brandReviewerEmail(app, (await loadEngagementRow(app.pool, row.id))?.brand_id ?? '');
    const client = await app.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE review_links SET active = FALSE WHERE engagement_id = $1`, [row.id]);
      await client.query(
        `INSERT INTO review_links (id, engagement_id, token_hash, milestone, active, expires_at)
         VALUES ($1, $2, $3, $4, TRUE, $5)`,
        [newId(), row.id, sha256(token), milestone, expiresAt.toISOString()],
      );
      const url = reviewUrlFor(app, token);
      await client.query(
        `INSERT INTO outbox (id, kind, payload) VALUES ($1, 'email', $2)`,
        [newId(), JSON.stringify({
          type: 'review_link',
          engagement_id: row.id,
          milestone,
          review_url: url,
          expires_at: expiresAt.toISOString(),
          reviewer_email: reviewerEmail,
        })],
      );
      await client.query('COMMIT');
      return { url, expires_at: expiresAt.toISOString(), reviewer_email: reviewerEmail };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  router.post('/api/studio/engagements/:id/send-for-review', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const row = await loadEngagementRow(app.pool, param(req, 'id'));
      if (row === null) {
        throw new ApiError('not_found');
      }
      // Determine the milestone from the state and the rounds used.
      const lookDevRounds = row.rounds_look_dev;
      let milestone: Milestone;
      if (row.state === 'deposit_paid') {
        const lookDevInvoice = await app.pool.query(
          `SELECT status FROM invoices WHERE engagement_id = $1 AND milestone = 'look_dev'`,
          [row.id],
        );
        // Sending finals for review needs the look-dev invoice paid.
        if (lookDevInvoice.rows.length > 0) {
          if (lookDevInvoice.rows[0].status !== 'paid') {
            throw new ApiError('look_dev_unpaid');
          }
          milestone = 'final_delivery';
        } else {
          milestone = 'look_dev';
        }
      } else if (row.state === 'revision_requested') {
        // Whichever milestone the current round belongs to.
        const previous = await app.pool.query(
          `SELECT milestone FROM review_links WHERE engagement_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [row.id],
        );
        if (previous.rows.length > 0) {
          milestone = previous.rows[0].milestone as Milestone;
        } else {
          milestone = lookDevRounds > 0 ? 'look_dev' : 'final_delivery';
        }
      } else if (row.state === 'final_review' && row.finals_out === false) {
        // First send of finals: the look-dev invoice must be paid.
        const lookDevInvoice = await app.pool.query(
          `SELECT status FROM invoices WHERE engagement_id = $1 AND milestone = 'look_dev'`,
          [row.id],
        );
        if (lookDevInvoice.rows.length === 0 || lookDevInvoice.rows[0].status !== 'paid') {
          throw new ApiError('look_dev_unpaid');
        }
        milestone = 'final_delivery';
      } else {
        throw new ApiError('invalid_state');
      }
      // A still for every quote line in that milestone.
      const lines = await app.pool.query(
        `SELECT shot_code FROM quote_lines WHERE engagement_id = $1`,
        [row.id],
      );
      const stills = await app.pool.query(
        `SELECT shot_code FROM stills WHERE engagement_id = $1 AND milestone = $2`,
        [row.id, milestone],
      );
      const stillSet = new Set(stills.rows.map(s => s.shot_code as string));
      const missing = lines.rows.filter(line => !stillSet.has(line.shot_code));
      if (missing.length > 0) {
        throw new ApiError('stills_missing');
      }
      const link = await createLink(row, milestone);
      let targetState: string;
      let finalsOut = false;
      if (row.state === 'revision_requested') {
        if (milestone === 'final_delivery') {
          targetState = 'final_review';
          finalsOut = true;
        } else {
          targetState = 'look_dev_review';
        }
      } else if (row.state === 'deposit_paid') {
        targetState = 'look_dev_review';
      } else {
        targetState = 'final_review';
        finalsOut = true;
      }
      await app.pool.query(
        `UPDATE engagements SET state = $2, finals_out = $3 WHERE id = $1`,
        [row.id, targetState, finalsOut],
      );
      const engagement = await loadEngagement(app, row.id, { onlyIssuedInvoices: false });
      res.json({ engagement, review_url: link.url, expires_at: link.expires_at });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/studio/engagements/:id/review-link', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const row = await loadEngagementRow(app.pool, param(req, 'id'));
      if (row === null) {
        throw new ApiError('not_found');
      }
      if (!canRegenerateLink(row.state, row.finals_out)) {
        throw new ApiError('invalid_state');
      }
      const previous = await app.pool.query(
        `SELECT milestone FROM review_links WHERE engagement_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [row.id],
      );
      let milestone: Milestone;
      if (previous.rows.length > 0) {
        milestone = reviewMilestoneFor(row.state, row.finals_out, previous.rows[0].milestone as Milestone);
      } else {
        milestone = row.state === 'final_review' ? 'final_delivery' : 'look_dev';
      }
      const link = await createLink(row, milestone);
      res.status(201).json({ review_url: link.url, expires_at: link.expires_at });
    } catch (error) {
      next(error);
    }
  });

  router.delete('/api/studio/engagements/:id/review-link', async (req: Request, res: Response) => {
    await app.pool.query(`UPDATE review_links SET active = FALSE WHERE engagement_id = $1`, [param(req, 'id')]);
    res.status(204).end();
  });

  router.post('/api/studio/invoices/:invoiceId/issue', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invoiceResult = await app.pool.query(`SELECT * FROM invoices WHERE id = $1`, [param(req, 'invoiceId')]);
      if (invoiceResult.rows.length === 0) {
        throw new ApiError('not_found');
      }
      const invoice = invoiceResult.rows[0];
      if (invoice.status !== 'draft') {
        throw new ApiError('invalid_state');
      }
      const row = await loadEngagementRow(app.pool, invoice.engagement_id);
      if (row === null) {
        throw new ApiError('not_found');
      }
      // Claim the issue: exactly one issue request succeeds.
      const claim = await app.pool.query(
        `UPDATE invoices SET status = 'issued', issued_at = now() WHERE id = $1 AND status = 'draft' RETURNING *`,
        [invoice.id],
      );
      if (claim.rows.length === 0) {
        throw new ApiError('invalid_state');
      }
      const financeEmail = await (await import('../billing')).brandFinanceEmail(app, row.brand_id);
      let accountId: string;
      try {
        accountId = await app.killbill.ensureAccount(row.brand_id, row.brand_name, financeEmail, row.brand_currency);
      } catch {
        await app.pool.query(`UPDATE invoices SET status = 'draft', issued_at = NULL WHERE id = $1`, [invoice.id]);
        throw new ApiError('billing_unavailable');
      }
      const quote = await buildQuote(app, row);
      const lines = await app.pool.query(
        `SELECT description, amount_minor FROM invoice_lines WHERE invoice_id = $1 ORDER BY created_at ASC`,
        [invoice.id],
      );
      const invoiceLines = lines.rows.map(line => ({ description: line.description, amount: Number(line.amount_minor) }));
      const currency = row.brand_currency;
      const exponent = (await import('../money')).CURRENCIES[currency].exponent;
      let killbillInvoiceId: string | null = invoice.killbill_invoice_id;
      let number = invoice.number;
      try {
        if (killbillInvoiceId === null) {
          // An interrupted earlier issue may have created the Kill Bill invoice already.
          const shareDescription = lines.rows[0]?.description as string | undefined;
          const found = shareDescription ? await app.killbill.findInvoiceByDescription(accountId, shareDescription) : null;
          if (found) {
            killbillInvoiceId = found;
            const kbInvoice = await app.killbill.getInvoice(found);
            number = kbInvoice.invoiceNumber;
          } else {
            const created = await app.killbill.createInvoice(
              accountId, currency, exponent, invoiceLines, `${row.id}:${invoice.milestone}`,
            );
            killbillInvoiceId = created.invoiceId;
            number = created.invoiceNumber;
          }
          await app.pool.query(
            `UPDATE invoices SET killbill_invoice_id = $2, number = $3 WHERE id = $1`,
            [invoice.id, killbillInvoiceId, number],
          );
        } else {
          const kbInvoice = await app.killbill.getInvoice(killbillInvoiceId);
          number = kbInvoice.invoiceNumber;
          await app.pool.query(`UPDATE invoices SET number = $2 WHERE id = $1`, [invoice.id, number]);
        }
      } catch {
        await app.pool.query(`UPDATE invoices SET status = 'draft', issued_at = NULL, killbill_invoice_id = NULL WHERE id = $1`, [invoice.id]);
        throw new ApiError('billing_unavailable');
      }
      // The invoice-issued email waits for its PDF.
      const pdfBase64 = await renderInvoicePdf(app, row, { number, lines: invoiceLines, amount_minor: Number(invoice.amount_minor) }, quote);
      await app.pool.query(
        `INSERT INTO outbox (id, kind, payload) VALUES ($1, 'email', $2)`,
        [newId(), JSON.stringify({
          type: 'invoice_issued',
          engagement_id: row.id,
          invoice_id: invoice.id,
          pdf: pdfBase64,
        })],
      );
      const fresh = await app.pool.query(`SELECT * FROM invoices WHERE id = $1`, [invoice.id]);
      const freshLines = await app.pool.query(
        `SELECT description, amount_minor FROM invoice_lines WHERE invoice_id = $1 ORDER BY created_at ASC`,
        [invoice.id],
      );
      const { serializeInvoice } = await import('../domain');
      const serialized = serializeInvoice({ ...fresh.rows[0], currency }, []);
      serialized.lines = freshLines.rows.map(l => ({ description: l.description, amount_minor: Number(l.amount_minor) }));
      res.json(serialized);
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/studio/engagements/:id/cancel', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Record<string, unknown>;
      const refundMinor = typeof body.refund_minor === 'number' ? body.refund_minor : NaN;
      const result = await cancelEngagement(app, param(req, 'id'), refundMinor);
      const engagement = await loadEngagement(app, param(req, 'id'), { onlyIssuedInvoices: false });
      res.json({
        engagement,
        ledger_entries: engagement?.ledger.filter(entry => entry.kind === 'refund') ?? [],
        refunds: result.refunds,
        voided_invoice_ids: result.voidedInvoiceIds,
        paid_minor: result.paidMinor,
        refunded_minor: result.refundedMinor,
        retained_minor: result.retainedMinor,
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/studio/fx-rates', async (_req, res) => {
    const rates = await app.pool.query(
      `SELECT DISTINCT ON (currency) currency, rate, effective_at FROM fx_rates
       WHERE effective_at <= now() ORDER BY currency, effective_at DESC, created_at DESC`,
    );
    const scheduled = await app.pool.query(
      `SELECT currency, rate, effective_at FROM fx_rates WHERE effective_at > now() ORDER BY effective_at ASC, created_at ASC`,
    );
    res.json({
      rates: rates.rows.map(row => ({ currency: row.currency, rate: row.rate, effective_at: new Date(row.effective_at).toISOString() })),
      scheduled: scheduled.rows.map(row => ({ currency: row.currency, rate: row.rate, effective_at: new Date(row.effective_at).toISOString() })),
    });
  });

  router.post('/api/studio/fx-rates', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Record<string, unknown>;
      const currency = typeof body.currency === 'string' ? body.currency : '';
      const rate = typeof body.rate === 'string' ? body.rate : '';
      const effectiveAtRaw = typeof body.effective_at === 'string' ? body.effective_at : null;
      if (!['EUR', 'USD', 'JPY'].includes(currency)) {
        throw new ApiError('validation_failed', { currency: 'Choose EUR, USD or JPY.' });
      }
      const { isRate } = await import('../domain');
      if (!isRate(rate)) {
        throw new ApiError('validation_failed', { rate: 'Enter a rate between 0.0001 and 1000 with up to four decimals.' });
      }
      const effectiveAt = effectiveAtRaw ? new Date(effectiveAtRaw) : new Date();
      if (Number.isNaN(effectiveAt.getTime())) {
        throw new ApiError('validation_failed', { effective_at: 'Enter a time that is now or later.' });
      }
      if (effectiveAt.getTime() < Date.now() - 2_000) {
        throw new ApiError('validation_failed', { effective_at: 'Enter a time that is now or later.' });
      }
      await app.pool.query(
        `INSERT INTO fx_rates (id, currency, rate, effective_at) VALUES ($1, $2, $3, $4)`,
        [newId(), currency, rate, effectiveAt.toISOString()],
      );
      res.status(201).json({ currency, rate, effective_at: effectiveAt.toISOString() });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/api/studio/services/:code', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Record<string, unknown>;
      const fields: Partial<ServiceRecord> = {};
      if (typeof body.title === 'string') {
        if (body.title.trim().length < 1 || body.title.trim().length > 60) {
          throw new ApiError('validation_failed', { title: 'Use 1 to 60 characters.' });
        }
        fields.title = body.title.trim();
      }
      if (body.list_price_pence !== undefined) {
        const price = Number(body.list_price_pence);
        if (!Number.isInteger(price) || price < 1 || price > 10_000_000) {
          throw new ApiError('validation_failed', { list_price_pence: 'Enter a whole number of pence from 1 to 10000000.' });
        }
        fields.list_price_pence = price;
      }
      await app.pocketbase.updateService(param(req, 'code'), fields);
      const services = await app.pocketbase.getServices();
      const service = services.find(s => s.code === param(req, 'code'));
      if (!service) {
        throw new ApiError('not_found');
      }
      await reindexSearch(app);
      res.json(service);
    } catch (error) {
      if (error instanceof ApiError) {
        next(error);
        return;
      }
      next(new ApiError('content_unavailable'));
    }
  });

  router.get('/api/studio/work', async (_req, res, next) => {
    try {
      const studies = await app.pocketbase.getCaseStudies(true);
      res.json({ case_studies: studies });
    } catch {
      next(new ApiError('content_unavailable'));
    }
  });

  router.post('/api/studio/work', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Record<string, unknown>;
      const study = validateCaseStudy(body);
      const existing = await app.pocketbase.getCaseStudies(true);
      if (existing.some(s => s.slug === study.slug)) {
        throw new ApiError('slug_taken');
      }
      await app.pocketbase.createCaseStudy(study);
      await reindexSearch(app);
      res.status(201).json(study);
    } catch (error) {
      if (error instanceof ApiError) {
        next(error);
        return;
      }
      next(new ApiError('content_unavailable'));
    }
  });

  router.patch('/api/studio/work/:slug', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as Record<string, unknown>;
      const fields: Partial<CaseStudy> = {};
      if (typeof body.title === 'string') {
        fields.title = body.title.trim();
      }
      if (typeof body.client === 'string') {
        fields.client = body.client.trim();
      }
      if (typeof body.summary === 'string') {
        fields.summary = body.summary;
      }
      if (typeof body.published === 'boolean') {
        fields.published = body.published;
      }
      if (typeof body.sort === 'number') {
        fields.sort = body.sort;
      }
      if (body.scene !== undefined && typeof body.scene === 'object' && body.scene !== null) {
        const scene = body.scene as { primitives?: unknown; accent?: unknown };
        fields.scene = {
          primitives: Array.isArray(scene.primitives) ? (scene.primitives as string[]) : [],
          accent: typeof scene.accent === 'string' ? scene.accent : 'ember',
        };
      }
      const studies = await app.pocketbase.getCaseStudies(true);
      const current = studies.find(s => s.slug === param(req, 'slug'));
      if (!current) {
        throw new ApiError('not_found');
      }
      await app.pocketbase.updateCaseStudy(param(req, 'slug'), fields);
      await reindexSearch(app);
      const updated = (await app.pocketbase.getCaseStudies(true)).find(s => s.slug === param(req, 'slug'));
      res.json(updated);
    } catch (error) {
      if (error instanceof ApiError) {
        next(error);
        return;
      }
      next(new ApiError('content_unavailable'));
    }
  });

  return router;
}

function validateCaseStudy(body: Record<string, unknown>): CaseStudy {
  const fields: Record<string, string> = {};
  const slug = typeof body.slug === 'string' ? body.slug : '';
  if (!/^[a-z0-9][a-z0-9-]{2,59}$/.test(slug)) {
    fields.slug = 'Use 3 to 60 lowercase letters, digits and hyphens.';
  }
  const title = typeof body.title === 'string' ? body.title : '';
  if (title.trim().length < 1 || title.trim().length > 60) {
    fields.title = 'Use 1 to 60 characters.';
  }
  const client = typeof body.client === 'string' ? body.client : '';
  if (client.trim().length < 1) {
    fields.client = 'Enter the client name.';
  }
  const scene = body.scene as { primitives?: unknown; accent?: unknown } | undefined;
  const primitives = Array.isArray(scene?.primitives) ? (scene?.primitives as string[]) : [];
  const validPrimitives = primitives.every(p => ['box', 'cylinder', 'sphere', 'torus', 'capsule'].includes(p));
  if (primitives.length < 1 || primitives.length > 8 || !validPrimitives) {
    fields.scene = 'Use 1 to 8 primitives and an accent of ember, cobalt or violet.';
  }
  const accent = typeof scene?.accent === 'string' ? scene.accent : '';
  if (!['ember', 'cobalt', 'violet'].includes(accent)) {
    fields.scene = 'Use 1 to 8 primitives and an accent of ember, cobalt or violet.';
  }
  if (Object.keys(fields).length > 0) {
    throw new ApiError('validation_failed', fields);
  }
  return {
    slug,
    title: title.trim(),
    client: client.trim(),
    summary: typeof body.summary === 'string' ? body.summary : '',
    scene: { primitives, accent },
    published: body.published === true,
    sort: typeof body.sort === 'number' ? body.sort : 0,
  };
}

export function studioDownloadDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function reindexSearch(app: App): Promise<void> {
  const studies = await app.pocketbase.getCaseStudies(false);
  const services = await app.pocketbase.getServices();
  const insights = await app.pocketbase.getInsights();
  const documents = [
    ...studies.map(study => ({
      id: `case_study-${study.slug}`,
      kind: 'case_study' as const,
      title: study.title,
      summary: study.summary,
      url: `/work/${study.slug}`,
    })),
    ...services.map(service => ({
      id: `service-${service.code}`,
      kind: 'service' as const,
      title: service.title,
      summary: `${formatMoney(service.list_price_pence, 'GBP')} per colourway`,
      url: '/#services',
    })),
    ...insights.map(insight => ({
      id: `insight-${insight.slug}`,
      kind: 'insight' as const,
      title: insight.title,
      summary: insight.summary,
      url: `/#insight-${insight.slug}`,
    })),
  ];
  await app.search.reindex(documents);
}

export async function renderInvoicePdf(
  app: App,
  engagement: { reference: string; brand_name: string; fx_rate: string; fx_locked_at: Date | null; brand_currency: 'EUR' | 'GBP' | 'USD' | 'JPY' },
  invoice: { number: string; lines: { description: string; amount: number }[]; amount_minor: number },
  quote: { subtotal_minor: number; vat_minor: number; total_minor: number },
): Promise<string | null> {
  try {
    const html = invoiceHtml(engagement as never, invoice as never, quote as never);
    const pdf = await app.documents.renderPdf(html);
    return pdf.toString('base64');
  } catch {
    return null;
  }
}

export { escapeHtml, formatUtcDate, formatUtcTime, shareLineDescription, changeOrderAmountMinor, changeOrderDescription, randomToken, MILESTONE_LABELS };
