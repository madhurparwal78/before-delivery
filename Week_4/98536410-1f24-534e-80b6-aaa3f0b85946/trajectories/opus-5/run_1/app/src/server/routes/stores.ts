import { asNumber, query, serverNow, withTransaction } from '../db.js';
import {
  belowHeld,
  forbidden,
  notFound,
  validationFailed,
} from '../http/errors.js';
import { bodyObject, integerField, param, requireSession, stringField } from '../http/context.js';
import type { RequestContext, SessionUser } from '../http/context.js';
import { json } from '../http/result.js';
import type { ApiResult } from '../http/result.js';
import { DISPLAY_STATES, isDisplayState } from '../domain/hours.js';
import type { DayEntry } from '../domain/hours.js';
import { isValidLocalDate, localDate, localDaysBetween, minutesOfDay } from '../domain/time.js';
import {
  dayPlanOf,
  hoursObject,
  loadStore,
  loadStores,
  offeredSlots,
  storeObject,
} from '../views.js';
import type { StoreRecord } from '../views.js';
import { holdObject } from '../views.js';
import { claimRequestKey, finishRequestKey, readRequestKey } from '../requestKeys.js';
import { ApiError } from '../http/errors.js';
import { sellOverCounter } from '../stock.js';
import { lockStockInSkuOrder } from '../stock.js';

const MAX_QUERY_LENGTH = 100;

export function trimmedQuery(context: RequestContext, field = 'q'): string {
  const raw = context.url.searchParams.get(field) ?? '';
  const trimmed = raw.trim();
  if (trimmed.length > MAX_QUERY_LENGTH) {
    throw validationFailed({ [field]: 'Use 100 characters or fewer.' });
  }
  return trimmed;
}

async function visibleStore(session: SessionUser, storeId: string): Promise<StoreRecord> {
  const store = await loadStore(session.operatorId, storeId);
  if (!store) throw notFound();
  return store;
}

/** Stock and active holds of a shop are visible to the operator's lead and that shop's managers. */
async function stockVisibleStore(
  session: SessionUser,
  storeId: string,
): Promise<StoreRecord> {
  const store = await visibleStore(session, storeId);
  const allowed =
    session.role === 'lead' ||
    (session.role === 'manager' && session.storeIds.includes(storeId));
  if (!allowed) throw notFound();
  return store;
}

function requireShopManager(session: SessionUser, storeId: string): void {
  if (session.role !== 'manager' || !session.storeIds.includes(storeId)) throw forbidden();
}

export async function listStores(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const text = trimmedQuery(context);
  const stateParam = context.url.searchParams.get('state');
  let wanted = [...DISPLAY_STATES];
  if (stateParam !== null) {
    const parts = stateParam.split(',').filter((part) => part !== '');
    for (const part of parts) {
      if (!isDisplayState(part)) throw validationFailed({ state: 'Use known display states.' });
    }
    wanted = DISPLAY_STATES.filter((state) => parts.includes(state));
  }

  const now = await serverNow();
  const stores = (await loadStores(session.operatorId, text))
    .map((store) => storeObject(store, now))
    .filter((store) => wanted.includes(store.display_state));

  return json({ count: stores.length, stores });
}

export async function getStore(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const store = await visibleStore(session, param(context, 'id'));
  return json(storeObject(store, await serverNow()));
}

export async function postSuspension(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const store = await visibleStore(session, param(context, 'id'));
  if (session.role !== 'lead') throw forbidden();

  const fields = bodyObject(context);
  const suspended = fields['suspended'];
  if (typeof suspended !== 'boolean') {
    throw validationFailed({ suspended: 'Say whether the shop is suspended.' });
  }
  if (suspended) {
    const reason = stringField(fields, 'reason', 1, 200, 'Give a reason of 1 to 200 characters.');
    await query(`UPDATE stores SET suspended = true, suspension_reason = $2 WHERE id = $1`, [
      store.id,
      reason,
    ]);
  } else {
    await query(
      `UPDATE stores SET suspended = false, suspension_reason = NULL WHERE id = $1`,
      [store.id],
    );
  }
  const updated = await loadStore(session.operatorId, store.id);
  return json(storeObject(updated as StoreRecord, await serverNow()));
}

