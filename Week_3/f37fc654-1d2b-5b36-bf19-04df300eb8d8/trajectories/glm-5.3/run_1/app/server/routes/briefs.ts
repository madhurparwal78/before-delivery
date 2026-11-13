import crypto from 'node:crypto';
import { Router } from 'express';
import type { Config } from '../config.js';
import { pool, withTransaction } from '../db.js';
import { HttpError, notFound } from '../http.js';
import type { AuthedRequest } from '../middleware.js';
import { requireAuth } from '../middleware.js';
import * as svc from '../commission-service.js';
import { VENUES, requiredPieces } from '../domain/seed.js';
import type { AddOn, Audience, DoorWall, InstallationType } from '../domain/seed.js';

interface BriefAnswers {
  installationType?: InstallationType;
  title?: string;
  venueId?: string;
  widthM?: number;
  depthM?: number;
  doorWall?: DoorWall;
  audience?: Audience;
  addOns?: AddOn[];
  notes?: string | undefined;
}

export function briefsRouter(cfg: Config): Router {
  const router = Router();
  const auth = requireAuth(cfg.accessTtlSeconds);

  router.post('/briefs', auth, async (req, res, next) => {
    try {
      const user = (req as AuthedRequest).user!;
      if (user.role !== 'client' && user.role !== 'producer') throw new HttpError(403, 'forbidden', '');
      const id = crypto.randomUUID();
      await withTransaction(async (tx) => {
        await tx.query(`INSERT INTO briefs (id, client_id, answers, answered_through, next_step) VALUES ($1, $2, '{}', 0, 1)`, [id, user.id]);
      });
      res.status(201).json({ id, answers: {}, answeredThrough: 0, nextStep: 1, commissionId: null });
    } catch (e) {
      next(e);
    }
  });

  router.get('/briefs/:id', auth, async (req, res, next) => {
    try {
      const user = (req as AuthedRequest).user!;
      const tx = await pool.connect();
      try {
        const row = await tx.query(`SELECT * FROM briefs WHERE id = $1`, [req.params['id']]);
        const brief = row.rows[0] as { client_id: string; answers: BriefAnswers; answered_through: number; next_step: number | null; commission_id: string | null } | undefined;
        if (!brief || (brief.client_id !== user.id && user.role !== 'producer')) {
          notFound(res);
          return;
        }
        res.json({ id: req.params['id'], answers: brief.answers, answeredThrough: brief.answered_through, nextStep: brief.next_step, commissionId: brief.commission_id });
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  router.put('/briefs/:id/steps/:n', auth, async (req, res, next) => {
    try {
      const user = (req as AuthedRequest).user!;
      const n = Number(req.params['n']);
      if (!Number.isInteger(n) || n < 1 || n > 6) {
        notFound(res);
        return;
      }
      const result = await withTransaction(async (tx) => {
        const row = await tx.query(`SELECT * FROM briefs WHERE id = $1 FOR UPDATE`, [req.params['id']]);
        const brief = row.rows[0] as { client_id: string; answers: BriefAnswers; answered_through: number; next_step: number | null; commission_id: string | null } | undefined;
        if (!brief || brief.client_id !== user.id) {
          throw new HttpError(404, 'not_found', '');
        }
        if (brief.commission_id) {
          throw new HttpError(409, 'brief_completed', '', {});
        }
        if (n > brief.answered_through + 1) {
          throw new HttpError(409, 'step_out_of_order', '', {});
        }
        const body = req.body as { answer?: Record<string, unknown> };
        const answer = body.answer ?? {};
        const errors = validateStep(n, answer);
        if (Object.keys(errors).length > 0) {
          throw new HttpError(422, 'validation', '', { errors });
        }
        const answers = { ...brief.answers } as BriefAnswers;
        if (n === 1) {
          answers.installationType = answer['installationType'] as InstallationType;
          answers.title = String(answer['title'] ?? '').trim();
        } else if (n === 2) {
          answers.venueId = String(answer['venueId'] ?? '');
        } else if (n === 3) {
          answers.widthM = Number(answer['widthM']);
          answers.depthM = Number(answer['depthM']);
        } else if (n === 4) {
          answers.doorWall = answer['doorWall'] as DoorWall;
        } else if (n === 5) {
          answers.audience = answer['audience'] as Audience;
        } else if (n === 6) {
          answers.addOns = (answer['addOns'] as AddOn[]) ?? [];
          if (answer['notes'] !== undefined) answers.notes = String(answer['notes']);
        }
        const answeredThrough = Math.max(brief.answered_through, n);
        const nextStep = n === 6 ? null : n + 1;
        await tx.query(`UPDATE briefs SET answers = $2, answered_through = $3, next_step = $4, updated_at = now() WHERE id = $1`, [
          req.params['id'],
          JSON.stringify(answers),
          answeredThrough,
          nextStep,
        ]);
        return { id: req.params['id'], answers, answeredThrough, nextStep, commissionId: brief.commission_id };
      });
      res.json({ id: result.id, answers: result.answers, answeredThrough: result.answeredThrough, nextStep: result.nextStep, commissionId: null });
    } catch (e) {
      next(e);
    }
  });

  router.post('/briefs/:id/complete', auth, async (req, res, next) => {
    try {
      const user = (req as AuthedRequest).user!;
      const created = await withTransaction(async (tx) => {
        const row = await tx.query(`SELECT * FROM briefs WHERE id = $1 FOR UPDATE`, [req.params['id']]);
        const brief = row.rows[0] as { client_id: string; answers: BriefAnswers; answered_through: number; next_step: number | null; commission_id: string | null } | undefined;
        if (!brief || brief.client_id !== user.id) {
          throw new HttpError(404, 'not_found', '');
        }
        if (brief.commission_id) {
          return { commissionId: brief.commission_id, existing: true };
        }
        if (brief.answered_through < 6) {
          throw new HttpError(409, 'brief_incomplete', '', {});
        }
        const a = brief.answers;
        const venue = VENUES.find((v) => v.id === (a.venueId ?? ''));
        if (!a.installationType || !a.title || !venue || !a.widthM || !a.depthM || !a.doorWall || !a.audience) {
          throw new HttpError(409, 'brief_incomplete', '', {});
        }
        const commissionId = crypto.randomUUID();
        const addOns = (a.addOns ?? []) as AddOn[];
        await tx.query(
          `INSERT INTO commissions (id, brief_id, client_id, title, installation_type, venue_id, width_m, depth_m, door_wall, audience, notes, size, add_ons, state)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'compact', $12, 'briefed')`,
          [commissionId, req.params['id'], user.id, a.title, a.installationType, venue.id, a.widthM, a.depthM, a.doorWall, a.audience, a.notes ?? null, JSON.stringify(addOns)],
        );
        await tx.query(`INSERT INTO layouts (commission_id, version, items) VALUES ($1, 0, '[]')`, [commissionId]);
        await tx.query(`UPDATE briefs SET commission_id = $2, next_step = NULL WHERE id = $1`, [req.params['id'], commissionId]);
        // Quote and milestones with a single lead client funder.
        const commission = await svc.getCommission(tx, commissionId);
        if (!commission) throw new Error('commission missing');
        const quote = await svc.issueQuote(tx, cfg, commission);
        await svc.createMilestones(tx, commissionId);
        const funderId = crypto.randomUUID();
        await tx.query(
          `INSERT INTO funders (id, commission_id, kind, position, name, bp, state) VALUES ($1, $2, 'client', 0, $3, 10000, 'lead')`,
          [funderId, commissionId, user.name],
        );
        await tx.query(`UPDATE funders SET app_user_id = $2 WHERE id = $1`, [funderId, user.id]);
        await svc.recomputeAmounts(tx, commission);
        return { commissionId, existing: false };
      });
      const tx = await pool.connect();
      try {
        const c = await serializeCommission(tx, created.commissionId);
        res.status(created.existing ? 200 : 201).json(c);
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  return router;
}

export function validateStep(n: number, answer: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (n === 1) {
    const type = answer['installationType'];
    if (type !== 'camera-reactive-wall' && type !== 'portrait-kiosk' && type !== 'projection-room') {
      errors['installationType'] = 'Pick what should stand in the room.';
    }
    const title = typeof answer['title'] === 'string' ? answer['title'].trim() : '';
    if (title.length < 2 || title.length > 80) {
      errors['title'] = 'Give the piece a name of 2 to 80 characters.';
    }
  } else if (n === 2) {
    const venueId = answer['venueId'];
    if (typeof venueId !== 'string' || !VENUES.some((v) => v.id === venueId)) {
      errors['venueId'] = 'Pick a venue from the list.';
    }
  } else if (n === 3) {
    const w = answer['widthM'];
    const d = answer['depthM'];
    if (!isDimension(w)) errors['widthM'] = 'Enter a width from 4 to 60 metres in half-metre steps.';
    if (!isDimension(d)) errors['depthM'] = 'Enter a depth from 4 to 60 metres in half-metre steps.';
  } else if (n === 4) {
    const wall = answer['doorWall'];
    if (wall !== 'front' && wall !== 'back' && wall !== 'left' && wall !== 'right') {
      errors['doorWall'] = 'Pick the wall with the main door.';
    }
  } else if (n === 5) {
    const audience = answer['audience'];
    if (audience !== 'up-to-25' && audience !== '25-100' && audience !== '100-300' && audience !== 'over-300') {
      errors['audience'] = 'Pick how many people will be there at once.';
    }
  } else if (n === 6) {
    const addOns = answer['addOns'];
    const valid = ['ambient-sound', 'night-lighting', 'photo-takeaway'];
    const list = Array.isArray(addOns) ? addOns : undefined;
    if (!list || list.some((a) => typeof a !== 'string' || !valid.includes(a)) || new Set(list).size !== list.length) {
      errors['addOns'] = 'Pick from the listed extras.';
    }
    const notes = answer['notes'];
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 2000)) {
      errors['notes'] = 'Keep notes to 2,000 characters or fewer.';
    }
  }
  return errors;
}

function isDimension(v: unknown): boolean {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false;
  const quarter = v * 2;
  return v >= 4 && v <= 60 && Number.isInteger(quarter);
}

export async function serializeCommission(tx: svc.DbClientAlias, id: string): Promise<unknown> {
  const commission = await svc.getCommission(tx, id);
  if (!commission) throw new HttpError(404, 'not_found', '');
  const venue = svc.venueById(commission.venue_id);
  const quote = await svc.currentQuote(tx, id);
  const milestones = await svc.getMilestones(tx, id);
  const funders = await svc.getFunders(tx, id);
  const hold = await svc.latestHold(tx, id);
  const layoutRes = await tx.query(`SELECT version, items FROM layouts WHERE commission_id = $1`, [id]);
  const layoutRow = layoutRes.rows[0] as { version: number; items: Array<{ kind: string; x: number; y: number; rotationDeg: number }> };
  const installDayRes = await tx.query(`SELECT * FROM install_days WHERE commission_id = $1`, [id]);
  const installDay = installDayRes.rows[0] as { id: string; date: string; starts_at: Date; ends_at: Date; crew_user_ids: string[] } | undefined;
  const clientRes = await tx.query(`SELECT name FROM app_users WHERE id = $1`, [commission.client_id]);
  const clientName = (clientRes.rows[0] as { name: string } | undefined)?.name ?? '';
  const required = requiredPieces(commission.installation_type, commission.add_ons).map((p) => ({ kind: p.kind, label: p.label, widthM: p.w, depthM: p.d }));
  const holdStatus = hold ? await svc.holdStatus(tx, hold) : null;
  return {
    id: commission.id,
    title: commission.title,
    state: commission.state,
    installationType: commission.installation_type,
    venue: { id: venue.id, name: venue.name, address: venue.address, city: venue.city, timeZone: venue.time_zone, taxRateBp: venue.tax_rate_bp },
    room: { widthM: Number(commission.width_m), depthM: Number(commission.depth_m), doorWall: commission.door_wall },
    audience: commission.audience,
    notes: commission.notes,
    options: { size: commission.size, addOns: commission.add_ons },
    quote: quote
      ? {
          quoteId: quote.id,
          lines: quote.lines,
          subtotalCents: quote.subtotal_cents,
          taxCents: quote.tax_cents,
          totalCents: quote.total_cents,
          issuedAt: quote.issued_at.toISOString(),
          validUntil: quote.valid_until.toISOString(),
        }
      : null,
    layout: { version: layoutRow?.version ?? 0, items: layoutRow?.items ?? [] },
    requiredPieces: required,
    hold: hold && holdStatus
      ? {
          holdId: hold.id,
          date: hold.date,
          expiresAt: hold.expires_at.toISOString(),
          secondsRemaining: Math.max(0, Math.floor((hold.expires_at.getTime() - Date.now()) / 1000)),
          serverTime: new Date().toISOString(),
          status: holdStatus,
        }
      : null,
    installDay: installDay
      ? { id: installDay.id, date: installDay.date, startsAt: installDay.starts_at.toISOString(), endsAt: installDay.ends_at.toISOString(), crewUserIds: installDay.crew_user_ids }
      : null,
    milestones: milestones.map((m) => ({
      id: m.id,
      label: m.label,
      scheduleBp: m.schedule_bp,
      state: m.state,
      subtotalCents: m.subtotal_cents,
      taxCents: m.tax_cents,
      amountCents: m.amount_cents,
      invoicedAt: m.invoiced_at?.toISOString() ?? null,
      dueAt: m.due_at?.toISOString() ?? null,
      killbillInvoiceId: m.killbill_invoice_id,
      killbillPaymentId: m.killbill_payment_id,
      documentId: m.document_id,
    })),
    funders: funders.map((f) => ({
      id: f.id,
      kind: f.kind,
      name: f.name,
      email: f.email,
      bp: f.bp,
      subtotalCents: f.subtotal_cents,
      taxCents: f.tax_cents,
      amountCents: f.amount_cents,
      state: f.state,
      inviteExpiresAt: f.invite_expires_at?.toISOString() ?? null,
      position: f.position,
    })),
    clientId: commission.client_id,
    clientName,
    createdAt: commission.created_at.toISOString(),
  };
}
