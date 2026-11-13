import crypto from 'node:crypto';
import { Router } from 'express';
import type { Config } from '../config.js';
import { pool, withTransaction } from '../db.js';
import { HttpError } from '../http.js';
import type { AuthedRequest } from '../middleware.js';
import { requireAuth } from '../middleware.js';
import * as svc from '../commission-service.js';
import * as dates from '../domain/dates.js';
import { KillBill, KillBillUnavailable } from '../services/killbill.js';
import { KeycloakAdmin } from '../services/keycloak.js';
import { enqueueJob } from '../jobs.js';

export function fundersRouter(cfg: Config): Router {
  const router = Router();
  const auth = requireAuth(cfg.accessTtlSeconds);
  const kb = new KillBill(cfg);

  const producerOnly = (req: AuthedRequest) => {
    const user = req.user;
    if (!user || user.role !== 'producer') throw new HttpError(403, 'forbidden', '');
    return user;
  };

  router.get('/commissions/:id/funders', auth, async (req, res, next) => {
    try {
      const id = (req.params as { id?: string })['id'] ?? '';
      const tx = await pool.connect();
      try {
        const user = (req as AuthedRequest).user!;
        const commission = await svc.getCommission(tx, id);
        if (!commission || (user.role !== 'producer' && commission.client_id !== user.id)) throw new HttpError(404, 'not_found', '');
        const funders = await svc.getFunders(tx, id);
        res.json({ funders: funders.map(serializeFunder) });
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  router.put('/commissions/:id/funders', auth, async (req, res, next) => {
    try {
      const id = (req.params as { id?: string })['id'] ?? '';
      const body = req.body as { funders?: Array<{ kind: string; name?: string; email?: string; bp: number }> };
      const result = await withTransaction(async (tx) => {
        producerOnly(req as AuthedRequest);
        const commission = await svc.getCommission(tx, id);
        if (!commission) throw new HttpError(404, 'not_found', '');
        const funders = body.funders ?? [];
        // The list is locked once a sponsor accepted or the deposit is paid.
        const existing = await svc.getFunders(tx, id);
        const locked = existing.some((f) => f.state === 'accepted' || f.state === 'paid') || commission.state !== 'briefed' && commission.state !== 'previewed' && commission.state !== 'placed' && commission.state !== 'held';
        if (locked) throw new HttpError(409, 'funders_locked', '');
        const sponsors = funders.filter((f) => f.kind === 'sponsor');
        if (sponsors.length > 3) throw new HttpError(422, 'validation', '', { errors: { funders: 'Up to three sponsors per commission.' } });
        if (funders.length === 0 || funders[0]?.kind !== 'client') throw new HttpError(422, 'validation', '', { errors: { funders: 'Shares must add up to 100.00%.' } });
        const totalBp = funders.reduce((s, f) => s + (Number(f.bp) || 0), 0);
        if (totalBp !== 10000) throw new HttpError(422, 'validation', '', { errors: { funders: 'Shares must add up to 100.00%.' } });
        const errors: Record<string, string> = {};
        funders.forEach((f, i) => {
          if (f.kind === 'sponsor') {
            if (!f.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) errors[`funders[${i}].email`] = 'Enter a valid email.';
            if (!f.name || f.name.trim().length < 1) errors[`funders[${i}].name`] = 'Enter the sponsor name.';
          }
          if (!Number.isInteger(f.bp) || f.bp < 1) errors[`funders[${i}].bp`] = 'Each share must be at least 0.01%.';
        });
        if (Object.keys(errors).length > 0) throw new HttpError(422, 'validation', '', { errors });

        // Replace the list: unchanged emails keep links; new emails get invites; removed links stop working.
        const keepByEmail = new Map(existing.filter((f) => f.email).map((f) => [f.email as string, f]));
        for (let i = 0; i < funders.length; i++) {
          const f = funders[i];
          if (!f) continue;
          if (f.kind === 'client') {
            const clientFunder = existing.find((x) => x.kind === 'client');
            if (clientFunder) {
              await tx.query(`UPDATE funders SET bp = $2, position = $3 WHERE id = $1`, [clientFunder.id, f.bp, i]);
            }
            continue;
          }
          const prior = f.email ? keepByEmail.get(f.email) : undefined;
          if (prior) {
            await tx.query(`UPDATE funders SET name = $2, bp = $3, position = $4 WHERE id = $1`, [prior.id, f.name ?? prior.name, f.bp, i]);
            keepByEmail.delete(f.email as string);
            continue;
          }
          const fid = crypto.randomUUID();
          const expiresAt = new Date(Date.now() + cfg.inviteTtlSeconds * 1000);
          const token = crypto.randomBytes(24).toString('base64url');
          const tokenHash = hashToken(token);
          await tx.query(
            `INSERT INTO funders (id, commission_id, kind, position, name, email, bp, state, invite_token_hash, invite_expires_at, invite_sent_at)
             VALUES ($1, $2, 'sponsor', $3, $4, $5, $6, 'invited', $7, $8, now())`,
            [fid, id, i, f.name ?? '', f.email ?? '', f.bp, tokenHash, expiresAt],
          );
          await enqueueJob(tx, 'email', id, { emailKind: 'sponsor_invite', funderId: fid, token }, `invite-${fid}`);
        }
        for (const remaining of keepByEmail.values()) {
          await tx.query(`UPDATE funders SET state = 'revoked', invite_token_hash = NULL WHERE id = $1`, [remaining.id]);
        }
        await svc.recomputeAmounts(tx, commission);
        const after = await svc.getFunders(tx, id);
        return { funders: after.map(serializeFunder) };
      });
      res.json(result);
    } catch (e) {
      if (e instanceof KillBillUnavailable) {
        res.status(503).json({ error: { code: 'billing_unavailable', message: "Payments are paused — our billing system isn't answering. Nothing has been charged." } });
        return;
      }
      next(e);
    }
  });

  router.post('/funders/:funderId/invite', auth, async (req, res, next) => {
    try {
      const funderId = (req.params as { funderId?: string })['funderId'] ?? '';
      const result = await withTransaction(async (tx) => {
        producerOnly(req as AuthedRequest);
        const funder = (await tx.query(`SELECT * FROM funders WHERE id = $1`, [funderId])).rows[0] as svc.FunderRow | undefined;
        if (!funder) throw new HttpError(404, 'not_found', '');
        if (funder.state === 'accepted' || funder.state === 'paid') throw new HttpError(409, 'invite_used', '');
        const token = crypto.randomBytes(24).toString('base64url');
        const expiresAt = new Date(Date.now() + cfg.inviteTtlSeconds * 1000);
        await tx.query(`UPDATE funders SET state = 'invited', invite_token_hash = $2, invite_expires_at = $3, invite_sent_at = now() WHERE id = $1`, [funderId, hashToken(token), expiresAt]);
        await enqueueJob(tx, 'email', funder.commission_id, { emailKind: 'sponsor_invite', funderId, token }, `invite-reissue-${funderId}-${Date.now()}`);
        return { inviteExpiresAt: expiresAt.toISOString() };
      });
      res.json(result);
    } catch (e) {
      next(e);
    }
  });

  router.delete('/funders/:funderId/invite', auth, async (req, res, next) => {
    try {
      const funderId = (req.params as { funderId?: string })['funderId'] ?? '';
      await withTransaction(async (tx) => {
        producerOnly(req as AuthedRequest);
        const funder = (await tx.query(`SELECT * FROM funders WHERE id = $1`, [funderId])).rows[0] as svc.FunderRow | undefined;
        if (!funder) throw new HttpError(404, 'not_found', '');
        if (funder.state === 'paid') throw new HttpError(409, 'already_paid', '');
        await tx.query(`UPDATE funders SET state = 'revoked', invite_token_hash = NULL, invite_expires_at = NULL WHERE id = $1`, [funderId]);
      });
      res.status(204).end();
    } catch (e) {
      next(e);
    }
  });

  // ---------- Invites ----------

  router.get('/invites/:token', async (req, res, next) => {
    try {
      const token = (req.params as { token?: string })['token'] ?? '';
      const tx = await pool.connect();
      try {
        const funder = (await tx.query(`SELECT * FROM funders WHERE invite_token_hash = $1`, [hashToken(token)])).rows[0] as svc.FunderRow | undefined;
        if (!funder || funder.state === 'revoked' || funder.state === 'accepted' || funder.state === 'paid') {
          res.status(404).json({ error: { code: 'invite_invalid' } });
          return;
        }
        if (!funder.invite_expires_at || Date.now() >= funder.invite_expires_at.getTime()) {
          res.status(410).json({ error: { code: 'invite_expired' } });
          return;
        }
        const commission = await svc.getCommission(tx, funder.commission_id);
        if (!commission) {
          res.status(404).json({ error: { code: 'invite_invalid' } });
          return;
        }
        const venue = svc.venueById(commission.venue_id);
        const day = (await tx.query(`SELECT date FROM install_days WHERE commission_id = $1`, [commission.id])).rows[0] as { date: string } | undefined;
        res.json({
          commission: {
            title: commission.title,
            venueName: venue.name,
            installationType: commission.installation_type,
            installDate: day?.date ?? null,
          },
          share: {
            sponsorName: funder.name,
            bp: funder.bp,
            subtotalCents: funder.subtotal_cents,
            taxCents: funder.tax_cents,
            amountCents: funder.amount_cents,
          },
          expiresAt: funder.invite_expires_at.toISOString(),
        });
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  // Every method other than GET on the invite path answers 405, except accept.
  router.all('/invites/:token', (req, res) => {
    res.set('allow', 'GET').status(405).json({ error: { code: 'method_not_allowed' } });
  });

  router.post('/invites/:token/accept', auth, async (req, res, next) => {
    try {
      const token = (req.params as { token?: string })['token'] ?? '';
      const user = (req as AuthedRequest).user!;
      const result = await withTransaction(async (tx) => {
        const funder = (await tx.query(`SELECT * FROM funders WHERE invite_token_hash = $1`, [hashToken(token)])).rows[0] as svc.FunderRow | undefined;
        if (!funder || funder.state === 'revoked') throw new HttpError(404, 'invite_invalid', '');
        if (!funder.invite_expires_at || Date.now() >= funder.invite_expires_at.getTime()) throw new HttpError(410, 'invite_expired', '');
        if (funder.state === 'paid') throw new HttpError(409, 'invite_used', '');
        // An already-accepted invite replays for the bound account and is used for any other.
        if (funder.app_user_id) {
          if (funder.app_user_id === user.id) return { commissionId: funder.commission_id, funderId: funder.id };
          throw new HttpError(409, 'invite_used', '');
        }
        const commission = await svc.getCommission(tx, funder.commission_id);
        if (!commission) throw new HttpError(404, 'invite_invalid', '');
        // Bind the sponsor to this account, grant the role, invoice the share in Kill Bill.
        const kc = new KeycloakAdmin(cfg);
        await kc.ensureRole(user.keycloakId, 'sponsor').catch(() => undefined);
        await tx.query(`UPDATE app_users SET role = 'sponsor' WHERE id = $1`, [user.id]);
        const accountId = await kb.ensureAccount(user.id, user.name, user.email);
        const venue = svc.venueById(commission.venue_id);
        const invoice = await kb.createInvoice(accountId, commission.title, 'Sponsor share', funder.subtotal_cents ?? 0, funder.tax_cents ?? 0, dates.localDate(new Date(), venue.time_zone));
        const dueAt = dates.milestoneDueAt(new Date(), venue.time_zone);
        const docId = crypto.randomUUID();
        await tx.query(
          `INSERT INTO documents (id, commission_id, kind, version, label, s3_key, issued_at, killbill_invoice_id)
           VALUES ($1, $2, 'invoice', 1, 'Sponsor share', $3, now(), $4)`,
          [docId, commission.id, `commissions/${commission.id}/documents/invoice-${invoice.invoiceId}.pdf`, invoice.invoiceId],
        );
        await tx.query(
          `UPDATE funders SET state = 'invoiced', app_user_id = $2, accepted_at = now(), killbill_invoice_id = $3, due_at = $4, document_id = $5 WHERE id = $1`,
          [funder.id, user.id, invoice.invoiceId, dueAt, docId],
        );
        await enqueueJob(tx, 'pdf', commission.id, { documentId: docId, kind: 'invoice' }, `pdf-${docId}`);
        await enqueueJob(tx, 'email', commission.id, { emailKind: 'milestone_due', funderId: funder.id }, `share-due-${funder.id}`);
        return { commissionId: commission.id, funderId: funder.id };
      });
      res.json(result);
    } catch (e) {
      if (e instanceof KillBillUnavailable) {
        res.status(503).json({ error: { code: 'billing_unavailable', message: "Payments are paused — our billing system isn't answering. Nothing has been charged." } });
        return;
      }
      next(e);
    }
  });

  router.get('/commissions/:id/share', auth, async (req, res, next) => {
    try {
      const id = (req.params as { id?: string })['id'] ?? '';
      const tx = await pool.connect();
      try {
        const user = (req as AuthedRequest).user!;
        const commission = await svc.getCommission(tx, id);
        if (!commission) throw new HttpError(404, 'not_found', '');
        const funder = (await tx.query(`SELECT * FROM funders WHERE commission_id = $1 AND app_user_id = $2 AND kind = 'sponsor' ORDER BY position LIMIT 1`, [id, user.id])).rows[0] as svc.FunderRow | undefined;
        if (!funder) throw new HttpError(404, 'not_found', '');
        const venue = svc.venueById(commission.venue_id);
        const day = (await tx.query(`SELECT date FROM install_days WHERE commission_id = $1`, [id])).rows[0] as { date: string } | undefined;
        res.json({
          commission: {
            title: commission.title,
            venueName: venue.name,
            installationType: commission.installation_type,
            installDate: day?.date ?? null,
          },
          share: {
            funderId: funder.id,
            sponsorName: funder.name,
            bp: funder.bp,
            subtotalCents: funder.subtotal_cents,
            taxCents: funder.tax_cents,
            amountCents: funder.amount_cents,
            state: funder.state,
            dueAt: funder.due_at?.toISOString() ?? null,
            killbillInvoiceId: funder.killbill_invoice_id,
            documentId: funder.document_id,
          },
        });
      } finally {
        tx.release();
      }
    } catch (e) {
      next(e);
    }
  });

  return router;
}

export function serializeFunder(f: svc.FunderRow): unknown {
  return {
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
  };
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