export async function getStock(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const store = await stockVisibleStore(session, param(context, 'id'));
  const rows = await query(
    `SELECT s.sku, p.name, s.on_hand, s.held, (s.on_hand - s.held) AS available
       FROM stock s JOIN products p ON p.sku = s.sku AND p.operator_id = $2
      WHERE s.store_id = $1 ORDER BY s.sku`,
    [store.id, session.operatorId],
  );
  return json({
    store_id: store.id,
    lines: rows.map((row) => ({
      sku: row['sku'] as string,
      name: row['name'] as string,
      on_hand: asNumber(row['on_hand']),
      held: asNumber(row['held']),
      available: asNumber(row['available']),
      critical: asNumber(row['on_hand']) <= 2,
    })),
  });
}

export async function postStockCount(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const store = await stockVisibleStore(session, param(context, 'id'));
  const sku = param(context, 'sku');
  requireShopManager(session, store.id);

  const existing = await query(`SELECT sku FROM stock WHERE store_id = $1 AND sku = $2`, [
    store.id,
    sku,
  ]);
  if (existing.length === 0) throw notFound();

  const onHand = integerField(
    bodyObject(context),
    'on_hand',
    0,
    99999,
    'Enter a whole number from 0 to 99999.',
  );

  const line = await withTransaction(async (tx) => {
    const locked = await lockStockInSkuOrder(tx, store.id, [sku]);
    const row = locked.get(sku);
    const held = asNumber(row!['held']);
    if (onHand < held) throw belowHeld(held);
    const updated = await tx.query(
      `UPDATE stock SET on_hand = $3 WHERE store_id = $1 AND sku = $2
        RETURNING sku, on_hand, held, (on_hand - held) AS available`,
      [store.id, sku, onHand],
    );
    return updated.rows[0]!;
  });

  return json({
    sku: line['sku'] as string,
    on_hand: asNumber(line['on_hand']),
    held: asNumber(line['held']),
    available: asNumber(line['available']),
    critical: asNumber(line['on_hand']) <= 2,
  });
}

export async function postTillSale(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const store = await stockVisibleStore(session, param(context, 'id'));
  requireShopManager(session, store.id);

  const requestKey = readRequestKey({ headers: context.request.headers as Record<string, unknown> });
  const fields = bodyObject(context);
  const claim = await claimRequestKey(
    session.operatorId,
    session.userId,
    'till_sale',
    requestKey,
    { store_id: store.id, ...fields },
  );
  if (claim.kind === 'replay') return json(claim.answer.body, claim.answer.status);

  try {
    const sku = fields['sku'];
    if (typeof sku !== 'string' || sku.length === 0) {
      throw validationFailed({ sku: 'Choose an item.' });
    }
    const known = await query(`SELECT sku FROM stock WHERE store_id = $1 AND sku = $2`, [
      store.id,
      sku,
    ]);
    if (known.length === 0) throw validationFailed({ sku: 'Choose an item this shop stocks.' });
    const quantity = integerField(fields, 'quantity', 1, 999, 'Enter a whole number from 1 to 999.');

    const line = await withTransaction((tx) => sellOverCounter(tx, store.id, sku, quantity));
    const body = {
      store_id: store.id,
      sku: line['sku'] as string,
      on_hand: asNumber(line['on_hand']),
      held: asNumber(line['held']),
      available: asNumber(line['available']),
    };
    await finishRequestKey(session.operatorId, session.userId, requestKey, 201, body);
    return json(body, 201);
  } catch (error) {
    if (error instanceof ApiError) {
      await finishRequestKey(
        session.operatorId,
        session.userId,
        requestKey,
        error.status,
        error.body(),
      );
    } else {
      await finishRequestKey(session.operatorId, session.userId, requestKey, 500, {});
    }
    throw error;
  }
}

export async function getShopHolds(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const store = await stockVisibleStore(session, param(context, 'id'));
  const now = await serverNow();
  const rows = await query(
    `SELECT * FROM holds WHERE store_id = $1 AND status = 'active' ORDER BY created_at`,
    [store.id],
  );
  const holds = [];
  for (const row of rows) {
    const lines = await query(
      `SELECT sku, quantity FROM hold_lines WHERE hold_id = $1 ORDER BY sku`,
      [row['id']],
    );
    holds.push(holdObject(row, lines, now));
  }
  return json({ holds });
}

export async function getHours(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const store = await visibleStore(session, param(context, 'id'));
  return json(hoursObject(store, await serverNow()));
}

