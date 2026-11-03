import { formatCents, parseMoney } from '../../shared/money';
import { Quote, RequestObject } from '../../shared/types';
import { Db, pool, query, queryOne, withTransaction } from '../db/pool';
import { fail, feeChanged, invalidTransition } from '../http/errors';
import {
  ChargeItem,
  cancellationChargeKey,
  ensureAccount,
  findChargeByKey,
  postCharge,
} from '../services/killbill';
import { queueEmail } from '../services/mail';
import { cancellationEmail } from '../services/notifications';
import { writeAudit } from './audit';
import { ratesMap } from './rates';
import {
  CANCELLABLE_STATUSES,
  FeeQuote,
  cancellationWindowHours,
  computeCancellationQuote,
  durationMinutesOf,
} from './rules';
import { RequestRow, loadRequestRow, serializeRequest } from './requests';

interface SeatedInterpreter {
  id: string;
  name: string;
  email: string;
}

async function seatedInterpreters(db: Db, requestId: string): Promise<SeatedInterpreter[]> {
  return query<SeatedInterpreter>(
    db,
    `select u.id, u.name, u.email
     from seats s
     join offers o on o.seat_id = s.id and o.status = 'accepted'
     join users u on u.id = o.interpreter_id
     where s.request_id = $1
     order by s.position`,
    [requestId],
  );
}

/** Guards shared by the quote endpoint and the cancel endpoint. */
export function guardCancellable(request: RequestObject, now: Date): void {
  if (!CANCELLABLE_STATUSES.includes(request.status)) throw invalidTransition(request.status);
  if (request.status !== 'draft' && new Date(request.start).getTime() <= now.getTime()) {
    throw fail('already_started');
  }
}

export async function quoteFor(
  db: Db,
  row: RequestRow,
  request: RequestObject,
  now: Date,
): Promise<FeeQuote> {
  const rates = await ratesMap(db);
  return computeCancellationQuote({
    durationMinutes: durationMinutesOf(row.start_at, row.end_at),
    startAt: row.start_at,
    now,
    seated: request.seats_accepted,
    rateCents: rates[row.setting],
    isDraft: request.status === 'draft',
  });
}

const CANCELLATION_ITEM = /^\[cx-[^\]]+\] \S+ late cancellation: (\d+) x ([0-9]+\.[0-9]{2}) h at \$([0-9]+\.[0-9]{2})\/h$/;

/** Adopts a charge an earlier uncertain attempt left in Kill Bill, with its own values. */
function reconciledQuote(item: ChargeItem, row: RequestRow, now: Date): FeeQuote {
  const match = CANCELLATION_ITEM.exec(item.description);
  if (!match) throw new Error(`unreadable cancellation charge: ${item.description}`);
  const durationMinutes = durationMinutesOf(row.start_at, row.end_at);
  const seated = Number(match[1]);
  const chargeHours = String(match[2]);
  const rateCents = parseMoney(String(match[3])) ?? 0;
  const feePerInterpreterCents = Math.round(item.amountCents / seated);
  return {
    feeCents: item.amountCents,
    feePerInterpreterCents,
    quote: {
      late: true,
      window_hours: cancellationWindowHours(durationMinutes),
      hours_before_start: ((row.start_at.getTime() - now.getTime()) / 3600000).toFixed(2),
      seated,
      charge_hours_per_interpreter: chargeHours,
      hourly_rate: formatCents(rateCents),
      fee_per_interpreter: formatCents(feePerInterpreterCents),
      fee: formatCents(item.amountCents),
    },
  };
}

function chargeDescription(row: RequestRow, quote: Quote): string {
  return (
    `[${cancellationChargeKey(row.id)}] ${row.ref} late cancellation: ` +
    `${quote.seated} x ${quote.charge_hours_per_interpreter} h at $${quote.hourly_rate}/h`
  );
}

export interface CancelResult {
  request: RequestObject;
  quote: Quote;
}

export async function cancelRequest(input: {
  row: RequestRow;
  request: RequestObject;
  actorId: string;
  expectedFee: string;
  reason: string;
  now: Date;
}): Promise<CancelResult> {
  const { row, request, actorId, now } = input;
  guardCancellable(request, now);

  const fresh = await quoteFor(pool, row, request, now);
  const chargeable = fresh.feeCents > 0;
  const accountId = chargeable ? await ensureAccount(pool, row.org_id, row.org_name) : null;
  const existingItem = accountId
    ? await findChargeByKey(accountId, cancellationChargeKey(row.id))
    : null;
  const effective = existingItem ? reconciledQuote(existingItem, row, now) : fresh;

  if (input.expectedFee !== effective.quote.fee) throw feeChanged(effective.quote);

  if (accountId && !existingItem) {
    await postCharge(accountId, effective.feeCents, chargeDescription(row, effective.quote));
  }

  const seated = await seatedInterpreters(pool, row.id);
  const status = effective.quote.late ? 'cancelled_late' : 'cancelled_on_time';

  await withTransaction(async (client) => {
    const current = await queryOne<{ status: string }>(
      client,
      'select status from requests where id = $1 for update',
      [row.id],
    );
    if (!current) throw fail('not_found');
    if (!CANCELLABLE_STATUSES.includes(current.status as RequestObject['status'])) {
      throw invalidTransition(current.status);
    }
    await client.query(
      `update requests
         set status = $2, cancellation_fee_cents = $3, cancellation_quote = $4::jsonb,
             cancellation_reason = $5
       where id = $1`,
      [row.id, status, effective.feeCents, JSON.stringify(effective.quote), input.reason],
    );
    await writeAudit(client, {
      actorId,
      action: 'request.cancelled',
      entity: 'request',
      entityId: row.id,
      requestId: row.id,
      from: current.status,
      to: status,
      detail: { fee: effective.quote.fee, reason: input.reason },
    });
    const activeOffers = await query<{ id: string; seat_id: string }>(
      client,
      `select id, seat_id from offers where request_id = $1 and status = 'active' order by seat_id`,
      [row.id],
    );
    for (const offer of activeOffers) {
      await client.query(
        `update offers set status = 'withdrawn', answered_at = $2 where id = $1`,
        [offer.id, now],
      );
      await client.query(`update seats set status = 'open' where id = $1`, [offer.seat_id]);
      await writeAudit(client, {
        actorId,
        action: 'offer.withdrawn',
        entity: 'offer',
        entityId: offer.id,
        requestId: row.id,
        from: 'active',
        to: 'withdrawn',
      });
    }
    for (const interpreter of seated) {
      await queueEmail(client, {
        dedupeKey: `cancelled-${row.id}-${interpreter.id}`,
        ...cancellationEmail({
          request: row,
          interpreterName: interpreter.name,
          interpreterEmail: interpreter.email,
          quote: effective.quote,
        }),
      });
    }
  });

  const updated = await loadRequestRow(pool, row.id);
  if (!updated) throw fail('not_found');
  return {
    request: await serializeRequest(pool, updated, now),
    quote: effective.quote,
  };
}
