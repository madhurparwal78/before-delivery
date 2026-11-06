/** The internal signed tick endpoint. */
import { transact } from '../db';
import { ApiResponse, RequestContext, headerOf, readRawJsonBody } from '../http';
import { fail, validationFailure } from '../errors';
import { compare, fractionalDigits, isZero, isNegative, parseDecimal } from '../../shared/decimal';
import { isSessionOpenAt } from '../../domain/calendar';
import { toIso } from '../../shared/nytime';
import { verifyTickSignature } from '../../domain/tickSignature';
import { marketClockNow } from '../marketClock';
import { getTickKey } from '../secrets';
import { storeMnavAt } from '../computations';

const TICK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

interface StoredTick {
  id: string;
  instrument: string;
  price: string;
  at: Date;
}

function tickBody(tick: StoredTick): { tick: { id: string; instrument: string; price: string; at: string } } {
  return {
    tick: {
      id: tick.id,
      instrument: tick.instrument,
      price: tick.price,
      at: toIso(tick.at.getTime()),
    },
  };
}

function samePrice(left: string, right: string): boolean {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  return a !== null && b !== null && compare(a, b) === 0;
}

export async function postTick(context: RequestContext): Promise<ApiResponse> {
  const raw = await readRawJsonBody(context);
  let parsed: unknown;
  try {
    parsed = raw.length === 0 ? {} : JSON.parse(raw.toString('utf8'));
  } catch {
    throw fail('invalid_json');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw fail('invalid_json');
  }
  const body = parsed as Record<string, unknown>;

  const nowMs = await marketClockNow();
  const signatureFailure = verifyTickSignature(
    headerOf(context, 'x-tick-signature'),
    raw,
    getTickKey(),
    nowMs,
  );
  if (signatureFailure !== null) throw fail(signatureFailure);

  const id = body.id;
  const instrument = body.instrument;
  const price = body.price;

  if (typeof id === 'string' && TICK_ID_PATTERN.test(id)) {
    const stored = await transact(async (tx) => {
      const rows = await tx.query<StoredTick>(
        'SELECT id, instrument, price, at FROM tick WHERE id = $1',
        [id],
      );
      return rows[0] ?? null;
    });
    if (stored !== null) {
      if (
        typeof instrument === 'string' &&
        instrument === stored.instrument &&
        typeof price === 'string' &&
        samePrice(price, stored.price)
      ) {
        return { status: 200, json: tickBody(stored) };
      }
      throw fail('tick_id_conflict');
    }
  }

  if (instrument === 'VLCH' && !isSessionOpenAt(nowMs)) throw fail('session_closed');

  const failures: Record<string, string> = {};
  if (typeof id !== 'string' || !TICK_ID_PATTERN.test(id)) {
    failures.id = 'Enter a tick id of 1 to 64 letters, digits, underscores or hyphens.';
  }
  if (instrument !== 'ETH-USD' && instrument !== 'VLCH') {
    failures.instrument = 'Enter ETH-USD or VLCH.';
  }
  if (typeof price !== 'string') {
    failures.price = 'Enter a positive price of up to 8 decimal places.';
  } else {
    const parsedPrice = parseDecimal(price);
    if (
      parsedPrice === null ||
      isNegative(parsedPrice) ||
      isZero(parsedPrice) ||
      fractionalDigits(price) > 8
    ) {
      failures.price = 'Enter a positive price of up to 8 decimal places.';
    }
  }
  if (Object.keys(failures).length > 0) throw validationFailure(failures);

  const tickId = id as string;
  const tickInstrument = instrument as 'ETH-USD' | 'VLCH';
  const tickPrice = price as string;

  const outcome = await transact(async (tx) => {
    const inserted = await tx.query<StoredTick>(
      `INSERT INTO tick (id, instrument, price, at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING
         RETURNING id, instrument, price, at`,
      [tickId, tickInstrument, tickPrice, new Date(nowMs)],
    );
    const stored = inserted[0];
    if (stored === undefined) return null;
    await storeMnavAt(tx, nowMs);
    return stored;
  });

  if (outcome === null) {
    const existing = await transact(async (tx) => {
      const rows = await tx.query<StoredTick>(
        'SELECT id, instrument, price, at FROM tick WHERE id = $1',
        [tickId],
      );
      return rows[0] ?? null;
    });
    if (existing === null) throw fail('internal');
    if (existing.instrument === tickInstrument && samePrice(tickPrice, existing.price)) {
      return { status: 200, json: tickBody(existing) };
    }
    throw fail('tick_id_conflict');
  }

  return { status: 201, json: tickBody(outcome) };
}
