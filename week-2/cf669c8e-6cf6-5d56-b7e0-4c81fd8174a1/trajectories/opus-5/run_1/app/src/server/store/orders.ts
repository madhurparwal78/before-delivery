/**
 * Order persistence and assembly.
 *
 * Amounts are recomputed in exactly two ways:
 *  - `requoteOrder` rebuilds a `quoted` order's lines and fresh schedule;
 *  - `recomputeOrder` re-spreads the unpaid balance after a refund returns
 *    money or a switch changes the rate, leaving confirmed stages untouched.
 */

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import type {
  Allocation,
  Config,
  DeliveryCountry,
  Draw,
  DrawStatus,
  Line,
  Order,
  OrderState,
  PlanInput,
  Refund,
  RefundStatus,
  ResolvedDonor,
  Stage,
  StageName,
  StageStatus,
  Verdict,
} from '../../shared/types.js';
import { allocateStages, isLockedStatus, respreadAmounts } from '../domain/schedule.js';
import { freshSchedule, type DraftLine } from '../domain/quote.js';
import { STAGE_ORDER, extractVat } from '../domain/money.js';
import { isWithdrawalOpen, withdrawalDeadline } from '../domain/withdrawal.js';
import { isoWithAmsterdamOffset, shopNow } from '../domain/clock.js';
import { type Queryable } from '../db/pool.js';

export interface OrderRow {
  id: string;
  number: string;
  user_id: string;
  kind: 'kit' | 'bike';
  state: OrderState;
  partly_refunded: boolean;
  plan_version: number;
  plan: PlanInput;
  /** The full resolved donor, which the deposit gate compares to a fresh read. */
  donor: ResolvedDonor | null;
  config: Config | null;
  bike_id: string | null;
  notices: string[];
  delivered_on: string | null;
  fee_quote_date: string | null;
  fit_verdict: Verdict | null;
}

export interface LineRow {
  id: string;
  position: number;
  code: string;
  name: string;
  gross_cents: number;
  vat_rate_pct: number;
  vat_cents: number;
}

export interface StageRow {
  stage: StageName;
  position: number;
  due_date: string | null;
  amount_cents: number;
  status: StageStatus;
  attempts: number;
  confirmed_at: string | null;
  vat_corrected_cents: number;
}

export interface AllocationRow {
  stage: StageName;
  line_id: string;
  gross_cents: number;
  vat_cents: number;
}

export interface RefundRow {
  id: string;
  line_id: string;
  amount_cents: number;
  status: RefundStatus;
}

export interface DrawRow {
  id: string;
  refund_id: string;
  stage: StageName;
  line_id: string;
  killbill_payment_id: string | null;
  external_key: string;
  amount_cents: number;
  vat_cents: number;
  status: DrawStatus;
  sent: boolean;
}

export interface LoadedOrder {
  order: OrderRow;
  lines: LineRow[];
  stages: StageRow[];
  allocations: AllocationRow[];
  refunds: RefundRow[];
  draws: DrawRow[];
}



export async function loadOrder(client: Queryable, orderId: string): Promise<LoadedOrder | null> {
  const orders = await client.query<OrderRow>('SELECT * FROM orders WHERE id = $1', [orderId]);
  const order = orders.rows[0];
  return order ? withChildren(client, order) : null;
}

