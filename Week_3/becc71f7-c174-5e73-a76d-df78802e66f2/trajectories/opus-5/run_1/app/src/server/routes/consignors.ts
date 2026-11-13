import { randomUUID } from 'node:crypto';
import { jsonResponse, type RequestContext } from '../http/context.js';
import { conflict, mailUnavailable, notFound, validationFailed } from '../http/errors.js';
import { route, type CompiledRoute } from '../http/router.js';
import {
  FieldProblems,
  optionalIban,
  optionalPhone,
  requireEmail,
  requireName,
} from '../http/validate.js';
import { inTransaction, instantParam, isUniqueViolation } from '../db.js';
import {
  consignorJson,
  loadConsignor,
  loadConsignors,
  type ConsignorRecord,
} from '../data/consignors.js';
import { loadPiecesOfConsignor, pieceJson } from '../data/pieces.js';
import { isoSeconds } from '../../shared/brussels.js';
import { copy, fieldCopy } from '../../shared/copy.js';
import { newToken } from '../http/sessions.js';
import { MailUnavailable } from '../services/mail.js';
import { sweepErasure } from '../services/erasure.js';

async function consignorInPath(ctx: RequestContext): Promise<ConsignorRecord> {
  const consignor = await loadConsignor(ctx.app.db, ctx.param('consignorId'));
  if (consignor === null) throw notFound();
  return consignor;
}

function emailTaken(): never {
  throw conflict('consignor_email_taken', 'A consignor already uses that email address.');
}

