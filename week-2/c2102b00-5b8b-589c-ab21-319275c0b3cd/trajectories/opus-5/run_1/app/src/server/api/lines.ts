import { db, writeTx } from '../db.ts';
import { conflict, notFound, validation } from '../http/errors.ts';
import { jsonBody, param, requireRole, type ApiResult, type RequestContext } from '../http/context.ts';
import { acceptingPledges, effectiveStatus, shortsAllowed } from '../domain/cycleState.ts';
import { CLUB_PLEDGER, effectiveLineStatus, pledgedUnits, unitOwners } from '../domain/lines.ts';
import { holdForUnits } from '../domain/credit.ts';
import { remainderCents, shareOfUnit, sharesForPledges, unitBaseCents } from '../domain/shares.ts';
import { selectShortUnits } from '../domain/shorts.ts';
import { toIsoSeconds } from '../domain/clubTime.ts';
import {
  balanceCents,
  buildLine,
  creditFor,
  getCycleRow,
  getHousehold,
  getLineRow,
  getProduct,
  heldCents,
  listPledges,
  persistCutoffSwitch,
  pledgeOf,
  shortUnitNumbers,
  type CycleRow,
  type LineRow,
  type ProductRow,
  type Viewer,
} from '../store.ts';
import { deliverQueuedSoon, queueMail } from '../providers/mailQueue.ts';

interface LineTarget {
  cycle: CycleRow;
  lineRow: LineRow;
  product: ProductRow;
}

function requireLine(ctx: RequestContext, viewer: Viewer): LineTarget {
  const cycle = getCycleRow(param(ctx, 'cycleId'));
  if (!cycle) throw notFound();
  if (cycle.status === 'draft' && viewer.role !== 'coordinator') throw notFound();
  const lineRow = getLineRow(cycle.id, param(ctx, 'productId'));
  if (!lineRow) throw notFound();
  const product = getProduct(lineRow.product_id);
  if (!product) throw notFound();
  return { cycle, lineRow, product };
}

function assertAccepting(cycle: CycleRow, nowMs: number): void {
  const cutoffMs = cycle.cutoff_at === null ? null : Date.parse(cycle.cutoff_at);
  if (!acceptingPledges(cycle.status, cutoffMs, nowMs)) {
    throw conflict('cutoff_passed', 'Cutoff has passed, so pledges cannot change.');
  }
}

export function putPledge(ctx: RequestContext): ApiResult {
  const viewer = requireRole(ctx, ['member']);
  const target = requireLine(ctx, viewer);
  const body = jsonBody(ctx);
  const units = body.units;
  const householdCode = viewer.householdCode!;
  if (typeof units !== 'number' || !Number.isInteger(units) || units < 1 || units > target.product.pack) {
    throw validation({ units: `Choose 1 to ${target.product.pack} units.` });
  }
  return writeTx(() => {
    const cycle = persistCutoffSwitch(getCycleRow(target.cycle.id)!, ctx.now);
    assertAccepting(cycle, ctx.now);
    const pledges = listPledges(cycle.id, target.product.id);
    const existing = pledges.find((pledge) => pledge.pledger === householdCode);
    const total = pledgedUnits(pledges) - (existing?.units ?? 0) + units;
    if (total > target.product.pack) {
      throw conflict('not_enough_units', 'There are not that many units left on this case.');
    }
    const existingHold = existing ? holdForUnits(existing.units, target.product.price_cents, target.product.pack) : 0;
    const newHold = holdForUnits(units, target.product.price_cents, target.product.pack);
    const held = heldCents(householdCode) - existingHold + newHold;
    if (balanceCents(householdCode) - held < 0) {
      throw conflict('insufficient_credit', 'That would spend more credit than this household has.');
    }
    const at = toIsoSeconds(new Date(ctx.now));
    if (existing) {
      db.prepare('UPDATE pledges SET units = ? WHERE id = ?').run(units, existing.id);
    } else {
      db.prepare('INSERT INTO pledges (cycle_id, product_id, pledger, units, created_at) VALUES (?, ?, ?, ?, ?)').run(
        cycle.id,
        target.product.id,
        householdCode,
        units,
        at,
      );
    }
    db.prepare('INSERT INTO pledge_events (cycle_id, product_id, pledger, delta, at) VALUES (?, ?, ?, ?, ?)').run(
      cycle.id,
      target.product.id,
      householdCode,
      units - (existing?.units ?? 0),
      at,
    );
    db.prepare('UPDATE cycle_lines SET version = version + 1 WHERE cycle_id = ? AND product_id = ?').run(
      cycle.id,
      target.product.id,
    );
    const lineRow = getLineRow(cycle.id, target.product.id)!;
    return {
      status: 200,
      body: {
        line: buildLine(cycle, lineRow, target.product, viewer),
        credit: creditFor(householdCode),
      },
    };
  });
}

