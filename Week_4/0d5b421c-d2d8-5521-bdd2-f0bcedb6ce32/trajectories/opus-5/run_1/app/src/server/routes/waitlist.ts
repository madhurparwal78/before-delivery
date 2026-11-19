import { Router } from 'express';
import type { ConfirmResponse, OfferResponse, WaitlistResponse } from '../../shared/types';
import { serverNow } from '../clock';
import { pool, query, withTransaction } from '../db';
import { commitBooking } from '../domain/bookingFlow';
import { reserveReference } from '../domain/bookings';
import { claimKeysFor } from '../domain/claims';
import { loadLayout, requireRoom, requireUnit } from '../domain/floor';
import { newToken } from '../domain/rules';
import { ENTRY_COLUMNS, entryPosition, type WaitlistEntryRow } from '../domain/waitlist';
import { errors } from '../errors';
import { asyncHandler, sendJson } from '../http';
import { readIdempotencyKey, withIdempotency } from '../idempotency';
import { valkeyAnswering } from '../services/valkey';
import { isoUtc, isoWithLisbonOffset } from '../time';
import { asRecord, Validator } from '../validate';

export const waitlistRouter = Router();

interface OfferRow {
  offer_id: string;
  entry_id: string;
  token: string;
  date: string;
  time: string;
  starts_at: Date;
  window_start: Date;
  window_end: Date;
  party_size: number;
  unit_id: string;
  deposit_cents: number;
  status: string;
  expires_at: Date;
  reserved_reference: string | null;
}

const OFFER_COLUMNS = `
  offer_id, entry_id, token, to_char(date, 'YYYY-MM-DD') as date, time, starts_at, window_start,
  window_end, party_size, unit_id, deposit_cents, status, expires_at, reserved_reference
`;

async function findOfferByToken(token: string): Promise<OfferRow | null> {
  const result = await query<OfferRow>(
    pool,
    `select ${OFFER_COLUMNS} from offers where token = $1`,
    [token],
  );
  return result.rows[0] ?? null;
}

function assertOfferLive(offer: OfferRow, now: Date): void {
  if (offer.status === 'claimed') throw errors.offerClaimed();
  if (offer.status === 'lapsed') throw errors.offerExpired();
  if (new Date(offer.expires_at).getTime() <= now.getTime()) throw errors.offerExpired();
}

waitlistRouter.post(
  '/waitlist',
  asyncHandler(async (req, res) => {
    const now = serverNow();
    const body = asRecord(req.body);
    const validator = new Validator();
    const earliest = validator.slotTime('earliest', body.earliest);
    const latest = validator.slotTime('latest', body.latest);
    validator.windowOrder('latest', earliest, latest);
    const checked = validator.finish({
      date: validator.date('date', body.date, now),
      partySize: validator.partyFromBody('party_size', body.party_size),
      name: validator.name('name', body.name),
      email: validator.email('email', body.email),
      earliest,
      latest,
    });

    const emailLower = checked.email.toLowerCase();
    const result = await withTransaction(async (client) => {
      const existing = await query<WaitlistEntryRow>(
        client,
        `select ${ENTRY_COLUMNS} from waitlist_entries
         where date = $1 and email_lower = $2 and status in ('waiting', 'offered')`,
        [checked.date, emailLower],
      );
      const found = existing.rows[0];
      if (found) {
        return {
          status: 200,
          entry: found,
        };
      }
      const inserted = await query<WaitlistEntryRow>(
        client,
        `insert into waitlist_entries(entry_id, date, email, email_lower, name, party_size,
           earliest, latest, status, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'waiting', now())
         returning ${ENTRY_COLUMNS}`,
        [
          newToken(),
          checked.date,
          checked.email,
          emailLower,
          checked.name,
          checked.partySize,
          checked.earliest,
          checked.latest,
        ],
      );
      const entry = inserted.rows[0];
      if (!entry) throw new Error('Waitlist insert returned no row');
      return { status: 201, entry };
    }).catch(async (error: unknown) => {
      if ((error as { code?: string }).code !== '23505') throw error;
      const existing = await query<WaitlistEntryRow>(
        pool,
        `select ${ENTRY_COLUMNS} from waitlist_entries
         where date = $1 and email_lower = $2 and status in ('waiting', 'offered')`,
        [checked.date, emailLower],
      );
      const entry = existing.rows[0];
      if (!entry) throw error;
      return { status: 200, entry };
    });

    const position = await entryPosition(pool, result.entry.date, result.entry.seq);
    const response: WaitlistResponse = {
      entry_id: result.entry.entry_id,
      status: result.entry.status,
      position,
    };
    sendJson(res, result.status, response);
  }),
);

