/**
 * The private client page: its address, its lifetime, its language, the seat
 * height and the sign-off by typed name.
 */
import { randomBytes } from 'node:crypto';
import { F } from '../../shared/feedback.ts';
import { c, cFill, TOWN_NAMES } from '../../shared/clientCopy.ts';
import type { Language } from '../../shared/language.ts';
import { readSeatHeight, seatHeightText } from '../domain/seatHeight.ts';
import { isBlank, namesMatch } from '../domain/names.ts';
import {
  endOfLocalDay,
  instantText,
  localTime,
  parseDate,
  BUSINESS_ZONE,
  TOWN_ZONE,
  type Town,
} from '../domain/time.ts';
import { fail } from '../http/errors.ts';
import type { Ctx, Route } from '../http/context.ts';
import { resolvePiece, piece as resolved } from './lookup.ts';
import type { Row } from '../present.ts';
import { storageKeys, StorageUnavailable } from '../services/storage.ts';
import { queueClientPageLetter } from '../features/letters.ts';
import { clientPageBody, lookupClientPage, type ClientPageFacts } from '../features/clientPageData.ts';

/** At least 128 bits of random data. */
function newPageToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * The page ends at the earlier of 23:59:59 client local wall time on the due
 * date and CLIENT_PAGE_SECONDS after sending.
 */
export function pageEnd(ctx: Ctx, town: Town, dueDate: string, sentAtMs: number): number {
  const due = parseDate(dueDate);
  if (!due) throw new Error('a client page needs a due date');
  const endOfDue = endOfLocalDay(TOWN_ZONE[town], due);
  const afterSending = sentAtMs + ctx.app.config.timers.clientPageSeconds * 1000;
  return Math.min(endOfDue, afterSending);
}

async function currentEstimate(ctx: Ctx, pieceId: string): Promise<Row | null> {
  return ctx.app.db.one<Row>(
    `SELECT * FROM estimates WHERE piece_id = $1 AND state IN ('open','signedOff')
      ORDER BY version DESC LIMIT 1`,
    [pieceId],
  );
}

/** Resolves the token before the content type is checked. */
async function resolvePageToken(ctx: Ctx): Promise<void> {
  const found = await lookupClientPage(ctx.app, ctx.param('token'));
  if (found.kind === 'missing') throw fail.notFound();
  if (found.kind === 'ended') throw fail.ended(c('C20', found.language));
  ctx.resolved.page = found.row;
  pageFacts.set(ctx, found.facts);
}

/** The facts read alongside the row, kept for this one request. */
const pageFacts = new WeakMap<Ctx, ClientPageFacts>();

function facts(ctx: Ctx): ClientPageFacts {
  const found = pageFacts.get(ctx);
  if (!found) throw fail.notFound();
  return found;
}

