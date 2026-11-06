import type { Config } from '../config.js';
import { query } from '../db.js';
import { amsterdamInstant, amsterdamParts } from '../clock.js';

import type { Fulfilment, RoadClass } from './quote.js';
import { WITHDRAWAL_HOLIDAYS } from './seed.js';


// Order loading, invariants and serialisation. Payment, refund and lifecycle
// rules live in payments.ts, refunds.ts and lifecycle.ts, all using this file's
// aggregate as the single view of an order's money.

export type OrderState =
  | 'quoted' | 'deposit pending' | 'deposit confirmed' | 'instalments running'
  | 'in arrears' | 'paid in full' | 'kit dispatched' | 'fitted'
  | 'inspection passed' | 'withdrawn';

export type StageStatus = 'scheduled' | 'pending' | 'paid' | 'failed' | 'overdue';
export type Stage = 'deposit' | 'instalment-1' | 'instalment-2' | 'instalment-3';

export const STAGE_LABELS: Record<Stage, string> = {
  'deposit': 'Deposit', 'instalment-1': 'Instalment 1', 'instalment-2': 'Instalment 2', 'instalment-3': 'Instalment 3',
};
export const STAGES: Stage[] = ['deposit', 'instalment-1', 'instalment-2', 'instalment-3'];

export interface OrderLine {
  id: string;
  code: string;
  name: string;
  grossCents: number;
  vatRatePct: number;
  vatCents: number;
  netCents: number;
}

export interface OrderPlan {
  name: string;
  street: string;
  postcode: string;
  city: string;
  note?: string;
}

export interface OrderRecord {
  id: string;
  number: string;
  userId: string;
  kind: 'kit' | 'bike';
  state: OrderState;
  partlyRefunded: boolean;
  planVersion: number;
  plan: OrderPlan;
  donor: { plate: string; country: string; model: string; confirmed: boolean; firstAdmissionYear?: number; roadClass?: RoadClass; plateColour?: string; registeredMassKg?: number; fitVerdict?: string } | null;
  config: { packId: string; hubId: string; roadClass: RoadClass; fulfilment: Fulfilment; country: string; units?: string } | null;
  bikeId: string | null;
  lines: OrderLine[];
  totalCents: number;
  vatCents: number;
  notices: string[];
  feeCode: string | null;
  feeCents: number | null;
  quoteDate: string;
  deliveredOn: string | null;
  withdrawalDeadline: number | null;
  stageCorrections: Record<string, number>;
}

export interface PaymentRecord {
  id: string;
  orderId: string;
  stage: Stage;
  attempt: number;
  amountCents: number;
  status: StageStatus;
  idempotencyKey: string | null;
  externalKey: string;
  killbillPaymentId: string | null;
  killbillTransactionId: string | null;
  dueAt: number | null;
  confirmedAt: number | null;
}

export interface AllocationRecord {
  paymentId: string;
  lineId: string;
  grossCents: number;
  vatCents: number;
  netCents: number;
}

export interface RefundDrawRecord {
  id: string;
  refundId: string;
  paymentId: string;
  stage: Stage;
  amountCents: number;
  vatCents: number;
  status: 'pending' | 'returned' | 'failed';
  externalKey: string;
}

export interface RefundRecord {
  id: string;
  orderId: string;
  lineId: string;
  amountCents: number;
  status: 'pending' | 'returned' | 'partly returned' | 'failed';
  idempotencyKey: string;
  draws: RefundDrawRecord[];
}

export interface OrderAggregate {
  order: OrderRecord;
  payments: PaymentRecord[];
  allocations: AllocationRecord[];
  refunds: RefundRecord[];
}