function parseDays(value: unknown): DayEntry[] {
  if (!Array.isArray(value)) throw validationFailed({ days: 'Send seven weekday entries.' });
  const errors: Record<string, string> = {};
  const byWeekday = new Map<number, DayEntry>();

  value.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      errors[`days.${index}`] = 'Send a weekday entry.';
      return;
    }
    const fields = entry as Record<string, unknown>;
    const weekday = fields['weekday'];
    if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
      errors[`days.${index}.weekday`] = 'Use a weekday from 1 to 7.';
      return;
    }
    const open = fields['open'];
    if (typeof open !== 'boolean') {
      errors[`days.${index}.open`] = 'Say whether the shop opens.';
      return;
    }
    if (!open) {
      byWeekday.set(weekday, { weekday, open: false, opens: null, closes: null });
      return;
    }
    const opens = fields['opens'];
    const closes = fields['closes'];
    const timePattern = /^([01]\d|2[0-3]):(00|30)$/;
    let valid = true;
    if (typeof opens !== 'string' || !timePattern.test(opens)) {
      errors[`days.${index}.opens`] = 'Use a time on the hour or half hour.';
      valid = false;
    }
    if (typeof closes !== 'string' || !timePattern.test(closes)) {
      errors[`days.${index}.closes`] = 'Use a time on the hour or half hour.';
      valid = false;
    }
    if (valid && minutesOfDay(closes as string) <= minutesOfDay(opens as string)) {
      errors[`days.${index}.closes`] = 'Closing time must be after opening time.';
      valid = false;
    }
    if (valid) {
      byWeekday.set(weekday, {
        weekday,
        open: true,
        opens: opens as string,
        closes: closes as string,
      });
    }
  });

  for (let weekday = 1; weekday <= 7; weekday += 1) {
    if (!byWeekday.has(weekday)) errors[`days.${weekday - 1}`] = 'Send this weekday.';
  }
  if (Object.keys(errors).length > 0) throw validationFailed(errors);
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => byWeekday.get(weekday) as DayEntry);
}

export async function putHours(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const store = await visibleStore(session, param(context, 'id'));
  requireShopManager(session, store.id);

  const now = await serverNow();
  const today = localDate(store.timezone, now);
  const fields = bodyObject(context);
  const supplied = fields['effective_from'];
  const effectiveFrom = supplied === undefined || supplied === null ? today : supplied;
  if (
    typeof effectiveFrom !== 'string' ||
    !isValidLocalDate(effectiveFrom) ||
    localDaysBetween(today, effectiveFrom) < 0 ||
    localDaysBetween(today, effectiveFrom) > 60
  ) {
    throw validationFailed({ effective_from: 'Pick a date from today to 60 days ahead.' });
  }
  const days = parseDays(fields['days']);

  await withTransaction(async (tx) => {
    if (effectiveFrom === today) {
      await tx.query(`DELETE FROM hours_plans WHERE store_id = $1 AND effective_from >= $2`, [
        store.id,
        today,
      ]);
    } else {
      await tx.query(`DELETE FROM hours_plans WHERE store_id = $1 AND effective_from > $2`, [
        store.id,
        today,
      ]);
    }
    await tx.query(
      `INSERT INTO hours_plans (store_id, effective_from, days) VALUES ($1,$2,$3)
       ON CONFLICT (store_id, effective_from) DO UPDATE SET days = EXCLUDED.days`,
      [store.id, effectiveFrom, JSON.stringify(days)],
    );
  });

  const updated = await loadStore(session.operatorId, store.id);
  return json(hoursObject(updated as StoreRecord, await serverNow()));
}

export async function getDayPlan(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const store = await visibleStore(session, param(context, 'id'));
  const date = context.url.searchParams.get('date') ?? '';
  if (!isValidLocalDate(date) || date < '2026-01-01' || date > '2030-12-31') {
    throw validationFailed({ date: 'Pick a date from 2026 to 2030.' });
  }
  const plan = await dayPlanOf(store, date);
  return json({ store_id: store.id, ...plan });
}

export async function getSlots(context: RequestContext): Promise<ApiResult> {
  const session = requireSession(context);
  const store = await visibleStore(session, param(context, 'id'));
  const now = await serverNow();
  return json({
    store_id: store.id,
    timezone: store.timezone,
    days: await offeredSlots(store, now),
  });
}