export const clientPageRoutes: readonly Route[] = [
  {
    method: 'POST',
    pattern: '/api/pieces/:id/client-page',
    auth: 'required',
    body: 'json',
    resolve: resolvePiece,
    async handle(ctx) {
      const piece = resolved(ctx);
      if (piece.due_date === null) throw fail.conflict(F.needDueDate);
      const email = piece.client_email;
      if (email === null || email === undefined || String(email).length === 0) {
        throw fail.conflict(F.needClientEmail);
      }

      const now = ctx.app.now();
      const town = String(piece.town) as Town;
      const endsAt = pageEnd(ctx, town, String(piece.due_date), now);
      const token = newPageToken();

      // A new address ends the old one.
      await ctx.app.db.query(
        `UPDATE client_pages SET state = 'ended' WHERE piece_id = $1 AND state = 'live'`,
        [piece.id],
      );
      const row = await ctx.app.db.one<Row>(
        `INSERT INTO client_pages (piece_id, token, sent_at, ends_at)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [piece.id, token, new Date(now), new Date(endsAt)],
      );

      const address = `${ctx.publicBase()}/c/${token}`;
      await queueClientPageLetter(ctx.app, {
        clientId: String(piece.client_id),
        recipient: String(email),
        language: String(piece.language) as Language,
        clientName: String(piece.client_name),
        pieceTitle: String(piece.title),
        dueDate: String(piece.due_date),
        town,
        address,
        reminder: false,
      });

      ctx.json(201, {
        clientPage: {
          address,
          endsAt: instantText(endsAt),
          sentAt: instantText(new Date(row!.sent_at as string).getTime()),
        },
      });
    },
  },

  {
    method: 'GET',
    pattern: '/api/pieces/:id/client-page',
    auth: 'required',
    resolve: resolvePiece,
    async handle(ctx) {
      const piece = resolved(ctx);
      const row = await ctx.app.db.one<Row>(
        `SELECT * FROM client_pages WHERE piece_id = $1 ORDER BY id DESC LIMIT 1`,
        [piece.id],
      );
      if (!row) {
        ctx.json(200, { clientPage: null });
        return;
      }
      const endsAt = new Date(row.ends_at as string).getTime();
      const live = row.state === 'live' && ctx.app.now() < endsAt;
      const estimate = await currentEstimate(ctx, String(piece.id));
      ctx.json(200, {
        clientPage: {
          address: live ? `${ctx.publicBase()}/c/${String(row.token)}` : null,
          endsAt: instantText(endsAt),
          sentAt: instantText(new Date(row.sent_at as string).getTime()),
          state: live ? 'live' : 'ended',
          answer:
            row.answered_at === null
              ? null
              : {
                  seatHeightCm: String(row.seat_height),
                  typed: String(row.seat_height_text),
                  answeredAt: instantText(new Date(row.answered_at as string).getTime()),
                },
          signOff:
            estimate && estimate.signed_at
              ? {
                  typedName: String(estimate.signed_by),
                  at: instantText(new Date(estimate.signed_at as string).getTime()),
                }
              : null,
        },
      });
    },
  },

  {
    method: 'DELETE',
    pattern: '/api/pieces/:id/client-page',
    auth: 'required',
    resolve: resolvePiece,
    async handle(ctx) {
      await ctx.app.db.query(
        `UPDATE client_pages SET state = 'ended' WHERE piece_id = $1 AND state = 'live'`,
        [resolved(ctx).id],
      );
      ctx.noContent();
    },
  },

  {
    method: 'GET',
    pattern: '/api/client-pages/:token',
    auth: 'none',
    resolve: resolvePageToken,
    async handle(ctx) {
      ctx.json(200, { page: clientPageBody(facts(ctx)) });
    },
  },

  {
    method: 'POST',
    pattern: '/api/client-pages/:token/answer',
    auth: 'none',
    body: 'json',
    resolve: resolvePageToken,
    async handle(ctx) {
      const page = ctx.resolved.page!;
      const language = String(page.language) as Language;
      const typed = ctx.body.seatHeight;
      if (typeof typed !== 'string' || isBlank(typed)) {
        throw fail.fields({ seatHeight: c('C23', language) });
      }
      const read = readSeatHeight(typed, language);
      if (read.kind === 'blank') throw fail.fields({ seatHeight: c('C23', language) });
      if (read.kind === 'refused') throw fail.fields({ seatHeight: c('C13', language) });

      const now = ctx.app.now();
      // A later answer overwrites the earlier one and notifies again.
      await ctx.app.db.query(
        `UPDATE client_pages SET seat_height = $2, seat_height_text = $3, answered_at = $4
          WHERE id = $1`,
        [page.id, seatHeightText(read.value), typed, new Date(now)],
      );
      ctx.json(200, {
        answer: {
          seatHeightCm: seatHeightText(read.value),
          typed,
          answeredAt: instantText(now),
        },
      });
    },
  },

  {
    method: 'POST',
    pattern: '/api/client-pages/:token/sign-off',
    auth: 'none',
    body: 'json',
    resolve: resolvePageToken,
    async handle(ctx) {
      const page = ctx.resolved.page!;
      const language = String(page.language) as Language;
      const town = String(page.town) as Town;

      const typedName = ctx.body.typedName;
      if (typeof typedName !== 'string' || isBlank(typedName)) {
        throw fail.fields({ typedName: c('C23', language) });
      }
      if (!namesMatch(typedName, String(page.client_name))) {
        throw fail.fields({ typedName: c('C14', language) });
      }

      const estimateId = ctx.body.estimateId;
      if (typeof estimateId !== 'string' && typeof estimateId !== 'number') {
        throw fail.fields({ estimateId: c('C23', language) });
      }
      const estimate = await ctx.app.db.one<Row>(
        `SELECT * FROM estimates WHERE id = $1 AND piece_id = $2`,
        [String(estimateId), page.piece_id],
      );
      if (!estimate) throw fail.notFound();

      if (estimate.state === 'replaced') {
        const newer = await currentEstimate(ctx, String(page.piece_id));
        const at = newer ? new Date(newer.created_at as string).getTime() : ctx.app.now();
        throw fail.conflictCode(
          'estimateReplaced',
          cFill('C18', language, { time: localTime(BUSINESS_ZONE, at) }),
        );
      }

      if (estimate.signed_at) {
        const at = new Date(estimate.signed_at as string).getTime();
        throw fail.conflictCode(
          'alreadySignedOff',
          cFill('C17', language, {
            time: localTime(TOWN_ZONE[town], at),
            town: TOWN_NAMES[town]?.[language] ?? town,
          }),
        );
      }

      // Two windows record one approval: the first update to land wins.
      const now = ctx.app.now();
      const signed = await ctx.app.db.one<Row>(
        `UPDATE estimates SET state = 'signedOff', signed_by = $2, signed_at = $3
          WHERE id = $1 AND signed_at IS NULL RETURNING *`,
        [estimate.id, String(page.client_name), new Date(now)],
      );
      if (!signed) {
        const again = await ctx.app.db.one<Row>(`SELECT signed_at FROM estimates WHERE id = $1`, [
          estimate.id,
        ]);
        const at = new Date(again!.signed_at as string).getTime();
        throw fail.conflictCode(
          'alreadySignedOff',
          cFill('C17', language, {
            time: localTime(TOWN_ZONE[town], at),
            town: TOWN_NAMES[town]?.[language] ?? town,
          }),
        );
      }
      ctx.json(200, { signOff: { at: instantText(now) } });
    },
  },

  {
    method: 'GET',
    pattern: '/api/client-pages/:token/photographs/:side',
    auth: 'none',
    resolve: resolvePageToken,
    async handle(ctx) {
      const page = ctx.resolved.page!;
      const side = ctx.param('side');
      if (side !== 'before' && side !== 'after') throw fail.notFound();
      const row = await ctx.app.db.one<Row>(
        `SELECT sha256 FROM photographs WHERE piece_id = $1 AND side = $2 AND state = 'stored'
          ORDER BY number DESC LIMIT 1`,
        [page.piece_id, side],
      );
      if (!row) throw fail.notFound();
      let bytes: Uint8Array | null;
      try {
        bytes = await ctx.app.storage.get(
          storageKeys.photograph(String(page.desk_id), String(page.piece_id), String(row.sha256)),
        );
      } catch (error) {
        if (!(error instanceof StorageUnavailable)) throw error;
        throw fail.unavailable(F.storeDown);
      }
      if (!bytes) throw fail.notFound();
      ctx.bytes(bytes, 'image/png');
    },
  },
];