export async function loadAggregate(config: Config, orderId: string): Promise<OrderAggregate | null> {
  const orderRow = await query<Record<string, unknown>>(config,
    `select id, number, user_id, kind, state, partly_refunded, plan_version, plan, donor, config, bike_id,
            lines, total_cents, vat_cents, notices, fee_code, fee_cents, quote_date, delivered_on, withdrawal_deadline, stage_corrections
     from orders where id = $1`, [orderId]);
  if (orderRow.rows.length === 0) return null;
  const r = orderRow.rows[0]!;
  const order: OrderRecord = {
    id: r['id'] as string,
    number: r['number'] as string,
    userId: r['user_id'] as string,
    kind: r['kind'] as 'kit' | 'bike',
    state: r['state'] as OrderState,
    partlyRefunded: r['partly_refunded'] as boolean,
    planVersion: r['plan_version'] as number,
    plan: r['plan'] as OrderPlan,
    donor: (r['donor'] as OrderRecord['donor']) ?? null,
    config: (r['config'] as OrderRecord['config']) ?? null,
    bikeId: (r['bike_id'] as string | null) ?? null,
    lines: r['lines'] as OrderLine[],
    totalCents: r['total_cents'] as number,
    vatCents: r['vat_cents'] as number,
    notices: r['notices'] as string[],
    feeCode: (r['fee_code'] as string | null) ?? null,
    feeCents: (r['fee_cents'] as number | null) ?? null,
    quoteDate: r['quote_date'] as string,
    deliveredOn: (r['delivered_on'] as string | null) ?? null,
    withdrawalDeadline: r['withdrawal_deadline'] ? new Date(r['withdrawal_deadline'] as string).getTime() : null,
    stageCorrections: (r['stage_corrections'] as Record<string, number> | null) ?? {},
  };
  const payments = await query<Record<string, unknown>>(config,
    `select id, stage, attempt, amount_cents, status, idempotency_key, external_key,
            killbill_payment_id, killbill_transaction_id, due_at, confirmed_at
     from payments where order_id = $1 order by created_at`, [orderId]);
  const paymentRecords: PaymentRecord[] = payments.rows.map((p) => ({
    id: p['id'] as string,
    orderId,
    stage: p['stage'] as Stage,
    attempt: p['attempt'] as number,
    amountCents: p['amount_cents'] as number,
    status: p['status'] as StageStatus,
    idempotencyKey: (p['idempotency_key'] as string | null) ?? null,
    externalKey: p['external_key'] as string,
    killbillPaymentId: (p['killbill_payment_id'] as string | null) ?? null,
    killbillTransactionId: (p['killbill_transaction_id'] as string | null) ?? null,
    dueAt: p['due_at'] ? new Date(p['due_at'] as string).getTime() : null,
    confirmedAt: p['confirmed_at'] ? new Date(p['confirmed_at'] as string).getTime() : null,
  }));
  const allocs = await query<Record<string, unknown>>(config,
    `select a.payment_id, a.line_id, a.gross_cents, a.vat_cents, a.net_cents
     from allocations a join payments p on p.id = a.payment_id
     where p.order_id = $1`, [orderId]);
  const allocations: AllocationRecord[] = allocs.rows.map((a) => ({
    paymentId: a['payment_id'] as string,
    lineId: a['line_id'] as string,
    grossCents: a['gross_cents'] as number,
    vatCents: a['vat_cents'] as number,
    netCents: a['net_cents'] as number,
  }));
  const refunds = await query<Record<string, unknown>>(config,
    `select id, line_id, amount_cents, status, idempotency_key from refunds where order_id = $1 order by created_at`, [orderId]);
  const refundRecords: RefundRecord[] = [];
  for (const rf of refunds.rows) {
    const draws = await query<Record<string, unknown>>(config,
      `select id, refund_id, payment_id, stage, amount_cents, vat_cents, status, external_key
       from refund_draws where refund_id = $1 order by created_at`, [rf['id']]);
    refundRecords.push({
      id: rf['id'] as string,
      orderId,
      lineId: rf['line_id'] as string,
      amountCents: rf['amount_cents'] as number,
      status: rf['status'] as RefundRecord['status'],
      idempotencyKey: rf['idempotency_key'] as string,
      draws: draws.rows.map((d) => ({
        id: d['id'] as string,
        refundId: rf['id'] as string,
        paymentId: d['payment_id'] as string,
        stage: d['stage'] as Stage,
        amountCents: d['amount_cents'] as number,
        vatCents: d['vat_cents'] as number,
        status: d['status'] as RefundDrawRecord['status'],
        externalKey: d['external_key'] as string,
      })),
    });
  }
  return { order, payments: paymentRecords, allocations, refunds: refundRecords };
}