/** Load for update, so concurrent money requests on one order serialise. */
export async function loadOrderForUpdate(client: Queryable, orderId: string): Promise<LoadedOrder | null> {
  const orders = await client.query<OrderRow>('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
  const order = orders.rows[0];
  return order ? withChildren(client, order) : null;
}

async function withChildren(client: Queryable, order: OrderRow): Promise<LoadedOrder> {
  const lines = await client.query<LineRow>(
    'SELECT * FROM order_lines WHERE order_id = $1 ORDER BY position',
    [order.id],
  );
  const stages = await client.query<StageRow>(
    'SELECT * FROM order_stages WHERE order_id = $1 ORDER BY position',
    [order.id],
  );
  const allocations = await client.query<AllocationRow>(
    'SELECT * FROM stage_allocations WHERE order_id = $1',
    [order.id],
  );
  const refunds = await client.query<RefundRow>(
    'SELECT * FROM refunds WHERE order_id = $1 ORDER BY created_at',
    [order.id],
  );
  const draws = await client.query<DrawRow>(
    'SELECT * FROM refund_draws WHERE order_id = $1 ORDER BY created_at',
    [order.id],
  );
  return {
    order,
    lines: lines.rows,
    stages: stages.rows,
    allocations: allocations.rows,
    refunds: refunds.rows,
    draws: draws.rows,
  };
}

export async function loadOrdersForUser(client: Queryable, userId: string): Promise<LoadedOrder[]> {
  const orders = await client.query<OrderRow>(
    'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
    [userId],
  );
  const loaded: LoadedOrder[] = [];
  for (const order of orders.rows) loaded.push(await withChildren(client, order));
  return loaded;
}

export async function loadAllOrders(client: Queryable): Promise<LoadedOrder[]> {
  const orders = await client.query<OrderRow>('SELECT * FROM orders ORDER BY created_at DESC');
  const loaded: LoadedOrder[] = [];
  for (const order of orders.rows) loaded.push(await withChildren(client, order));
  return loaded;
}

/** Returned draws on a stage's allocation for a line, which free line money. */
function returnedByStageLine(
  draws: readonly DrawRow[],
): Map<StageName, Map<string, { grossCents: number; vatCents: number }>> {
  const byStage = new Map<StageName, Map<string, { grossCents: number; vatCents: number }>>();
  for (const draw of draws) {
    if (draw.status !== 'returned') continue;
    const forStage = byStage.get(draw.stage) ?? new Map<string, { grossCents: number; vatCents: number }>();
    const current = forStage.get(draw.line_id) ?? { grossCents: 0, vatCents: 0 };
    forStage.set(draw.line_id, {
      grossCents: current.grossCents + draw.amount_cents,
      vatCents: current.vatCents + draw.vat_cents,
    });
    byStage.set(draw.stage, forStage);
  }
  return byStage;
}

/**
 * Stored allocations are the historical record for every stage, so the
 * assembled view always shows what the shop actually allocated.
 */
function storedAllocations(loaded: LoadedOrder, stage: StageName): Allocation[] | null {
  const rows = loaded.allocations.filter((row) => row.stage === stage);
  if (rows.length === 0) return null;
  const byLine = new Map(rows.map((row) => [row.line_id, row]));
  return loaded.lines.map((line) => {
    const row = byLine.get(line.id);
    const grossCents = row?.gross_cents ?? 0;
    const vatCents = row?.vat_cents ?? 0;
    return { lineId: line.id, grossCents, vatCents, netCents: grossCents - vatCents };
  });
}

export function assembleStages(loaded: LoadedOrder): Stage[] {
  const returned = returnedByStageLine(loaded.draws);
  return allocateStages(
    loaded.lines.map((line) => ({
      id: line.id,
      grossCents: line.gross_cents,
      vatCents: line.vat_cents,
      ratePct: line.vat_rate_pct,
    })),
    loaded.stages.map((stage) => ({
      stage: stage.stage,
      amountCents: stage.amount_cents,
      status: stage.status,
      dueDate: stage.due_date,
      attempts: stage.attempts,
      confirmedAt: stage.confirmed_at,
      vatCorrectedCents: stage.vat_corrected_cents,
      locked: storedAllocations(loaded, stage.stage),
      returnedByLine: returned.get(stage.stage) ?? new Map(),
    })),
  );
}

export function assembleLines(loaded: LoadedOrder, stages: readonly Stage[]): Line[] {
  return loaded.lines.map((line) => {
    let confirmed = 0;
    for (const stage of stages) {
      if (!isLockedStatus(stage.status)) continue;
      confirmed += stage.allocations.find((a) => a.lineId === line.id)?.grossCents ?? 0;
    }
    const refundedCents = loaded.draws
      .filter((draw) => draw.line_id === line.id && draw.status === 'returned')
      .reduce((sum, draw) => sum + draw.amount_cents, 0);
    return {
      id: line.id,
      code: line.code,
      name: line.name,
      grossCents: line.gross_cents,
      vatRatePct: line.vat_rate_pct,
      vatCents: line.vat_cents,
      netCents: line.gross_cents - line.vat_cents,
      collectedCents: confirmed - refundedCents,
      refundedCents,
    };
  });
}

export function assembleRefunds(loaded: LoadedOrder): Refund[] {
  return loaded.refunds.map((refund) => {
    const draws = loaded.draws.filter((draw) => draw.refund_id === refund.id);
    return {
      id: refund.id,
      lineId: refund.line_id,
      amountCents: refund.amount_cents,
      returnedCents: draws
        .filter((draw) => draw.status === 'returned')
        .reduce((sum, draw) => sum + draw.amount_cents, 0),
      failedCents: draws
        .filter((draw) => draw.status === 'failed')
        .reduce((sum, draw) => sum + draw.amount_cents, 0),
      // The refund's VAT is the sum over its draws that have not failed.
      vatCents: draws.filter((d) => d.status !== 'failed').reduce((sum, d) => sum + d.vat_cents, 0),
      status: refund.status,
      draws: draws.map(
        (draw): Draw => ({
          stage: draw.stage,
          killbillPaymentId: draw.killbill_payment_id,
          amountCents: draw.amount_cents,
          vatCents: draw.vat_cents,
          status: draw.status,
        }),
      ),
    };
  });
}

export function deliveryCountryOf(order: OrderRow): DeliveryCountry {
  return order.config?.country ?? 'NL';
}

export function assembleOrder(loaded: LoadedOrder): Order {
  const stages = assembleStages(loaded);
  const lines = assembleLines(loaded, stages);
  const deadline = withdrawalDeadline(loaded.order.delivered_on, deliveryCountryOf(loaded.order));
  return {
    id: loaded.order.id,
    number: loaded.order.number,
    kind: loaded.order.kind,
    state: loaded.order.state,
    partlyRefunded: loaded.order.partly_refunded,
    planVersion: loaded.order.plan_version,
    plan: loaded.order.plan,
    donor: loaded.order.donor
      ? {
          plate: loaded.order.donor.plate,
          country: loaded.order.donor.country,
          model: loaded.order.donor.model,
          confirmed: loaded.order.donor.confirmed,
        }
      : null,
    config: loaded.order.config,
    lines,
    totalCents: lines.reduce((sum, line) => sum + line.grossCents, 0),
    vatCents: lines.reduce((sum, line) => sum + line.vatCents, 0),
    notices: loaded.order.notices,
    schedule: stages,
    refunds: assembleRefunds(loaded),
    deliveredOn: loaded.order.delivered_on,
    withdrawalDeadline: deadline ? isoWithAmsterdamOffset(deadline) : null,
    withdrawalOpen: isWithdrawalOpen(loaded.order.state, deadline, shopNow()),
  };
}

export async function nextOrderNumber(client: Queryable): Promise<string> {
  const result = await client.query<{ value: string }>("SELECT nextval('order_number_seq')::text AS value");
  const value = result.rows[0]?.value;
  if (!value) throw new Error('order number sequence returned nothing');
  return `OM-${value.padStart(5, '0')}`;
}

export interface CreateOrderInput {
  userId: string;
  kind: 'kit' | 'bike';
  drafts: readonly DraftLine[];
  plan: PlanInput;
  donor: ResolvedDonor | null;
  config: Config | null;
  bikeId: string | null;
  notices: string[];
  feeQuoteDate: string | null;
  fitVerdict: Verdict | null;
}

export async function insertOrder(client: PoolClient, input: CreateOrderInput): Promise<string> {
  const orderId = randomUUID();
  const number = await nextOrderNumber(client);

  await client.query(
    `INSERT INTO orders(id, number, user_id, kind, state, plan, donor, config, bike_id, notices, fee_quote_date, fit_verdict)
     VALUES ($1, $2, $3, $4, 'quoted', $5, $6, $7, $8, $9, $10, $11)`,
    [
      orderId,
      number,
      input.userId,
      input.kind,
      JSON.stringify(input.plan),
      input.donor ? JSON.stringify(input.donor) : null,
      input.config ? JSON.stringify(input.config) : null,
      input.bikeId,
      JSON.stringify(input.notices),
      input.feeQuoteDate,
      input.fitVerdict,
    ],
  );

  await writeLinesAndFreshSchedule(client, orderId, input.drafts);
  return orderId;
}

async function writeLinesAndFreshSchedule(
  client: PoolClient,
  orderId: string,
  drafts: readonly DraftLine[],
): Promise<void> {
  const lines: Line[] = drafts.map((draft) => {
    const vatCents = extractVat(draft.grossCents, draft.vatRatePct);
    return {
      id: randomUUID(),
      code: draft.code,
      name: draft.name,
      grossCents: draft.grossCents,
      vatRatePct: draft.vatRatePct,
      vatCents,
      netCents: draft.grossCents - vatCents,
      collectedCents: 0,
      refundedCents: 0,
    };
  });

  for (const [position, line] of lines.entries()) {
    await client.query(
      `INSERT INTO order_lines(id, order_id, position, code, name, gross_cents, vat_rate_pct, vat_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [line.id, orderId, position, line.code, line.name, line.grossCents, line.vatRatePct, line.vatCents],
    );
  }

  const stages = freshSchedule(lines);
  for (const [position, stage] of stages.entries()) {
    await client.query(
      `INSERT INTO order_stages(order_id, stage, position, amount_cents, status)
       VALUES ($1, $2, $3, $4, 'scheduled')`,
      [orderId, stage.stage, position, stage.amountCents],
    );
    for (const allocation of stage.allocations) {
      await client.query(
        `INSERT INTO stage_allocations(order_id, stage, line_id, gross_cents, vat_cents)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, stage.stage, allocation.lineId, allocation.grossCents, allocation.vatCents],
      );
    }
  }
}