waitlistRouter.get(
  '/offers/:token',
  asyncHandler(async (req, res) => {
    const now = serverNow();
    const layout = await loadLayout();
    const offer = await findOfferByToken(req.params.token ?? '');
    if (!offer) throw errors.notFound();
    assertOfferLive(offer, now);
    const unit = requireUnit(layout, offer.unit_id);
    const body: OfferResponse = {
      status: 'offered',
      date: offer.date,
      time: offer.time,
      starts_at: isoWithLisbonOffset(new Date(offer.starts_at)),
      party_size: offer.party_size,
      table_id: offer.unit_id,
      room: requireRoom(layout, unit.roomId).name,
      expires_at: isoUtc(new Date(offer.expires_at)),
      server_now: isoUtc(now),
      deposit_cents: offer.deposit_cents,
    };
    sendJson(res, 200, body);
  }),
);

waitlistRouter.post(
  '/offers/:token/claim',
  asyncHandler(async (req, res) => {
    const key = readIdempotencyKey(req.headers['idempotency-key'] as string | undefined);
    const token = req.params.token ?? '';
    const outcome = await withIdempotency(
      key,
      'POST',
      `/api/offers/${token}/claim`,
      req.body,
      async () => {
        const layout = await loadLayout();
        const offer = await findOfferByToken(token);
        if (!offer) throw errors.notFound();
        assertOfferLive(offer, serverNow());
        if (!(await valkeyAnswering())) throw errors.holdsPaused();

        const entryResult = await query<WaitlistEntryRow>(
          pool,
          `select ${ENTRY_COLUMNS} from waitlist_entries where entry_id = $1`,
          [offer.entry_id],
        );
        const entry = entryResult.rows[0];
        if (!entry) throw errors.notFound();

        const reference =
          offer.reserved_reference ??
          (await withTransaction(async (client) => {
            const candidate = await reserveReference(client);
            const updated = await query<{ reserved_reference: string }>(
              client,
              `update offers set reserved_reference = coalesce(reserved_reference, $2)
               where offer_id = $1 returning reserved_reference`,
              [offer.offer_id, candidate],
            );
            return updated.rows[0]?.reserved_reference ?? candidate;
          }));

        const unit = requireUnit(layout, offer.unit_id);
        const result = await commitBooking({
          source: 'waitlist',
          date: offer.date,
          time: offer.time,
          startsAt: new Date(offer.starts_at),
          windowStart: new Date(offer.window_start),
          windowEnd: new Date(offer.window_end),
          partySize: offer.party_size,
          unit,
          depositCents: offer.deposit_cents,
          reference,
          name: entry.name,
          email: entry.email,
          phone: null,
          owner: {
            kind: 'offer',
            id: offer.offer_id,
            entryId: offer.entry_id,
            claimKeys: claimKeysFor(unit, {
              start: new Date(offer.window_start),
              end: new Date(offer.window_end),
            }),
          },
        });
        const response: ConfirmResponse = {
          booking: result.booking,
          manage_url: result.manageUrl,
        };
        return { status: 201, body: response };
      },
      `offer:${token}`,
    );
    sendJson(res, outcome.status, outcome.body);
  }),
);
