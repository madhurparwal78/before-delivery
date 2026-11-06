import { longDateText } from '../../../shared/bilingual.js';
import { DROP_SCENTS } from '../../../shared/catalog.js';
import { BATCH_STATE_LABELS } from '../../../shared/catalog.js';
import {
  FIELD_MESSAGES,
  dropBeforeCureMessage,
  invalidTransitionMessage,
  stillCuringMessage,
  type BatchAction,
} from '../../../shared/copy.js';
import {
  LOCAL_DATE_TIME,
  TIME_ONLY,
  isValidDateString,
  torontoDate,
  torontoLocalToUtc,
} from '../../../shared/toronto.js';
import { takeNumber } from '../../db/numbers.js';
import { db, withTransaction, type Queryable } from '../../db/pool.js';
import {
  MAX_BARS_CUT,
  MAX_CURE_DAYS,
  MIN_BARS_CUT,
  MIN_CURE_DAYS,
  canApply,
  stateAfter,
} from '../../domain/batches.js';
import { parseBody, readInteger, readLiteral, type Reader } from '../../http/body.js';
import type { ApiResponse, RequestContext } from '../../http/context.js';
import { errors } from '../../http/errors.js';
import { cureDateOf, loadBatch, loadBatches, staffBatch, type LoadedBatch } from '../../repo/batches.js';
import { requireRole } from '../sessions.js';

const MAKER_ONLY = ['maker'] as const;

const readPourDate: Reader<string> = (raw, path, report) => {
  if (typeof raw !== 'string' || !isValidDateString(raw) || raw > torontoDate(new Date())) {
    report(path, FIELD_MESSAGES.poured_on);
    return torontoDate(new Date());
  }
  return raw;
};

const LOG_SHAPE = {
  scent: readLiteral(
    DROP_SCENTS.map((scent) => scent.slug),
    FIELD_MESSAGES.scent,
  ),
  poured_on: readPourDate,
  cure_days: readInteger(MIN_CURE_DAYS, MAX_CURE_DAYS, FIELD_MESSAGES.cure_days),
} as const;

const CUT_SHAPE = {
  bars: readInteger(MIN_BARS_CUT, MAX_BARS_CUT, FIELD_MESSAGES.bars_cut),
} as const;

const readLocalStamp: Reader<string> = (raw, path, report) => {
  if (typeof raw !== 'string' || !LOCAL_DATE_TIME.test(raw) || !isValidDateString(raw.slice(0, 10))) {
    report(path, FIELD_MESSAGES.drop_at_local_format);
    return '';
  }
  return raw;
};

const SCHEDULE_SHAPE = { drop_at_local: readLocalStamp } as const;

const NO_BODY_SHAPE = {} as const;

function refuse(batch: LoadedBatch, action: BatchAction): never {
  throw errors.conflict(
    'invalid_transition',
    invalidTransitionMessage(BATCH_STATE_LABELS[batch.state], action),
  );
}

export async function listStaffBatches(ctx: RequestContext): Promise<ApiResponse> {
  requireRole(ctx, MAKER_ONLY);
  const now = new Date();
  const batches = await loadBatches(db, now, null);
  return {
    status: 200,
    body: { server_now: now.toISOString(), batches: batches.map(staffBatch) },
  };
}

export async function logLoaf(ctx: RequestContext): Promise<ApiResponse> {
  requireRole(ctx, MAKER_ONLY);
  const parsed = parseBody(ctx.body, LOG_SHAPE);
  if (!parsed.ok) throw errors.invalid(parsed.fields);
  const now = new Date();
  const code = await withTransaction(async (client) => {
    const next = await takeNumber(client, 'batch');
    await client.query(
      `INSERT INTO batches (code, scent, state, poured_on, cure_days, bars_cut, drop_at)
       VALUES ($1, $2, 'poured', $3, $4, NULL, NULL)`,
      [next, parsed.value.scent, parsed.value.poured_on, parsed.value.cure_days],
    );
    return next;
  });
  const batch = await loadBatch(db, now, code);
  if (!batch) throw errors.notFound();
  return { status: 201, body: { batch: staffBatch(batch) } };
}

async function actOnBatch(
  ctx: RequestContext,
  action: BatchAction,
  apply: (client: Queryable, batch: LoadedBatch, now: Date) => Promise<void>,
): Promise<ApiResponse> {
  requireRole(ctx, MAKER_ONLY);
  const code = ctx.params['code'] ?? '';
  const now = new Date();
  await withTransaction(async (client) => {
    const locked = await client.query('SELECT code FROM batches WHERE code = $1 FOR UPDATE', [code]);
    if (locked.rowCount === 0) throw errors.notFound();
    const batch = await loadBatch(client, now, code);
    if (!batch) throw errors.notFound();
    if (!canApply(batch.state, action)) refuse(batch, action);
    await apply(client, batch, now);
  });
  const batch = await loadBatch(db, new Date(), code);
  if (!batch) throw errors.notFound();
  return { status: 200, body: { batch: staffBatch(batch) } };
}

