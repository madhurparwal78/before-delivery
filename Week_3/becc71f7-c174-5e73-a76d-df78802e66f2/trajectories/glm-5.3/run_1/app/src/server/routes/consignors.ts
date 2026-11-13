// Consignors (DP-49, DP-51) and the consignor page (DP-34 to DP-37).

import crypto from 'node:crypto';
import type { Route, RouteContext } from '../http.js';
import { sendJson, parseJsonBody, asObject, str } from '../http.js';
import { ApiError } from '../errors.js';
import { brusselsMidnight, cutToSecond, toZ, addDays } from '../../shared/time.js';
import { isValidIban, normaliseIban } from '../../shared/iban.js';
import { consignorJson, pieceJson } from '../views.js';
import { findPieceById } from '../rows.js';
import type { PieceRow, LadderRow } from '../rows.js';
import { portalMail } from '../mails.js';
import { ladderJson } from '../views.js';

export const consignorRoutes: Route[] = [
  {
    method: 'GET', pattern: '/api/consignors', bodyLimit: 0, auth: 'desk',
    handle: async (ctx) => {
      const { rows } = await ctx.services.pool.query('SELECT * FROM consignors ORDER BY created_at, id');
      sendJson(ctx.res, 200, { consignors: rows.map(consignorJson) });
    },
  },
  {
    method: 'POST', pattern: '/api/consignors', bodyLimit: 65536, auth: 'desk',
    handle: async (ctx) => {
      requireJson(ctx);
      const body = asObject(parseJsonBody(ctx));
      const fields: Record<string, string> = {};
      const name = str(body.name);
      const email = str(body.email);
      const phone = str(body.phone);
      const iban = str(body.iban);
      if (!name || name.trim().length === 0) fields.name = 'Enter a name.';
      if (email !== undefined && email !== null) {
        if (typeof email !== 'string' || email.length === 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          fields.email = 'Enter an email address like name@example.be.';
        }
      }
      if (iban !== undefined && iban !== null && (typeof iban !== 'string' || (iban.length > 0 && !isValidIban(iban)))) {
        fields.iban = 'Enter a valid IBAN, for example BE68 5390 0754 7034.';
      }
      if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', fields);
      if (email) {
        const { rows } = await ctx.services.pool.query(
          "SELECT 1 FROM consignors WHERE lower(email) = lower($1) AND status <> 'erased'", [email]
        );
        if (rows.length > 0) throw new ApiError(409, 'consignor_email_taken', 'A consignor with that email already exists.');
      }
      const id = crypto.randomUUID();
      await ctx.services.pool.query(
        `INSERT INTO consignors (id, name, email, phone, iban, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'active', $6)`,
        [id, name!.trim(), email && email.length > 0 ? email.toLowerCase() : null, phone || null,
         iban && iban.length > 0 ? normaliseIban(iban) : null, new Date()]
      );
      const created = await consignorById(ctx, id);
      sendJson(ctx.res, 201, { consignor: consignorJson(created!) });
    },
  },
  {
    method: 'GET', pattern: '/api/consignors/:id', bodyLimit: 0, auth: 'desk',
    handle: async (ctx) => {
      const consignor = await consignorById(ctx, ctx.params.id!);
      if (!consignor) throw new ApiError(404, 'not_found', 'Not found.');
      const now = new Date();
      await refreshPieceStates(ctx, consignor.id, now);
      const { rows: pieces } = await ctx.services.pool.query(
        'SELECT * FROM pieces WHERE consignor_id = $1 ORDER BY intake_date DESC, tag_digits', [consignor.id]
      );
      const { rows: payouts } = await ctx.services.pool.query(
        'SELECT id, month, amount_cents, status, reason FROM payouts WHERE consignor_id = $1 ORDER BY month DESC', [consignor.id]
      );
      sendJson(ctx.res, 200, {
        consignor: consignorJson(consignor),
        pieces: await Promise.all(pieces.map((p) => pieceJson(ctx.services.pool, p, now))),
        payouts: payouts.map((p) => ({
          id: p.id, month: p.month, amountCents: p.amount_cents, status: p.status, reason: p.reason,
        })),
      });
    },
  },
  {
    method: 'PATCH', pattern: '/api/consignors/:id', bodyLimit: 65536, auth: 'desk',
    handle: async (ctx) => {
      const consignor = await consignorById(ctx, ctx.params.id!);
      if (!consignor) throw new ApiError(404, 'not_found', 'Not found.');
      if (consignor.status === 'erased') {
        throw new ApiError(409, 'consignor_erased', 'This consignor is erased.');
      }
      requireJson(ctx);
      const body = asObject(parseJsonBody(ctx));
      const fields: Record<string, string> = {};
      const name = body.name === undefined ? undefined : str(body.name);
      const email = body.email === undefined ? undefined : str(body.email);
      const phone = body.phone === undefined ? undefined : str(body.phone);
      const iban = body.iban === undefined ? undefined : str(body.iban);
      if (name !== undefined && (!name || name.trim().length === 0)) fields.name = 'Enter a name.';
      if (email !== undefined && email !== null && (typeof email !== 'string' || email.length === 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        fields.email = 'Enter an email address like name@example.be.';
      }
      if (iban !== undefined && iban !== null && (typeof iban !== 'string' || (iban.length > 0 && !isValidIban(iban)))) {
        fields.iban = 'Enter a valid IBAN, for example BE68 5390 0754 7034.';
      }
      if (Object.keys(fields).length > 0) throw new ApiError(422, 'validation_failed', 'There\u2019s a problem.', fields);
      if (email !== undefined && email) {
        const { rows } = await ctx.services.pool.query(
          "SELECT 1 FROM consignors WHERE lower(email) = lower($1) AND status <> 'erased' AND id <> $2", [email, consignor.id]
        );
        if (rows.length > 0) throw new ApiError(409, 'consignor_email_taken', 'A consignor with that email already exists.');
      }
      await ctx.services.pool.query(
        `UPDATE consignors SET
           name = COALESCE($1, name), email = CASE WHEN $2 THEN $3 ELSE email END,
           phone = CASE WHEN $4 THEN $5 ELSE phone END,
           iban = CASE WHEN $6 THEN $7 ELSE iban END
         WHERE id = $8`,
        [
          name !== undefined ? name.trim() : null,
          email !== undefined, email === undefined ? null : (email.length > 0 ? email.toLowerCase() : null),
          phone !== undefined, phone === undefined ? null : phone,
          iban !== undefined, iban === undefined ? null : (iban.length > 0 ? normaliseIban(iban) : null),
          consignor.id,
        ]
      );
      const updated = await consignorById(ctx, consignor.id);
      sendJson(ctx.res, 200, { consignor: consignorJson(updated!) });
    },
  },
  {
    method: 'POST', pattern: '/api/consignors/:id/portal-link', bodyLimit: 0, auth: 'desk',
    handle: async (ctx) => {
      const consignor = await consignorById(ctx, ctx.params.id!);
      if (!consignor) throw new ApiError(404, 'not_found', 'Not found.');
      if (consignor.status === 'erased') {
        throw new ApiError(409, 'consignor_erased', 'This consignor is erased.');
      }
      const now = cutToSecond(new Date());
      const endsAt = new Date(now.getTime() + ctx.services.config.timers.portalPageSeconds * 1000);
      const token = crypto.randomBytes(24).toString('base64url');
      // A new address ends the old one at once (DP-36). The mail is sent before
      // the address is written, so a Mailpit outage leaves the old one valid.
      const url = `${ctx.services.config.publicUrl}/c/${token}`;
      try {
        await portalMail(
          { mailer: ctx.services.mailer, mailFrom: ctx.services.config.mailFrom },
          { to: consignor.email!, pageUrl: url, endsAt }
        );
      } catch {
        throw new ApiError(503, 'mail_unavailable', 'We can\u2019t send your consignor page right now. The old address is still valid.');
      }
      await ctx.services.pool.query(
        `INSERT INTO portal_links (consignor_id, token, ends_at) VALUES ($1, $2, $3)
         ON CONFLICT (consignor_id) DO UPDATE SET token = $2, ends_at = $3`,
        [consignor.id, token, endsAt]
      );
      sendJson(ctx.res, 201, { pageEndsAt: toZ(endsAt) });
    },
  },
  {
    method: 'DELETE', pattern: '/api/consignors/:id/portal-link', bodyLimit: 0, auth: 'owner',
    handle: async (ctx) => {
      const consignor = await consignorById(ctx, ctx.params.id!);
      if (!consignor) throw new ApiError(404, 'not_found', 'Not found.');
      await ctx.services.pool.query('DELETE FROM portal_links WHERE consignor_id = $1', [consignor.id]);
      ctx.res.writeHead(204);
      ctx.res.end();
    },
  },
  {
    method: 'POST', pattern: '/api/consignors/:id/erase', bodyLimit: 0, auth: 'owner',
    handle: async (ctx) => {
      const consignor = await consignorById(ctx, ctx.params.id!);
      if (!consignor) throw new ApiError(404, 'not_found', 'Not found.');
      if (consignor.status !== 'active') {
        throw new ApiError(409, 'already_erased', 'This consignor is already erased.');
      }
      // Erasure always first asks MinIO which objects it holds (DP-51).
      const reachable = await ctx.services.storage.reachable();
      if (!reachable) {
        await ctx.services.pool.query("UPDATE consignors SET status = 'erasing', name = 'Erased consignor', email = NULL, phone = NULL, iban = NULL WHERE id = $1", [consignor.id]);
        const updating = await consignorById(ctx, consignor.id);
        sendJson(ctx.res, 202, { consignor: consignorJson(updating!) });
        return;
      }
      await eraseConsignor(ctx, consignor.id);
      const erased = await consignorById(ctx, consignor.id);
      sendJson(ctx.res, 202, { consignor: consignorJson(erased!) });
    },
  },
];

/** The erasure itself, retried from the refresh path while MinIO is unreachable. */
async function eraseConsignor(ctx: RouteContext, consignorId: string): Promise<void> {
  const keys = await ctx.services.storage.list(`pieces/`);
  const pieceIds = new Set((await ctx.services.pool.query<{ id: string }>(
    'SELECT id FROM pieces WHERE consignor_id = $1', [consignorId]
  )).rows.map((r) => r.id));
  const toDelete: string[] = [];
  for (const key of keys) {
    // pieces/<piece id>/photos/<photo id>/{original,public}
    const parts = key.split('/');
    const pieceId = parts[1] ?? '';
    if (!pieceIds.has(pieceId)) continue;
    const piece = await findPieceById(ctx.services.pool, pieceId);
    if (piece && piece.status === 'sold') continue; // photos of sold pieces stay
    toDelete.push(key);
  }
  await ctx.services.pool.query(
    `INSERT INTO erasure_deletions (consignor_id, photo_count, deleted_count) VALUES ($1, $2, 0)
     ON CONFLICT (consignor_id) DO UPDATE SET photo_count = $2, deleted_count = 0`,
    [consignorId, toDelete.length]
  );
  for (const key of toDelete) {
    await ctx.services.storage.delete(key);
    await ctx.services.pool.query('UPDATE erasure_deletions SET deleted_count = deleted_count + 1 WHERE consignor_id = $1', [consignorId]);
  }
  // The name, email, phone and IBAN go from the database and every response.
  await ctx.services.pool.query(
    `UPDATE consignors SET status = 'erased', name = 'Erased consignor', email = NULL, phone = NULL, iban = NULL WHERE id = $1`,
    [consignorId]
  );
  await ctx.services.pool.query('DELETE FROM portal_links WHERE consignor_id = $1', [consignorId]);
  // Unsold pieces are archived and their holds released.
  await ctx.services.pool.query(
    `UPDATE pieces SET status = 'archived', archived_at = $1
     WHERE consignor_id = $2 AND status IN ('on_rail', 'on_hold', 'returns_shelf', 'donation_box')`,
    [new Date(), consignorId]
  );
  await ctx.services.pool.query(
    "UPDATE holds SET status = 'ended' WHERE status = 'active' AND piece_id IN (SELECT id FROM pieces WHERE consignor_id = $1)",
    [consignorId]
  );
}

async function consignorById(ctx: RouteContext, id: string): Promise<{ id: string; name: string; email: string | null; phone: string | null; iban: string | null; status: string; created_at: Date } | null> {
  const { rows } = await ctx.services.pool.query('SELECT * FROM consignors WHERE id = $1', [id]);
  return rows[0] ?? null;
}

function requireJson(ctx: RouteContext): void {
  const type = ctx.req.headers['content-type'] ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    throw new ApiError(415, 'unsupported_media_type', 'Send JSON with a content type of application/json.');
  }
}

