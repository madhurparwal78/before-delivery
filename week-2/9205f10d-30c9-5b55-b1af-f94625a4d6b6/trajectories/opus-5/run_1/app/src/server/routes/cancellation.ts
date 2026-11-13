import { transact } from '../db.js';
import { ApiError } from '../http/errors.js';
import { json, type RouteContext, type RouteResult } from '../http/context.js';
import { route, type Route } from '../http/router.js';
import { toAgencyIso } from '../domain/agency-time.js';
import { freeCancelUntil, isLateCancellation } from '../domain/cutoff.js';
import { computeCharge } from '../domain/charge.js';
import { formatDollars, parseDollars } from '../domain/money.js';
import { endsAt } from '../domain/projection.js';
import { loadInterpreters, writeHistory, type LoadedRequest } from '../store/requests.js';
import { insertCharge, projectInvoice, reloadCharge } from '../store/charges.js';
import { queueEmails } from '../store/emails.js';
import { assignmentCancelledEmail, cancellationReceiptEmail } from '../mail/templates.js';
import { postPendingCharges } from '../workers/billing-poster.js';
import { readableRequest, viewById } from './common.js';
import { readExpectedFee, readIdempotencyKey, requireJsonContentType } from './validation.js';
import { bodyHash, rememberIdempotentResponse, replayOrReject } from './idempotency.js';
import type { Quote, RequestStatus } from '../../shared/types.js';

const CANCELLABLE: readonly RequestStatus[] = ['draft', 'submitted', 'half-staffed', 'staffed'];

/** The one cancellation quote rule, shared by the quote and the cancel endpoints. */
function quoteFor(loaded: LoadedRequest, now: Date): Quote {
  const cutoff = freeCancelUntil(loaded.row.starts_at);
  const late = isLateCancellation(loaded.row.starts_at, now);
  const confirmedSeats = loaded.seats.filter((seat) => seat.status === 'confirmed').length;
  const rate = parseDollars(loaded.row.hourly_rate) ?? 0n;
  if (!late) {
    return {
      kind: 'early',
      fee: '0.00',
      free_cancel_until: toAgencyIso(cutoff),
      billable_minutes: 0,
      seats_charged: 0,
      hourly_rate: loaded.row.hourly_rate,
    };
  }
  const charge = computeCharge(loaded.row.duration_minutes, confirmedSeats, rate);
  return {
    kind: 'late',
    fee: charge.amount,
    free_cancel_until: toAgencyIso(cutoff),
    billable_minutes: charge.billable_minutes,
    seats_charged: confirmedSeats,
    hourly_rate: loaded.row.hourly_rate,
  };
}

async function cancellationQuote(ctx: RouteContext): Promise<RouteResult> {
  const actor = ctx.requireActor();
  const loaded = await readableRequest(actor, ctx.param('id'));
  ctx.gate('client_scheduler', 'coordinator');
  if (!CANCELLABLE.includes(loaded.row.status)) throw new ApiError('invalid_transition');
  return json(quoteFor(loaded, new Date()));
}

async function cancelRequest(ctx: RouteContext): Promise<RouteResult> {
  const actor = ctx.requireActor();
  const requestId = ctx.param('id');
  const loaded = await readableRequest(actor, requestId);
  ctx.gate('client_scheduler', 'coordinator');

  const body = ctx.body();
  const rawKey = ctx.header('idempotency-key');
  if (rawKey !== null && rawKey.length >= 1 && rawKey.length <= 64) {
    const replay = await replayOrReject(actor.id, {
      key: rawKey,
      endpoint: 'cancel',
      request_id: requestId,
      body_hash: bodyHash(body),
    });
    if (replay !== null) return replay;
  }

  if (!CANCELLABLE.includes(loaded.row.status)) throw new ApiError('invalid_transition');

  const now = new Date();
  const quote = quoteFor(loaded, now);
  const expectedRaw = body['expected_fee'];
  if (typeof expectedRaw === 'string' && parseDollars(expectedRaw) !== null) {
    if (parseDollars(expectedRaw) !== parseDollars(quote.fee)) {
      throw new ApiError('fee_changed', { quote });
    }
  }

  requireJsonContentType(ctx.hasWrongContentType());
  const key = readIdempotencyKey(rawKey);
  readExpectedFee(body);

  const feeCents = parseDollars(quote.fee) ?? 0n;
  const status: RequestStatus = quote.kind === 'late' ? 'cancelled_late' : 'cancelled_early';

  const chargeId = await transact(async (client) => {
    const confirmed = loaded.seats.filter(
      (seat) => seat.status === 'confirmed' && seat.interpreter_id !== null,
    );
    const interpreters = await loadInterpreters(
      confirmed.map((seat) => seat.interpreter_id as string),
      client,
    );

    await client.query(`UPDATE requests SET status = $2 WHERE id = $1`, [requestId, status]);
    await client.query(
      `UPDATE seats SET status = 'open', interpreter_id = NULL, confirmed_at = NULL WHERE request_id = $1`,
      [requestId],
    );

    let created: string | null = null;
    if (feeCents > 0n) {
      created = await insertCharge(client, {
        request_id: requestId,
        kind: 'late_cancellation',
        billable_minutes: quote.billable_minutes,
        seats: quote.seats_charged,
        hourly_rate: loaded.row.hourly_rate,
        amount: quote.fee,
      });
    }

    await writeHistory(
      client,
      requestId,
      actor.display_name,
      'cancelled',
      `${quote.kind} cancellation, fee $${formatDollars(feeCents)}`,
    );

    const facts = {
      reference: loaded.row.reference,
      setting: loaded.row.setting,
      required_credential: loaded.row.required_credential,
      starts_at: loaded.row.starts_at,
      ends_at: endsAt(loaded.row.starts_at, loaded.row.duration_minutes),
      city: loaded.row.city,
    };
    const scheduler = await client.query<{ email: string }>(
      `SELECT email FROM people WHERE role = 'client_scheduler' AND organisation_id = $1`,
      [loaded.row.organisation_id],
    );
    const emails = scheduler.rows.map((row) =>
      cancellationReceiptEmail(facts, row.email, {
        late: quote.kind === 'late',
        fee: quote.fee,
        billable_minutes: quote.billable_minutes,
        seats_charged: quote.seats_charged,
      }),
    );
    for (const seat of confirmed) {
      const person = interpreters.get(seat.interpreter_id as string);
      if (person !== undefined) emails.push(assignmentCancelledEmail(facts, person.email));
    }
    await queueEmails(client, emails);
    return created;
  });

  if (chargeId !== null) await postPendingCharges(chargeId).catch(() => undefined);

  const result = {
    request: await viewById(actor, requestId, now),
    invoice: chargeId === null ? null : projectInvoice(await reloadCharge(chargeId)),
  };
  await transact(async (client) => {
    await rememberIdempotentResponse(
      client,
      actor.id,
      { key, endpoint: 'cancel', request_id: requestId, body_hash: bodyHash(body) },
      200,
      result,
    );
  });
  return json(result);
}

export const cancellationRoutes: Route[] = [
  route('GET', '/api/requests/:id/cancellation-quote', cancellationQuote),
  route('POST', '/api/requests/:id/cancel', cancelRequest),
];