export function deletePledge(ctx: RequestContext): ApiResult {
  const viewer = requireRole(ctx, ['member']);
  const target = requireLine(ctx, viewer);
  const householdCode = viewer.householdCode!;
  if (!pledgeOf(target.cycle.id, target.product.id, householdCode)) throw notFound();
  return writeTx(() => {
    const cycle = persistCutoffSwitch(getCycleRow(target.cycle.id)!, ctx.now);
    const existing = pledgeOf(cycle.id, target.product.id, householdCode);
    if (!existing) throw notFound();
    assertAccepting(cycle, ctx.now);
    db.prepare('DELETE FROM pledges WHERE id = ?').run(existing.id);
    db.prepare('INSERT INTO pledge_events (cycle_id, product_id, pledger, delta, at) VALUES (?, ?, ?, ?, ?)').run(
      cycle.id,
      target.product.id,
      householdCode,
      -existing.units,
      toIsoSeconds(new Date(ctx.now)),
    );
    db.prepare('UPDATE cycle_lines SET version = version + 1 WHERE cycle_id = ? AND product_id = ?').run(
      cycle.id,
      target.product.id,
    );
    const lineRow = getLineRow(cycle.id, target.product.id)!;
    return {
      status: 200,
      body: {
        line: buildLine(cycle, lineRow, target.product, viewer),
        credit: creditFor(householdCode),
      },
    };
  });
}

export function getShares(ctx: RequestContext): ApiResult {
  const viewer = requireRole(ctx, ['coordinator', 'member']);
  const target = requireLine(ctx, viewer);
  const pledges = listPledges(target.cycle.id, target.product.id);
  const status = effectiveLineStatus(target.lineRow.status, target.product.pack, pledges);
  if (status !== 'sealed' && status !== 'taken_up') {
    throw conflict('line_not_sealed', 'That case is not sealed.');
  }
  return {
    status: 200,
    body: {
      price_cents: target.product.price_cents,
      pack: target.product.pack,
      unit_base_cents: unitBaseCents(target.product.price_cents, target.product.pack),
      remainder_cents: remainderCents(target.product.price_cents, target.product.pack),
      shares: sharesForPledges(target.product.price_cents, target.product.pack, pledges),
    },
  };
}

export function postResolution(ctx: RequestContext): ApiResult {
  const viewer = requireRole(ctx, ['coordinator']);
  const target = requireLine(ctx, viewer);
  const body = jsonBody(ctx);
  const action = body.action;
  if (action !== 'drop' && action !== 'take_up') {
    throw validation({ action: 'Choose drop or take_up.' });
  }
  return writeTx(() => {
    const cycle = persistCutoffSwitch(getCycleRow(target.cycle.id)!, ctx.now);
    const status = effectiveStatus(cycle.status, cycle.cutoff_at === null ? null : Date.parse(cycle.cutoff_at), ctx.now);
    if (status !== 'sealing') throw conflict('wrong_cycle_state', 'Cases are resolved at cutoff.');
    const lineRow = getLineRow(cycle.id, target.product.id)!;
    if (lineRow.status === 'dropped' || lineRow.status === 'taken_up') {
      throw conflict('line_already_resolved', 'That case was already resolved.');
    }
    const pledges = listPledges(cycle.id, target.product.id);
    const remaining = target.product.pack - pledgedUnits(pledges);
    if (remaining === 0) throw conflict('line_already_full', 'That case is already sealed.');
    if (action === 'drop') {
      db.prepare("UPDATE cycle_lines SET status = 'dropped' WHERE cycle_id = ? AND product_id = ?").run(
        cycle.id,
        target.product.id,
      );
    } else {
      db.prepare('INSERT INTO pledges (cycle_id, product_id, pledger, units, created_at) VALUES (?, ?, ?, ?, ?)').run(
        cycle.id,
        target.product.id,
        CLUB_PLEDGER,
        remaining,
        toIsoSeconds(new Date(ctx.now)),
      );
      db.prepare("UPDATE cycle_lines SET status = 'taken_up' WHERE cycle_id = ? AND product_id = ?").run(
        cycle.id,
        target.product.id,
      );
    }
    db.prepare('UPDATE cycle_lines SET version = version + 1 WHERE cycle_id = ? AND product_id = ?').run(
      cycle.id,
      target.product.id,
    );
    return {
      status: 200,
      body: buildLine(cycle, getLineRow(cycle.id, target.product.id)!, target.product, viewer),
    };
  });
}