/** Rebuild a `quoted` order from new drafts. Nothing is paid, so nothing is kept. */
export async function requoteOrder(
  client: PoolClient,
  orderId: string,
  drafts: readonly DraftLine[],
  patch: { config?: Config; notices?: string[]; feeQuoteDate?: string },
): Promise<void> {
  await client.query('DELETE FROM stage_allocations WHERE order_id = $1', [orderId]);
  await client.query('DELETE FROM order_stages WHERE order_id = $1', [orderId]);
  await client.query('DELETE FROM order_lines WHERE order_id = $1', [orderId]);

  if (patch.config) {
    await client.query('UPDATE orders SET config = $2 WHERE id = $1', [orderId, JSON.stringify(patch.config)]);
  }
  if (patch.notices) {
    await client.query('UPDATE orders SET notices = $2 WHERE id = $1', [orderId, JSON.stringify(patch.notices)]);
  }
  if (patch.feeQuoteDate) {
    await client.query('UPDATE orders SET fee_quote_date = $2 WHERE id = $1', [orderId, patch.feeQuoteDate]);
  }

  await writeLinesAndFreshSchedule(client, orderId, drafts);
}

/**
 * Re-spread the unpaid balance and re-allocate every unpaid stage against the
 * current line amounts. Confirmed stages keep their amounts and allocations.
 */
