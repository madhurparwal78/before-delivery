import crypto from 'node:crypto';
import express, { Router } from 'express';
import type { Config } from '../config.js';
import { withTransaction } from '../db.js';
import { HttpError, CALLBACK_BODY_LIMIT } from '../http.js';
import type { AuthedRequest } from '../middleware.js';
import * as svc from '../commission-service.js';
import { ObjectStore } from '../services/objectstore.js';
import { enqueueJob } from '../jobs.js';
import { publishRender } from './events.js';

export function callbacksRouter(cfg: Config): Router {
  const router = Router();
  const store = new ObjectStore(cfg);

  // ---------- Options and quote ----------

  router.put('/commissions/:id/options', async (req, res, next) => {
    try {
      await requireClientOwner(req as AuthedRequest, async (maybeUser) => {
        const user = maybeUser;
        if (!user) throw new HttpError(401, 'unauthenticated', '');
        const id = (req.params as { id?: string })['id'] ?? '';
        const body = req.body as { size?: string; addOns?: string[] };
        const result = await withTransaction(async (tx) => {
          const commission = await svc.getCommission(tx, id);
          if (!commission || commission.client_id !== user.id) throw new HttpError(404, 'not_found', '');
          const funders = await svc.getFunders(tx, id);
          const lockedOptions = !['previewed', 'placed'].includes(commission.state) || funders.some((f) => f.state === 'accepted' || f.state === 'paid');
          if (lockedOptions) throw new HttpError(409, 'options_locked', '');
          const errors: Record<string, string> = {};
          const size = body.size;
          if (size !== 'compact' && size !== 'standard' && size !== 'grand') errors['size'] = 'Pick Compact, Standard or Grand.';
          const addOns = Array.isArray(body.addOns) ? body.addOns : undefined;
          const validAddOns = ['ambient-sound', 'night-lighting', 'photo-takeaway'];
          if (!addOns || addOns.some((a) => typeof a !== 'string' || !validAddOns.includes(a)) || new Set(addOns).size !== addOns.length) {
            errors['addOns'] = 'Pick from the listed extras.';
          }
          if (Object.keys(errors).length > 0) throw new HttpError(422, 'validation', '', { errors });
          const sizeValue = size as 'compact' | 'standard' | 'grand';
          const addOnsValue = addOns as Array<'ambient-sound' | 'night-lighting' | 'photo-takeaway'>;
          await tx.query(`UPDATE commissions SET size = $2, add_ons = $3, updated_at = now() WHERE id = $1`, [id, sizeValue, JSON.stringify(addOnsValue)]);
          const fresh = (await svc.getCommission(tx, id))!;
          const quote = await svc.issueQuote(tx, cfg, fresh);
          // Layout drops items for removed extras, which raises the version.
          const layout = (await tx.query(`SELECT version, items FROM layouts WHERE commission_id = $1`, [id])).rows[0] as { version: number; items: Array<{ kind: string; x: number; y: number; rotationDeg: number }> };
          const kept = (layout.items ?? []).filter((item) => validAddOns.includes(item.kind) && addOnsValue.includes(item.kind as 'ambient-sound' | 'night-lighting' | 'photo-takeaway') || item.kind === fresh.installation_type);
          const version = layout.version + 1;
          await tx.query(`UPDATE layouts SET version = $2, items = $3 WHERE commission_id = $1`, [id, version, JSON.stringify(kept)]);
          await svc.recomputeAmounts(tx, fresh);
          return { options: { size: sizeValue, addOns: addOnsValue }, quote, layout: { version, items: kept } };
        });
        res.json({
          options: result.options,
          quote: serializeQuote(result.quote),
          layout: result.layout,
        });
      });
    } catch (e) {
      next(e);
    }
  });

  router.post('/commissions/:id/quote/refresh', async (req, res, next) => {
    try {
      await requireClientOwner(req as AuthedRequest, async (maybeUser) => {
        const user = maybeUser;
        if (!user) throw new HttpError(401, 'unauthenticated', '');
        const id = (req.params as { id?: string })['id'] ?? '';
        const result = await withTransaction(async (tx) => {
          const commission = await svc.getCommission(tx, id);
          if (!commission || commission.client_id !== user.id) throw new HttpError(404, 'not_found', '');
          const milestones = await svc.getMilestones(tx, id);
          const deposit = milestones.find((m) => m.label === 'Deposit');
          if (deposit?.state === 'paid') throw new HttpError(409, 'illegal_state', '');
          const quote = await svc.issueQuote(tx, cfg, commission);
          await svc.recomputeAmounts(tx, commission);
          return quote;
        });
        res.json({ quote: serializeQuote(result) });
      });
    } catch (e) {
      next(e);
    }
  });

  // ---------- Render callbacks (provider only) ----------

  router.post('/render-callbacks', express.json({ limit: CALLBACK_BODY_LIMIT }), async (req, res, next) => {
    try {
      const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
      const rawBytes = raw ?? Buffer.from(JSON.stringify(req.body));
      const timestamp = req.headers['x-render-timestamp'];
      const signature = req.headers['x-render-signature'];
      if (typeof timestamp !== 'string' || typeof signature !== 'string') {
        res.status(401).json({ error: { code: 'bad_signature' } });
        return;
      }
      const expected = 'v1=' + crypto.createHmac('sha256', cfg.renderWebhookSecret).update(`${timestamp}.${rawBytes.toString('utf8')}`).digest('hex');
      if (!timingSafeEqual(signature, expected)) {
        res.status(401).json({ error: { code: 'bad_signature' } });
        return;
      }
      const ts = Number(timestamp);
      const nowSeconds = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 300) {
        res.status(401).json({ error: { code: 'stale_timestamp' } });
        return;
      }
      const body = req.body as {
        eventId?: string;
        jobRef?: string;
        providerJobId?: string;
        type?: string;
        progress?: number;
        preview?: { contentType?: string; base64?: string };
        failureReason?: string;
      };
      if (!body.eventId || !body.jobRef || !body.type) {
        res.status(404).json({ error: { code: 'not_found' } });
        return;
      }
      const outcome = await withTransaction(async (tx) => {
        // Each eventId takes effect once, including under concurrency.
        const claimed = await tx.query(`INSERT INTO render_events (event_id, render_id) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`, [
          body.eventId, body.jobRef,
        ]);
        if (!claimed.rowCount) return { replayed: true };
        const render = (await tx.query(`SELECT * FROM renders WHERE id = $1 FOR UPDATE`, [body.jobRef])).rows[0] as
          | { id: string; commission_id: string; state: string; progress: number }
          | undefined;
        if (!render) {
          await tx.query('ROLLBACK');
          throw new HttpError(404, 'not_found', '');
        }
        // Terminal callbacks win once; anything after changes nothing.
        if (render.state === 'ready' || render.state === 'failed') return { replayed: true };
        if (body.type === 'render.progress') {
          const progress = Math.max(render.progress, Math.min(100, Math.max(0, Number(body.progress ?? 0))));
          await tx.query(`UPDATE renders SET progress = $2, state = CASE WHEN state = 'queued' THEN 'submitted' ELSE state END WHERE id = $1`, [render.id, progress]);
          publishRender(render.id, render.state, progress, render.commission_id);
          return { replayed: false };
        }
        if (body.type === 'render.completed') {
          const previewBytes = Buffer.from(body.preview?.base64 ?? '', 'base64');
          const isPng = previewBytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';
          if (!isPng || previewBytes.length === 0) {
            throw new HttpError(422, 'validation', '', { errors: { preview: 'Preview must be a PNG image.' } });
          }
          await tx.query(`UPDATE renders SET state = 'callback_verified', progress = 100 WHERE id = $1`, [render.id]);
          publishRender(render.id, 'callback_verified', 100, render.commission_id);
          await enqueueJob(tx, 'render_store', render.commission_id, { renderId: render.id, previewBase64: body.preview?.base64 ?? '' }, `render-store-${render.id}`);
          return { replayed: false };
        }
        if (body.type === 'render.failed') {
          await tx.query(`UPDATE renders SET state = 'failed', failure_reason = $2 WHERE id = $1`, [render.id, body.failureReason ?? 'provider_failed']);
          publishRender(render.id, 'failed', render.progress, render.commission_id);
          return { replayed: false };
        }
        return { replayed: false };
      });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  return router;

  async function requireClientOwner(req: AuthedRequest, fn: (user: AuthedRequest['user']) => Promise<void>): Promise<void> {
    const outcome = await (await import('../middleware.js')).authenticate(req, cfg.accessTtlSeconds);
    if (!outcome) throw new HttpError(401, 'unauthenticated', '');
    if ('expired' in outcome) throw new HttpError(401, 'session_expired', '');
    req.user = outcome.user;
    req.sessionId = outcome.sessionId;
    if (!outcome.user) throw new HttpError(401, 'unauthenticated', '');
    await fn(outcome.user);
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function serializeQuote(quote: svc.QuoteRow): unknown {
  return {
    quoteId: quote.id,
    lines: quote.lines,
    subtotalCents: quote.subtotal_cents,
    taxCents: quote.tax_cents,
    totalCents: quote.total_cents,
    issuedAt: quote.issued_at.toISOString(),
    validUntil: quote.valid_until.toISOString(),
  };
}