// Collected cents on a line: confirmed allocations less returned draws.
export function collectedCents(agg: OrderAggregate, lineId: string): number {
  const paidIds = new Set(agg.payments.filter((p) => p.status === 'paid').map((p) => p.id));
  let sum = 0;
  for (const a of agg.allocations) {
    if (a.lineId === lineId && paidIds.has(a.paymentId)) sum += a.grossCents;
  }
  for (const rf of agg.refunds) {
    for (const d of rf.draws) {
      if (rf.lineId === lineId && d.status === 'returned') sum -= d.amountCents;
    }
  }
  return sum;
}

export function refundedCents(agg: OrderAggregate, lineId: string): number {
  let sum = 0;
  for (const rf of agg.refunds) {
    for (const d of rf.draws) {
      if (rf.lineId === lineId && d.status === 'returned') sum += d.amountCents;
    }
  }
  return sum;
}

// Pending draws on a line (money reserved by refunds in flight).
export function pendingDrawsCents(agg: OrderAggregate, lineId: string): number {
  let sum = 0;
  for (const rf of agg.refunds) {
    if (rf.status !== 'pending') continue;
    for (const d of rf.draws) {
      if (rf.lineId === lineId && d.status === 'pending') sum += d.amountCents;
    }
  }
  return sum;
}

export function anyPendingPayment(agg: OrderAggregate): boolean {
  return agg.payments.some((p) => p.status === 'pending');
}

export function anyPendingRefund(agg: OrderAggregate): boolean {
  return agg.refunds.some((r) => r.status === 'pending');
}

export function everReturned(agg: OrderAggregate): boolean {
  return agg.refunds.some((r) => r.status === 'returned' || r.status === 'partly returned');
}

// ---- Serialisation to the API shapes ----------------------------------------

export interface ApiStage {
  stage: Stage;
  label: string;
  dueDate: string | null;
  amountCents: number;
  vatCents: number;
  vatCorrectedCents: number;
  status: StageStatus;
  attempts: number;
  confirmedAt: string | null;
  allocations: { lineId: string; grossCents: number; vatCents: number; netCents: number }[];
}

export function serialiseStage(agg: OrderAggregate, stage: Stage): ApiStage {
  const payment = agg.payments.find((p) => p.stage === stage);
  const allocs = agg.allocations.filter((a) => a.paymentId === payment?.id);
  const vatCents = allocs.reduce((s, a) => s + a.vatCents, 0);
  return {
    stage,
    label: STAGE_LABELS[stage],
    dueDate: payment?.dueAt ? new Date(payment.dueAt).toISOString() : null,
    amountCents: payment?.amountCents ?? 0,
    vatCents,
    vatCorrectedCents: agg.order.stageCorrections[stage] ?? 0,
    status: payment?.status ?? 'scheduled',
    attempts: payment?.attempt ?? 0,
    confirmedAt: payment?.confirmedAt ? new Date(payment.confirmedAt).toISOString() : null,
    allocations: allocs.map((a) => ({ lineId: a.lineId, grossCents: a.grossCents, vatCents: a.vatCents, netCents: a.netCents })),
  };
}

export interface ApiLine {
  id: string;
  code: string;
  name: string;
  grossCents: number;
  vatRatePct: number;
  vatCents: number;
  netCents: number;
  collectedCents: number;
  refundedCents: number;
}

export interface ApiRefund {
  id: string;
  lineId: string;
  amountCents: number;
  returnedCents: number;
  failedCents: number;
  vatCents: number;
  status: RefundRecord['status'];
  draws: { stage: Stage; killbillPaymentId: string | null; amountCents: number; vatCents: number; status: RefundDrawRecord['status'] }[];
}