export const consignorRoutes: CompiledRoute[] = [
  route({
    method: 'GET',
    path: '/api/consignors',
    access: 'desk',
    handle: async (ctx) =>
      jsonResponse(200, {
        consignors: (await loadConsignors(ctx.app.db)).map(consignorJson),
      }),
  }),

  route({
    method: 'POST',
    path: '/api/consignors',
    access: 'desk',
    handle: async (ctx) => {
      const body = ctx.json();
      const problems = new FieldProblems();
      const name = requireName(problems, body);
      const email = requireEmail(problems, body);
      const phone = optionalPhone(body);
      const iban = optionalIban(problems, body);
      problems.throwIfAny();

      const id = randomUUID();
      try {
        await ctx.app.db.query(
          `INSERT INTO consignors (id, name, email, email_lower, phone, iban, status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
          [id, name, email, email.toLowerCase(), phone, iban, instantParam(ctx.now)],
        );
      } catch (error) {
        if (isUniqueViolation(error)) emailTaken();
        throw error;
      }
      const created = (await loadConsignor(ctx.app.db, id)) as ConsignorRecord;
      return jsonResponse(201, { consignor: consignorJson(created) });
    },
  }),

  route({
    method: 'GET',
    path: '/api/consignors/:consignorId',
    access: 'desk',
    resolve: consignorInPath,
    handle: async (ctx, consignor) => {
      const pieces = await loadPiecesOfConsignor(ctx.app.db, consignor.id, ctx.now);
      const { rows } = await ctx.app.db.query(
        `SELECT id, month, amount_cents, status, reason FROM payouts
          WHERE consignor_id = $1 ORDER BY month DESC, id`,
        [consignor.id],
      );
      return jsonResponse(200, {
        consignor: consignorJson(consignor),
        pieces: pieces.map((piece) => pieceJson(piece, ctx.now)),
        payouts: rows.map((row) => ({
          id: row['id'] as string,
          month: row['month'] as string,
          amountCents: Number(row['amount_cents']),
          status: row['status'] as string,
          reason: (row['reason'] as string | null) ?? null,
        })),
      });
    },
  }),

  route({
    method: 'PATCH',
    path: '/api/consignors/:consignorId',
    access: 'desk',
    resolve: consignorInPath,
    handle: async (ctx, consignor) => {
      const body = ctx.json();
      const problems = new FieldProblems();
      const name = 'name' in body ? requireName(problems, body) : consignor.name;
      const email = 'email' in body ? requireEmail(problems, body) : consignor.email;
      const phone = 'phone' in body ? optionalPhone(body) : consignor.phone;
      const iban = 'iban' in body ? optionalIban(problems, body) : consignor.iban;
      problems.throwIfAny();

      if (consignor.status === 'erased') {
        throw conflict('consignor_erased', 'This consignor has been erased.');
      }

      try {
        await ctx.app.db.query(
          `UPDATE consignors SET name = $2, email = $3, email_lower = $4, phone = $5, iban = $6
            WHERE id = $1`,
          [consignor.id, name, email, email === null ? null : email.toLowerCase(), phone, iban],
        );
      } catch (error) {
        if (isUniqueViolation(error)) emailTaken();
        throw error;
      }
      const updated = (await loadConsignor(ctx.app.db, consignor.id)) as ConsignorRecord;
      return jsonResponse(200, { consignor: consignorJson(updated) });
    },
  }),

  route({
    method: 'POST',
    path: '/api/consignors/:consignorId/portal-link',
    access: 'desk',
    expects: 'none',
    resolve: consignorInPath,
    handle: async (ctx, consignor) => {
      if (consignor.status === 'erased') {
        throw conflict('consignor_erased', 'This consignor has been erased.');
      }
      if (consignor.email === null) throw validationFailed({ email: fieldCopy.email });
      const token = newToken();
      const pageEndsAt = ctx.now + ctx.app.config.portalPageSeconds * 1_000;

      await inTransaction(ctx.app.db, async (tx) => {
        await tx.query(
          `UPDATE portal_links SET ended_at = $2 WHERE consignor_id = $1 AND ended_at IS NULL`,
          [consignor.id, instantParam(ctx.now)],
        );
        await tx.query(
          `INSERT INTO portal_links (token, consignor_id, created_at, ends_at)
           VALUES ($1, $2, $3, $4)`,
          [token, consignor.id, instantParam(ctx.now), instantParam(pageEndsAt)],
        );
        try {
          await ctx.app.mailer.sendPortalLink({
            to: consignor.email as string,
            pageUrl: `${ctx.app.config.publicUrl}/c/${token}`,
            pageEndsAt,
          });
        } catch (error) {
          if (error instanceof MailUnavailable) throw mailUnavailable(copy.mailDown);
          throw error;
        }
      });

      return jsonResponse(201, { pageEndsAt: isoSeconds(pageEndsAt) });
    },
  }),

  route({
    method: 'DELETE',
    path: '/api/consignors/:consignorId/portal-link',
    access: 'owner',
    resolve: consignorInPath,
    handle: async (ctx, consignor) => {
      await ctx.app.db.query(
        `UPDATE portal_links SET ended_at = $2 WHERE consignor_id = $1 AND ended_at IS NULL`,
        [consignor.id, instantParam(ctx.now)],
      );
      return { kind: 'empty', status: 204 };
    },
  }),

  route({
    method: 'POST',
    path: '/api/consignors/:consignorId/erase',
    access: 'owner',
    expects: 'none',
    resolve: consignorInPath,
    handle: async (ctx, consignor) => {
      if (consignor.status === 'erased' || consignor.status === 'erasing') {
        throw conflict('already_erased', 'This consignor is already being erased.');
      }

      await inTransaction(ctx.app.db, async (tx) => {
        await tx.query(
          `UPDATE consignors
              SET name = $2, email = NULL, email_lower = NULL, phone = NULL, iban = NULL,
                  status = 'erasing'
            WHERE id = $1`,
          [consignor.id, copy.erasedConsignor],
        );
        await tx.query(
          `UPDATE portal_links SET ended_at = $2 WHERE consignor_id = $1 AND ended_at IS NULL`,
          [consignor.id, instantParam(ctx.now)],
        );
        await tx.query(
          `UPDATE holds SET released_at = $2
            WHERE released_at IS NULL AND ends_at > $2
              AND piece_id IN (SELECT id FROM pieces WHERE consignor_id = $1)`,
          [consignor.id, instantParam(ctx.now)],
        );
        await tx.query(
          `UPDATE pieces SET archived_at = COALESCE(archived_at, $2)
            WHERE consignor_id = $1
              AND NOT EXISTS (
                SELECT 1 FROM sales s WHERE s.piece_id = pieces.id AND s.refunded_at IS NULL)`,
          [consignor.id, instantParam(ctx.now)],
        );
        await tx.query(
          `INSERT INTO erasures (consignor_id, requested_at) VALUES ($1, $2)
           ON CONFLICT (consignor_id) DO NOTHING`,
          [consignor.id, instantParam(ctx.now)],
        );
      });

      await sweepErasure(ctx.app, consignor.id).catch(() => undefined);
      const erased = (await loadConsignor(ctx.app.db, consignor.id)) as ConsignorRecord;
      return jsonResponse(202, { consignor: consignorJson(erased) });
    },
  }),
];