export async function recomputeOrder(client: PoolClient, orderId: string): Promise<void> {
  const loaded = await loadOrder(client, orderId);
  if (!loaded) throw new Error(`order ${orderId} vanished during recompute`);

  // No re-spread runs on a withdrawn order.
  if (loaded.order.state === 'withdrawn') return;

  const totalCents = loaded.lines.reduce((sum, line) => sum + line.gross_cents, 0);
  const returnedCents = loaded.draws
    .filter((draw) => draw.status === 'returned')
    .reduce((sum, draw) => sum + draw.amount_cents, 0);
  const confirmedCents = loaded.stages
    .filter((stage) => isLockedStatus(stage.status))
    .reduce((sum, stage) => sum + stage.amount_cents, 0);

  const amounts = respreadAmounts(
    totalCents,
    loaded.stages.map((stage) => ({
      stage: stage.stage,
      status: stage.status,
      amountCents: stage.amount_cents,
    })),
    confirmedCents - returnedCents,
  );

  for (const stage of loaded.stages) {
    if (isLockedStatus(stage.status)) continue;
    const amount = amounts.get(stage.stage);
    if (amount === undefined || amount === stage.amount_cents) continue;
    await client.query('UPDATE order_stages SET amount_cents = $3 WHERE order_id = $1 AND stage = $2', [
      orderId,
      stage.stage,
      amount,
    ]);
  }

  const refreshed = await loadOrder(client, orderId);
  if (!refreshed) throw new Error(`order ${orderId} vanished during recompute`);
  const returned = returnedByStageLine(refreshed.draws);

  const recomputed = allocateStages(
    refreshed.lines.map((line) => ({
      id: line.id,
      grossCents: line.gross_cents,
      vatCents: line.vat_cents,
      ratePct: line.vat_rate_pct,
    })),
    refreshed.stages.map((stage) => ({
      stage: stage.stage,
      amountCents: stage.amount_cents,
      status: stage.status,
      dueDate: stage.due_date,
      attempts: stage.attempts,
      confirmedAt: stage.confirmed_at,
      vatCorrectedCents: stage.vat_corrected_cents,
      locked: isLockedStatus(stage.status) ? storedAllocations(refreshed, stage.stage) : null,
      returnedByLine: returned.get(stage.stage) ?? new Map(),
    })),
  );

  for (const stage of recomputed) {
    if (isLockedStatus(stage.status)) continue;
    await client.query('DELETE FROM stage_allocations WHERE order_id = $1 AND stage = $2', [orderId, stage.stage]);
    for (const allocation of stage.allocations) {
      await client.query(
        `INSERT INTO stage_allocations(order_id, stage, line_id, gross_cents, vat_cents)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderId, stage.stage, allocation.lineId, allocation.grossCents, allocation.vatCents],
      );
    }
  }
}

export { STAGE_ORDER, isLockedStatus };
