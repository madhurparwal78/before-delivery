import { db, writeTx } from '../db.ts';
import { conflict, notFound, validation } from '../http/errors.ts';
import { jsonBody, param, requireRole, type ApiResult, type RequestContext } from '../http/context.ts';
import { effectiveStatus } from '../domain/cycleState.ts';
import { withinPickupWindow } from '../domain/pickupWindow.ts';
import { toIsoSeconds } from '../domain/clubTime.ts';
import { buildBags, getCycleRow, type CycleRow } from '../store.ts';

function requireCycle(ctx: RequestContext): CycleRow {
  const cycle = getCycleRow(param(ctx, 'cycleId'));
  if (!cycle) throw notFound();
  return cycle;
}

function statusOf(cycle: CycleRow, nowMs: number): string {
  return effectiveStatus(cycle.status, cycle.cutoff_at === null ? null : Date.parse(cycle.cutoff_at), nowMs);
}

export function listBags(ctx: RequestContext): ApiResult {
  requireRole(ctx, ['volunteer', 'coordinator']);
  const cycle = requireCycle(ctx);
  const status = statusOf(cycle, ctx.now);
  if (!['breakdown', 'closing', 'closed'].includes(status)) {
    throw conflict('wrong_cycle_state', 'Bags are packed in breakdown.');
  }
  return { status: 200, body: { bags: buildBags(cycle) } };
}

function assertPackable(cycle: CycleRow, nowMs: number): void {
  if (statusOf(cycle, nowMs) !== 'breakdown') throw conflict('wrong_cycle_state', 'Bags are packed in breakdown.');
  const startMs = cycle.pickup_start_at === null ? null : Date.parse(cycle.pickup_start_at);
  const endMs = cycle.pickup_end_at === null ? null : Date.parse(cycle.pickup_end_at);
  if (startMs === null || endMs === null || !withinPickupWindow(nowMs, startMs, endMs)) {
    throw conflict('outside_pickup_window', 'That is outside the pickup window.');
  }
}

export function putBagItem(ctx: RequestContext): ApiResult {
  requireRole(ctx, ['volunteer', 'coordinator']);
  const cycle = requireCycle(ctx);
  const householdCode = param(ctx, 'householdCode');
  const productId = param(ctx, 'productId');
  const body = jsonBody(ctx);
  const packed = body.packed;
  if (typeof packed !== 'boolean') throw validation({ packed: 'Send true or false.' });
  return writeTx(() => {
    assertPackable(cycle, ctx.now);
    const bag = buildBags(cycle).find((entry) => entry.household_code === householdCode);
    if (!bag) throw notFound();
    if (!bag.items.some((item) => item.product_id === productId)) throw notFound();
    db.prepare(
      'INSERT INTO bag_items (cycle_id, household_code, product_id, packed) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT (cycle_id, household_code, product_id) DO UPDATE SET packed = excluded.packed',
    ).run(cycle.id, householdCode, productId, packed ? 1 : 0);
    const updated = buildBags(cycle).find((entry) => entry.household_code === householdCode)!;
    return { status: 200, body: updated };
  });
}

export function postFlag(ctx: RequestContext): ApiResult {
  requireRole(ctx, ['volunteer']);
  const cycle = requireCycle(ctx);
  const householdCode = param(ctx, 'householdCode');
  const body = jsonBody(ctx);
  const productId = body.product_id;
  const units = body.units;
  if (typeof productId !== 'string') throw validation({ product_id: 'Name the case.' });
  return writeTx(() => {
    assertPackable(cycle, ctx.now);
    const bag = buildBags(cycle).find((entry) => entry.household_code === householdCode);
    if (!bag) throw notFound();
    const item = bag.items.find((entry) => entry.product_id === productId);
    if (!item) throw notFound();
    if (typeof units !== 'number' || !Number.isInteger(units) || units < 1 || units > item.units) {
      throw validation({ units: `Enter 1 to ${item.units} units.` });
    }
    const createdAt = toIsoSeconds(new Date(ctx.now));
    const info = db
      .prepare('INSERT INTO flags (cycle_id, household_code, product_id, units, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(cycle.id, householdCode, productId, units, createdAt);
    return {
      status: 201,
      body: {
        flag: {
          id: Number(info.lastInsertRowid),
          household_code: householdCode,
          product_id: productId,
          units,
          created_at: createdAt,
        },
      },
    };
  });
}