export function cutBatch(ctx: RequestContext): Promise<ApiResponse> {
  return actOnBatch(ctx, 'cut', async (client, batch) => {
    const parsed = parseBody(ctx.body, CUT_SHAPE);
    if (!parsed.ok) throw errors.invalid(parsed.fields);
    await client.query('UPDATE batches SET state = $2, bars_cut = $3 WHERE code = $1', [
      batch.row.code,
      stateAfter('cut'),
      parsed.value.bars,
    ]);
    await client.query(
      `INSERT INTO stock_movements (batch_code, kind, bars, ref) VALUES ($1, 'cut', $2, NULL)`,
      [batch.row.code, Array.from({ length: parsed.value.bars }, (_, index) => index + 1)],
    );
  });
}

export function scheduleBatch(ctx: RequestContext): Promise<ApiResponse> {
  return actOnBatch(ctx, 'schedule', async (client, batch, now) => {
    const parsed = parseBody(ctx.body, SCHEDULE_SHAPE);
    if (!parsed.ok) throw errors.invalid(parsed.fields);
    const stamp = parsed.value.drop_at_local;
    const datePart = stamp.slice(0, 10);
    const resolved = torontoLocalToUtc(stamp);
    if (resolved.kind === 'gap') {
      throw errors.invalid({ drop_at_local: FIELD_MESSAGES.drop_at_local_gap });
    }
    if (resolved.instant.getTime() <= now.getTime()) {
      throw errors.invalid({ drop_at_local: FIELD_MESSAGES.drop_at_local_past });
    }
    const cureDate = cureDateOf(batch.row);
    if (datePart < cureDate) {
      throw errors.invalid({ drop_at_local: dropBeforeCureMessage(longDateText(cureDate)) });
    }
    await client.query('UPDATE batches SET state = $2, drop_at = $3 WHERE code = $1', [
      batch.row.code,
      stateAfter('schedule'),
      resolved.instant,
    ]);
  });
}

export function openBatch(ctx: RequestContext): Promise<ApiResponse> {
  return actOnBatch(ctx, 'open', async (client, batch, now) => {
    const parsed = parseBody(ctx.body, NO_BODY_SHAPE);
    if (!parsed.ok) throw errors.invalid(parsed.fields);
    const cureDate = cureDateOf(batch.row);
    if (torontoDate(now) < cureDate) {
      throw errors.invalid({ drop_at_local: stillCuringMessage(longDateText(cureDate)) });
    }
    await client.query('UPDATE batches SET state = $2, drop_at = $3 WHERE code = $1', [
      batch.row.code,
      stateAfter('open'),
      now,
    ]);
  });
}

export function withdrawBatch(ctx: RequestContext): Promise<ApiResponse> {
  return actOnBatch(ctx, 'withdraw', async (client, batch) => {
    const parsed = parseBody(ctx.body, NO_BODY_SHAPE);
    if (!parsed.ok) throw errors.invalid(parsed.fields);
    await client.query('UPDATE batches SET state = $2 WHERE code = $1', [
      batch.row.code,
      stateAfter('withdraw'),
    ]);
    await client.query(
      `UPDATE holds SET status = 'released' WHERE batch_code = $1 AND status = 'active'`,
      [batch.row.code],
    );
  });
}

export async function batchMovements(ctx: RequestContext): Promise<ApiResponse> {
  requireRole(ctx, MAKER_ONLY);
  const code = ctx.params['code'] ?? '';
  const exists = await db.query('SELECT 1 FROM batches WHERE code = $1', [code]);
  if (exists.rowCount === 0) throw errors.notFound();
  const result = await db.query<{
    at: Date;
    kind: string;
    bars: number[];
    ref: string | null;
  }>(`SELECT at, kind, bars, ref FROM stock_movements WHERE batch_code = $1 ORDER BY id`, [code]);
  return {
    status: 200,
    body: {
      movements: result.rows.map((row) => ({
        at: row.at.toISOString(),
        kind: row.kind,
        bars: row.bars,
        ref: row.ref,
      })),
    },
  };
}

export async function getSettings(ctx: RequestContext): Promise<ApiResponse> {
  requireRole(ctx, MAKER_ONLY);
  const result = await db.query<{ packing_cutoff_local: string }>(
    'SELECT packing_cutoff_local FROM settings WHERE id = 1',
  );
  return {
    status: 200,
    body: {
      packing_cutoff_local: result.rows[0]?.packing_cutoff_local ?? '14:00',
      time_zone: 'America/Toronto',
    },
  };
}

const readCutoff: Reader<string> = (raw, path, report) => {
  if (typeof raw !== 'string' || !TIME_ONLY.test(raw)) {
    report(path, FIELD_MESSAGES.packing_cutoff_local);
    return '14:00';
  }
  const [hours, minutes] = raw.split(':');
  if (Number(hours) > 23 || Number(minutes) > 59) {
    report(path, FIELD_MESSAGES.packing_cutoff_local);
    return '14:00';
  }
  return raw;
};

const SETTINGS_SHAPE = { packing_cutoff_local: readCutoff } as const;

export async function putSettings(ctx: RequestContext): Promise<ApiResponse> {
  requireRole(ctx, MAKER_ONLY);
  const parsed = parseBody(ctx.body, SETTINGS_SHAPE);
  if (!parsed.ok) throw errors.invalid(parsed.fields);
  await db.query('UPDATE settings SET packing_cutoff_local = $1 WHERE id = 1', [
    parsed.value.packing_cutoff_local,
  ]);
  return {
    status: 200,
    body: {
      packing_cutoff_local: parsed.value.packing_cutoff_local,
      time_zone: 'America/Toronto',
    },
  };
}