export function postShort(ctx: RequestContext): ApiResult {
  const viewer = requireRole(ctx, ['coordinator']);
  const target = requireLine(ctx, viewer);
  const body = jsonBody(ctx);
  const units = body.units;
  const result = writeTx(() => {
    const cycle = persistCutoffSwitch(getCycleRow(target.cycle.id)!, ctx.now);
    const status = effectiveStatus(cycle.status, cycle.cutoff_at === null ? null : Date.parse(cycle.cutoff_at), ctx.now);
    if (!shortsAllowed(status)) throw conflict('wrong_cycle_state', 'Shorts are recorded after delivery.');
    const lineRow = getLineRow(cycle.id, target.product.id)!;
    const pledges = listPledges(cycle.id, target.product.id);
    const lineStatus = effectiveLineStatus(lineRow.status, target.product.pack, pledges);
    if (lineStatus !== 'sealed' && lineStatus !== 'taken_up') {
      throw conflict('line_not_sealed', 'That case was not ordered.');
    }
    const delivered = target.product.pack;
    const already = shortUnitNumbers(cycle.id, target.product.id);
    const remaining = delivered - already.size;
    if (typeof units !== 'number' || !Number.isInteger(units) || units < 1 || units > remaining) {
      throw validation({ units: `Enter 1 to ${remaining} units.` });
    }
    const createdAt = toIsoSeconds(new Date(ctx.now));
    const info = db
      .prepare('INSERT INTO shorts (cycle_id, product_id, units, created_at) VALUES (?, ?, ?, ?)')
      .run(cycle.id, target.product.id, units, createdAt);
    const shortId = Number(info.lastInsertRowid);
    const chosen = selectShortUnits(delivered, already, units);
    const insertUnit = db.prepare(
      'INSERT INTO short_units (cycle_id, product_id, unit_number, short_id) VALUES (?, ?, ?, ?)',
    );
    for (const unitNumber of chosen) insertUnit.run(cycle.id, target.product.id, unitNumber, shortId);
    db.prepare('UPDATE cycle_lines SET version = version + 1 WHERE cycle_id = ? AND product_id = ?').run(
      cycle.id,
      target.product.id,
    );

    const owners = unitOwners(pledges);
    const perPledger = new Map<string, { units: number; credit: number }>();
    for (const unitNumber of chosen) {
      const owner = owners[unitNumber - 1]!;
      const entry = perPledger.get(owner) ?? { units: 0, credit: 0 };
      entry.units += 1;
      entry.credit += shareOfUnit(target.product.price_cents, target.product.pack, unitNumber);
      perPledger.set(owner, entry);
    }
    const affected = [...perPledger.entries()].map(([pledger, entry]) => ({
      pledger,
      short_units: entry.units,
      credit_cents: entry.credit,
    }));
    for (const entry of affected) {
      if (entry.pledger === CLUB_PLEDGER) continue;
      const household = getHousehold(entry.pledger)!;
      const pledge = pledges.find((item) => item.pledger === entry.pledger)!;
      queueMail({
        kind: 'short',
        cycleId: cycle.id,
        householdCode: entry.pledger,
        to: household.email,
        subject: `Short shipment: ${target.product.case_name}`,
        body: `${cycle.name}: ${entry.short_units} of your ${pledge.units} units of ${target.product.case_name} did not arrive. You will not be charged for them.`,
        messageId: `<short-${shortId}-${entry.pledger}@tare-and-tally.example>`,
      });
    }
    return {
      status: 201,
      body: {
        short_id: shortId,
        line: buildLine(cycle, getLineRow(cycle.id, target.product.id)!, target.product, viewer),
        affected,
      },
    };
  });
  deliverQueuedSoon();
  return result;
}

export function listFlags(ctx: RequestContext): ApiResult {
  requireRole(ctx, ['coordinator']);
  const cycle = getCycleRow(param(ctx, 'cycleId'));
  if (!cycle) throw notFound();
  const flags = db
    .prepare('SELECT id, household_code, product_id, units, created_at FROM flags WHERE cycle_id = ? ORDER BY id')
    .all(cycle.id);
  return { status: 200, body: { flags } };
}