/** Period-end transitions for one consignor's pieces (DP-50), applied on read. */
async function refreshPieceStates(ctx: RouteContext, consignorId: string, now: Date): Promise<void> {
  const { rows } = await ctx.services.pool.query<PieceRow>(
    "SELECT * FROM pieces WHERE consignor_id = $1 AND status IN ('on_rail', 'on_hold', 'returns_shelf')", [consignorId]
  );
  for (const piece of rows) {
    const ladder = (await ctx.services.pool.query<LadderRow>('SELECT * FROM ladders WHERE id = $1', [piece.ladder_id])).rows[0]!;
    const l = ladderJson(ladder);
    const endsAt = brusselsMidnight(addDays(piece.intake_date, l.periodEndDay));
    const shelfDeadline = brusselsMidnight(addDays(piece.intake_date, l.periodEndDay + 14));
    if (now.getTime() >= endsAt.getTime() && (piece.status === 'on_rail' || piece.status === 'on_hold')) {
      await ctx.services.pool.query('UPDATE pieces SET status = $1 WHERE id = $2',
        [piece.choice === 'return' ? 'returns_shelf' : 'donation_box', piece.id]);
    } else if (now.getTime() >= shelfDeadline.getTime() && piece.status === 'returns_shelf') {
      await ctx.services.pool.query("UPDATE pieces SET status = 'donation_box' WHERE id = $1", [piece.id]);
    }
  }
}