export interface ApiOrder {
  id: string;
  number: string;
  kind: string;
  state: OrderState;
  partlyRefunded: boolean;
  planVersion: number;
  plan: OrderPlan;
  donor: OrderRecord['donor'];
  config: OrderRecord['config'];
  lines: ApiLine[];
  totalCents: number;
  vatCents: number;
  notices: string[];
  schedule: ApiStage[];
  refunds: ApiRefund[];
  deliveredOn: string | null;
  withdrawalDeadline: string | null;
  withdrawalOpen: boolean;
}

export function serialiseRefund(rf: RefundRecord, agg: OrderAggregate): ApiRefund {
  const returned = rf.draws.filter((d) => d.status === 'returned').reduce((s, d) => s + d.amountCents, 0);
  const failed = rf.draws.filter((d) => d.status === 'failed').reduce((s, d) => s + d.amountCents, 0);
  const vat = rf.draws.filter((d) => d.status !== 'failed').reduce((s, d) => s + d.vatCents, 0);
  return {
    id: rf.id,
    lineId: rf.lineId,
    amountCents: rf.amountCents,
    returnedCents: returned,
    failedCents: failed,
    vatCents: vat,
    status: rf.status,
    draws: rf.draws.map((d) => ({
      stage: d.stage,
      killbillPaymentId: agg.payments.find((p) => p.id === d.paymentId)?.killbillPaymentId ?? null,
      amountCents: d.amountCents,
      vatCents: d.vatCents,
      status: d.status,
    })),
  };
}

export function withdrawalOpenNow(order: OrderRecord, nowMs: number): boolean {
  if (['fitted', 'inspection passed', 'withdrawn'].includes(order.state)) return false;
  if (order.withdrawalDeadline !== null && nowMs > order.withdrawalDeadline) return false;
  return true;
}

export function serialiseOrder(agg: OrderAggregate, nowMs: number): ApiOrder {
  const o = agg.order;
  return {
    id: o.id,
    number: o.number,
    kind: o.kind,
    state: o.state,
    partlyRefunded: o.partlyRefunded,
    planVersion: o.planVersion,
    plan: o.plan,
    donor: o.donor,
    config: o.config,
    lines: o.lines.map((l) => ({
      ...l,
      collectedCents: collectedCents(agg, l.id),
      refundedCents: refundedCents(agg, l.id),
    })),
    totalCents: o.totalCents,
    vatCents: o.vatCents,
    notices: o.notices,
    schedule: STAGES.map((s) => serialiseStage(agg, s)),
    refunds: agg.refunds.map((rf) => serialiseRefund(rf, agg)),
    deliveredOn: o.deliveredOn,
    withdrawalDeadline: o.withdrawalDeadline ? new Date(o.withdrawalDeadline).toISOString() : null,
    withdrawalOpen: withdrawalOpenNow(o, nowMs),
  };
}

// ---- Withdrawal deadline ----------------------------------------------------

// 23:59:00 Amsterdam on the 14th day after deliveredOn, rolled forward past
// Saturdays, Sundays and holidays of the delivery country.
export function withdrawalDeadlineFor(deliveredOn: string, country: string): number {
  const base = Date.parse(`${deliveredOn}T00:00:00Z`) + 14 * 24 * 3600_000;
  let date = new Date(base).toISOString().slice(0, 10);
  const holidays = WITHDRAWAL_HOLIDAYS[country] ?? [];
  for (let i = 0; i < 30; i++) {
    const weekday = amsterdamParts(Date.parse(`${date}T12:00:00Z`)).weekday;
    if (weekday !== 0 && weekday !== 6 && !holidays.includes(date)) break;
    date = new Date(Date.parse(`${date}T00:00:00Z`) + 24 * 3600_000).toISOString().slice(0, 10);
  }
  return amsterdamInstant(date, '23:59:00').instant;
}
