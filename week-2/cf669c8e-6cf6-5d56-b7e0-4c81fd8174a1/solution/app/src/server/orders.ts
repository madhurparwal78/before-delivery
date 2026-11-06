/** Orders: reading them as the API shows them, creating them from a quote, and saving the delivery plan. */
import { oneOf } from '../shared/choice.js';
import {
  DELIVERY_COUNTRIES, FULFILMENTS,
  type Allocation, type Config, type Country, type DeskOrder, type DeskPayment, type Draw, type Fulfilment, type Line, type Order, type OrderState, type Plan,
  type RegCountry, type Refund, type Stage, type StageName, type StageStatus, type User,
} from '../shared/types.js';
import { BIKES, orderedHub, orderedPack } from './catalogue.js';
import { amsterdamIso, amsterdamToday, shopNowMs } from './clock.js';
import { one, query, sql, theRow, transaction, type Db } from './db.js';
import { errorsOf, fail, invalid, isRecord, notFound } from './errors.js';
import { noticesFor, quoteOfResolved, resolveConfig, configOf, isClassMove, orderSpecs, specsOf } from './quotes.js';
import { STAGES, STAGE_LABELS, allocateStages, bikeLines, lineVat, spread, totals, dueDates, type LineSpec } from './pricing.js';
import type { PoolClient } from 'pg';

interface OrderColumns {
  id: string; number: string; user_id: string; state: OrderState; plan: Plan; plan_version: number;
  bike_id: string | null; verdict: string | null; class_move: boolean;
  fulfilment: Fulfilment; delivery_country: Country; total_cents: number; vat_cents: number; partly_refunded: boolean;
  delivered_on: string | null; withdrawal_deadline: Date | null; created_at: Date;
}
export type OrderRow = OrderColumns & ({ kind: 'kit'; config: Config; donor: StoredDonor } | { kind: 'bike'; config: null; donor: null });
export interface StoredDonor {
  plate: string; country: RegCountry; model: string; firstAdmissionYear: number; roadClass: number; plateColour: string;
  registeredMassT: number; confirmed: boolean;
}
interface LineRow { id: string; position: number; code: string; name: string; gross_cents: number; vat_rate_pct: number; vat_cents: number }
interface StageRow {
  stage: StageName; position: number; label: string; due_date: string; amount_cents: number; status: StageStatus; attempts: number;
  confirmed_at: Date | null; vat_corrected_cents: number;
}
interface AllocRow { stage: StageName; line_id: string; gross_cents: number; vat_cents: number }
interface RefundRow { id: string; line_id: string; amount_cents: number; status: Refund['status'] }
interface DrawRow {
  refund_id: string; stage: StageName; seq: number; amount_cents: number; vat_cents: number; status: Draw['status']; kb_payment_id: string | null;
}
interface PaymentRow { stage: StageName; amount_cents: number; kb_payment_id: string | null; kb_transaction_id: string | null; created_at: Date }

export async function orderRow(db: Db, id: string, lock = false): Promise<OrderRow | undefined> {
  return one<OrderRow>(db, `SELECT * FROM orders WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
}

/** The order if it exists and belongs to the user; another rider's order is the same not-found as a missing one. */
export async function ownOrder(db: Db, user: User, id: string, lock = false): Promise<OrderRow> {
  const row = await orderRow(db, id, lock);
  if (!row || row.user_id !== user.id) throw notFound();
  return row;
}

export async function lineRows(db: Db, orderId: string): Promise<LineRow[]> {
  return query<LineRow>(db, 'SELECT id, position, code, name, gross_cents, vat_rate_pct, vat_cents FROM order_lines WHERE order_id = $1 ORDER BY position', [orderId]);
}

export function withdrawalIsOpen(row: Pick<OrderRow, 'state' | 'withdrawal_deadline'>): boolean {
  if (row.state === 'withdrawn' || row.state === 'fitted' || row.state === 'inspection passed') return false;
  return row.withdrawal_deadline === null || shopNowMs() <= row.withdrawal_deadline.getTime();
}

type Keyed<T> = T & { order_id: string };

function byOrder<T extends { order_id: string }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.order_id, [...(groups.get(row.order_id) ?? []), row]);
  return groups;
}

/** Assembles any number of orders from one read of each child table, in order: a transaction's client runs one query at a time. */
async function assembleOrders(db: Db, rows: OrderRow[]): Promise<Order[]> {
  const ids = [rows.map((row) => row.id)];
  const lines = byOrder(await query<Keyed<LineRow>>(db, 'SELECT order_id, id, position, code, name, gross_cents, vat_rate_pct, vat_cents FROM order_lines WHERE order_id = ANY($1::uuid[]) ORDER BY position', ids));
  const stages = byOrder(await query<Keyed<StageRow>>(db, 'SELECT order_id, stage, position, label, due_date, amount_cents, status, attempts, confirmed_at, vat_corrected_cents FROM stages WHERE order_id = ANY($1::uuid[]) ORDER BY position', ids));
  const allocs = byOrder(await query<Keyed<AllocRow>>(db, 'SELECT order_id, stage, line_id, gross_cents, vat_cents FROM allocations WHERE order_id = ANY($1::uuid[])', ids));
  const refunds = byOrder(await query<Keyed<RefundRow>>(db, 'SELECT order_id, id, line_id, amount_cents, status FROM refunds WHERE order_id = ANY($1::uuid[]) ORDER BY created_at, id', ids));
  const draws = byOrder(await query<Keyed<DrawRow>>(db, 'SELECT order_id, refund_id, stage, seq, amount_cents, vat_cents, status, kb_payment_id FROM refund_draws WHERE order_id = ANY($1::uuid[]) ORDER BY refund_id, seq', ids));
  return rows.map((row) => composeOrder(row, lines.get(row.id) ?? [], stages.get(row.id) ?? [], allocs.get(row.id) ?? [], refunds.get(row.id) ?? [], draws.get(row.id) ?? []));
}

export async function assembleOrder(db: Db, row: OrderRow): Promise<Order> {
  return (await assembleOrders(db, [row]))[0];
}

function composeOrder(row: OrderRow, lines: LineRow[], stages: StageRow[], allocs: AllocRow[], refunds: RefundRow[], draws: DrawRow[]): Order {
  const paid = new Set(stages.filter((s) => s.status === 'paid').map((s) => s.stage));
  const returnedBy = new Map<string, number>();
  for (const draw of draws) {
    const line = refunds.find((r) => r.id === draw.refund_id)?.line_id;
    if (line && draw.status === 'returned') returnedBy.set(line, (returnedBy.get(line) ?? 0) + draw.amount_cents);
  }
  const outLines: Line[] = lines.map((l) => {
    const collected = allocs.filter((a) => a.line_id === l.id && paid.has(a.stage)).reduce((sum, a) => sum + a.gross_cents, 0);
    const refunded = returnedBy.get(l.id) ?? 0;
    return {
      id: l.id, code: l.code, name: l.name, grossCents: l.gross_cents, vatRatePct: l.vat_rate_pct, vatCents: l.vat_cents,
      netCents: l.gross_cents - l.vat_cents, collectedCents: collected - refunded, refundedCents: refunded,
    };
  });
  const schedule: Stage[] = stages.map((s) => {
    const allocations: Allocation[] = allocs.filter((a) => a.stage === s.stage).map((a) => ({
      lineId: a.line_id, grossCents: a.gross_cents, vatCents: a.vat_cents, netCents: a.gross_cents - a.vat_cents,
    })).sort((a, b) => lines.findIndex((l) => l.id === a.lineId) - lines.findIndex((l) => l.id === b.lineId));
    return {
      stage: s.stage, label: s.label, dueDate: s.due_date, amountCents: s.amount_cents,
      vatCents: allocations.reduce((sum, a) => sum + a.vatCents, 0), vatCorrectedCents: s.vat_corrected_cents, status: s.status,
      attempts: s.attempts, confirmedAt: s.confirmed_at ? s.confirmed_at.toISOString() : null, allocations,
    };
  });
  const outRefunds: Refund[] = refunds.map((r) => {
    const own = draws.filter((d) => d.refund_id === r.id);
    return {
      id: r.id, lineId: r.line_id, amountCents: r.amount_cents,
      returnedCents: own.filter((d) => d.status === 'returned').reduce((s, d) => s + d.amount_cents, 0),
      failedCents: own.filter((d) => d.status === 'failed').reduce((s, d) => s + d.amount_cents, 0),
      vatCents: own.filter((d) => d.status !== 'failed').reduce((s, d) => s + d.vat_cents, 0),
      status: r.status,
      draws: own.map((d): Draw => ({ stage: d.stage, killbillPaymentId: d.kb_payment_id, amountCents: d.amount_cents, vatCents: d.vat_cents, status: d.status })),
    };
  });
  return {
    id: row.id, number: row.number, kind: row.kind, state: row.state, partlyRefunded: row.partly_refunded, planVersion: row.plan_version,
    plan: row.plan,
    donor: row.donor ? { plate: row.donor.plate, country: row.donor.country, model: row.donor.model, confirmed: row.donor.confirmed } : null,
    config: row.config, lines: outLines, totalCents: row.total_cents, vatCents: row.vat_cents,
    notices: row.kind === 'kit' ? noticesFor(row.class_move) : [], schedule, refunds: outRefunds,
    deliveredOn: row.delivered_on, withdrawalDeadline: row.withdrawal_deadline ? amsterdamIso(row.withdrawal_deadline.getTime()) : null,
    withdrawalOpen: withdrawalIsOpen(row), classMove: row.class_move,
  };
}

export async function loadOrder(db: Db, id: string): Promise<Order> {
  const row = await orderRow(db, id);
  if (!row) throw notFound();
  return assembleOrder(db, row);
}

/** The desk's view of each order: the order plus each stage's latest provider ids and the rider's name. */
async function assembleDeskOrders(db: Db, rows: OrderRow[]): Promise<DeskOrder[]> {
  const orders = await assembleOrders(db, rows);
  const owners = await query<{ id: string; name: string }>(db, 'SELECT id, name FROM users WHERE id = ANY($1::uuid[])', [rows.map((row) => row.user_id)]);
  const attempts = byOrder(await query<Keyed<PaymentRow>>(db, 'SELECT order_id, stage, amount_cents, kb_payment_id, kb_transaction_id, created_at FROM payments WHERE order_id = ANY($1::uuid[]) ORDER BY created_at', [rows.map((row) => row.id)]));
  return orders.map((order, index) => {
    const own = attempts.get(order.id) ?? [];
    const payments: DeskPayment[] = [];
    for (const stage of order.schedule) {
      if (stage.status === 'scheduled' && !own.some((a) => a.stage === stage.stage)) continue;
      const latest = [...own].reverse().find((a) => a.stage === stage.stage);
      payments.push({
        stage: stage.stage, amountCents: stage.amountCents, status: stage.status,
        killbillPaymentId: latest?.kb_payment_id ?? null, killbillTransactionId: latest?.kb_transaction_id ?? null,
      });
    }
    return { ...order, payments, riderName: owners.filter((owner) => owner.id === rows[index].user_id)[0].name };
  });
}

export async function loadDeskOrder(db: Db, id: string): Promise<DeskOrder> {
  const row = await orderRow(db, id);
  if (!row) throw notFound();
  return (await assembleDeskOrders(db, [row]))[0];
}

// ---- writing ----------------------------------------------------------------------------------------------------------

function validatePlan(input: unknown): Plan {
  const errors: Record<string, string> = {};
  const raw = isRecord(input) ? input : {};
  const field = (name: 'name' | 'street' | 'postcode' | 'city', message: string): string => {
    const value = raw[name];
    if (typeof value !== 'string' || !value.trim()) {
      errors[name] = message;
      return '';
    }
    if (value.length > 200) errors[name] = 'Keep this to 200 characters.';
    return value.trim();
  };
  const plan: Plan = {
    name: field('name', 'Enter your name.'), street: field('street', 'Enter your street.'),
    postcode: field('postcode', 'Enter your postcode.'), city: field('city', 'Enter your city.'),
  };
  const note = raw['note'];
  if (note !== undefined && note !== null && note !== '') {
    if (typeof note !== 'string' || note.length > 500) errors['note'] = 'Keep the note to 500 characters.';
    else plan.note = note;
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return plan;
}

function expectedTotal(value: unknown): number {
  if (value === undefined || value === null) throw invalid({ expectedTotalCents: 'Required.' });
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw invalid({ expectedTotalCents: 'Enter the total in whole cents.' });
  return value;
}

async function writeAllocations(client: PoolClient, orderId: string, ids: readonly string[], specs: readonly LineSpec[], amounts: readonly number[]): Promise<void> {
  const rows = allocateStages(specs, amounts, new Map(), specs.map(() => ({ grossCents: 0, vatCents: 0 })));
  for (const r of rows) {
    await query(client, 'INSERT INTO allocations (order_id, stage, line_id, gross_cents, vat_cents) VALUES ($1,$2,$3,$4,$5)', [orderId, r.stage, ids[r.lineIndex], r.grossCents, r.vatCents]);
  }
}

/** Insert lines, stages and allocations for a fresh (all unpaid) order from priced specs. */
async function writeLedger(client: PoolClient, orderId: string, specs: readonly LineSpec[], anchor: string): Promise<void> {
  const ids: string[] = [];
  for (const [position, spec] of specs.entries()) {
    const inserted = await theRow<{ id: string }>(client, 'INSERT INTO order_lines (order_id, position, code, name, gross_cents, vat_rate_pct, vat_cents) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [
      orderId, position, spec.code, spec.name, spec.grossCents, spec.vatRatePct, lineVat(spec),
    ]);
    ids.push(inserted.id);
  }
  const amounts = spread(totals(specs).totalCents);
  const due = dueDates(anchor);
  for (const [i, stage] of STAGES.entries()) {
    await query(client, 'INSERT INTO stages (order_id, stage, position, label, due_date, amount_cents) VALUES ($1,$2,$3,$4,$5,$6)', [orderId, stage, i, STAGE_LABELS[stage], due[i], amounts[i]]);
  }
  await writeAllocations(client, orderId, ids, specs, amounts);
}

/** Re-price a quoted order in place (a newer fee, or a change of fulfilment or country): line ids are kept. */
export async function repriceQuoted(client: PoolClient, orderId: string, specs: readonly LineSpec[], anchor: string): Promise<void> {
  const lines = await lineRows(client, orderId);
  for (const [i, spec] of specs.entries()) {
    await query(client, 'UPDATE order_lines SET code = $2, name = $3, gross_cents = $4, vat_rate_pct = $5, vat_cents = $6 WHERE id = $1', [
      lines[i].id, spec.code, spec.name, spec.grossCents, spec.vatRatePct, lineVat(spec),
    ]);
  }
  const sums = totals(specs);
  const amounts = spread(sums.totalCents);
  const due = dueDates(anchor);
  for (const [i, stage] of STAGES.entries()) {
    await query(client, 'UPDATE stages SET amount_cents = $3, due_date = $4 WHERE order_id = $1 AND stage = $2', [orderId, stage, amounts[i], due[i]]);
  }
  await query(client, 'DELETE FROM allocations WHERE order_id = $1', [orderId]);
  await writeAllocations(client, orderId, lines.map((l) => l.id), specs, amounts);
  await query(client, 'UPDATE orders SET total_cents = $2, vat_cents = $3 WHERE id = $1', [orderId, sums.totalCents, sums.vatCents]);
}

export async function createOrder(user: User, input: Record<string, unknown>): Promise<Order> {
  const kind = input['kind'];
  if (kind !== 'kit' && kind !== 'bike') throw invalid({ kind: 'Choose kit or bike.' });
  const bike = kind === 'bike' ? BIKES.find((b) => b.id === input['bikeId']) : undefined;
  if (kind === 'bike' && !bike) throw notFound();
  const errors: Record<string, string> = {
    ...errorsOf(() => { validatePlan(input['plan']); }),
    ...errorsOf(() => { expectedTotal(input['expectedTotalCents']); }),
  };
  if (kind === 'kit' && (typeof input['config'] !== 'object' || input['config'] === null)) errors['config'] = 'Required.';
  if (Object.keys(errors).length) throw invalid(errors);
  const plan = validatePlan(input['plan']);
  const expected = expectedTotal(input['expectedTotalCents']);

  const today = amsterdamToday();
  if (bike) {
    const specs = bikeLines(bike);
    if (totals(specs).totalCents !== expected) throw fail(409, 'quote_changed');
    return transaction(async (client) => {
      const sums = totals(specs);
      const row = await theRow<OrderRow>(client, `INSERT INTO orders (number, user_id, kind, state, plan, bike_id, fulfilment, delivery_country, total_cents, vat_cents)
        VALUES ('OM-' || nextval('order_number_seq'), $1, 'bike', 'quoted', $2, $3, 'workshop', 'NL', $4, $5) RETURNING *`, [user.id, JSON.stringify(plan), bike.id, sums.totalCents, sums.vatCents]);
      await writeLedger(client, row.id, specs, today);
      return assembleOrder(client, row);
    });
  }
  const resolved = await resolveConfig(input['config']);
  const specs = specsOf(resolved, today);
  const quote = quoteOfResolved(resolved);
  if (quote.totalCents !== expected) throw fail(409, 'quote_changed');
  const move = isClassMove(resolved.frame, resolved.target);
  const donor: StoredDonor = {
    plate: resolved.frame.plate ?? '', country: resolved.frame.regCountry, model: resolved.frame.model.model,
    firstAdmissionYear: resolved.frame.firstAdmissionYear, roadClass: resolved.frame.roadClass, plateColour: resolved.frame.plateColour,
    registeredMassT: resolved.frame.registeredMassT, confirmed: resolved.frame.confirmed,
  };
  return transaction(async (client) => {
    const row = await theRow<OrderRow>(client, `INSERT INTO orders (number, user_id, kind, state, plan, config, donor, verdict, class_move, fulfilment, delivery_country, total_cents, vat_cents)
      VALUES ('OM-' || nextval('order_number_seq'), $1, 'kit', 'quoted', $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`, [
      user.id, JSON.stringify(plan), JSON.stringify(configOf(resolved)), JSON.stringify(donor), quote.fit.verdict, move,
      resolved.fulfilment, resolved.country, quote.totalCents, quote.vatCents,
    ]);
    await writeLedger(client, row.id, specs, today);
    return assembleOrder(client, row);
  });
}

export async function patchOrder(user: User, id: string, input: Record<string, unknown>): Promise<Order> {
  const owned = await ownOrder(sql, user, id);
  if (input['config'] !== undefined && owned.state !== 'quoted') throw fail(409, 'quote_locked');
  const version = input['planVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version)) throw invalid({ planVersion: 'Required.' });
  const plan = input['plan'] === undefined ? null : validatePlan(input['plan']);
  let change: { fulfilment: Fulfilment; country: Country } | null = null;
  if (input['config'] !== undefined) {
    const requested = isRecord(input['config']) ? input['config'] : {};
    const fulfilment = oneOf(requested['fulfilment'] ?? owned.fulfilment, FULFILMENTS);
    const country = oneOf(requested['country'] ?? owned.delivery_country, DELIVERY_COUNTRIES);
    if (!fulfilment || !country) throw invalid({ config: 'Change only fulfilment and country.' });
    if (owned.kind === 'bike') throw invalid({ config: 'A bike is handed over at the workshop.' });
    change = { fulfilment, country };
  }
  return transaction(async (client) => {
    const locked = await ownOrder(client, user, id, true);
    if (locked.plan_version !== version) throw fail(412, 'stale_version');
    if (change && locked.kind === 'kit') {
      if (locked.state !== 'quoted') throw fail(409, 'quote_locked');
      const config: Config = { ...locked.config, fulfilment: change.fulfilment, country: change.country };
      const specs = orderSpecs(orderedPack(config.packId), orderedHub(config.hubId), config.fulfilment, config.country, locked.donor.country, locked.class_move, amsterdamToday());
      await repriceQuoted(client, id, specs, amsterdamToday());
      await query(client, 'UPDATE orders SET config = $2, fulfilment = $3, delivery_country = $4 WHERE id = $1', [id, JSON.stringify(config), change.fulfilment, change.country]);
    }
    await query(client, 'UPDATE orders SET plan = COALESCE($2::jsonb, plan), plan_version = plan_version + 1 WHERE id = $1', [id, plan ? JSON.stringify(plan) : null]);
    return loadOrder(client, id);
  });
}

export async function listOrders(user: User): Promise<Order[]> {
  const rows = await query<OrderRow>(sql, 'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC, number DESC', [user.id]);
  return assembleOrders(sql, rows);
}

export async function listDeskOrders(): Promise<DeskOrder[]> {
  return assembleDeskOrders(sql, await query<OrderRow>(sql, 'SELECT * FROM orders ORDER BY created_at DESC, number DESC'));
}
