import crypto from 'node:crypto';
import type { Cadence, ProvinceCode } from '../../shared/catalogue.js';
import type { ChangeKind, ChangeStatus, DunningStepName } from '../../shared/subscription.js';
import { isoTimestamp } from '../../shared/time.js';
import type { CardBehaviour } from '../domain/cards.js';
import type { ShipTo } from './orders.js';
import { query, queryOne } from './pool.js';

export interface SubscriptionRecord {
  id: string;
  user_id: string;
  killbill_account_id: string;
  plan: string;
  cadence: Cadence;
  province: ProvinceCode;
  ship_to: ShipTo;
  customer_email: string;
  customer_name: string;
  card_brand: string;
  card_last4: string;
  card_expiry_month: number;
  card_expiry_year: number;
  card_behaviour: CardBehaviour;
  card_charges: number;
  shipments_held: boolean;
}

export interface ChangeRequestRecord {
  id: string;
  subscription_id: string;
  kind: ChangeKind;
  cycles: number | null;
  plan: string | null;
  status: ChangeStatus;
  effective_date: string | null;
  requested_at: string;
}

interface ChangeRow {
  id: string;
  subscription_id: string;
  kind: ChangeKind;
  cycles: number | null;
  plan: string | null;
  status: ChangeStatus;
  effective_date: Date | null;
  requested_at: Date;
}

function toChange(row: ChangeRow): ChangeRequestRecord {
  return {
    id: row.id,
    subscription_id: row.subscription_id,
    kind: row.kind,
    cycles: row.cycles,
    plan: row.plan,
    status: row.status,
    effective_date:
      row.effective_date === null ? null : row.effective_date.toISOString().slice(0, 10),
    requested_at: isoTimestamp(row.requested_at),
  };
}

export interface NewSubscription {
  id: string;
  userId: string;
  killbillAccountId: string;
  plan: string;
  cadence: Cadence;
  province: ProvinceCode;
  shipTo: ShipTo;
  customerEmail: string;
  customerName: string;
  card: {
    brand: string;
    last4: string;
    expiryMonth: number;
    expiryYear: number;
    behaviour: CardBehaviour;
    charges: number;
  };
}

export async function insertSubscription(input: NewSubscription): Promise<void> {
  await query(
    `insert into subscriptions (
       id, user_id, killbill_account_id, plan, cadence, province, ship_to,
       customer_email, customer_name, card_brand, card_last4, card_expiry_month,
       card_expiry_year, card_behaviour, card_charges
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      input.id,
      input.userId,
      input.killbillAccountId,
      input.plan,
      input.cadence,
      input.province,
      JSON.stringify(input.shipTo),
      input.customerEmail,
      input.customerName,
      input.card.brand,
      input.card.last4,
      input.card.expiryMonth,
      input.card.expiryYear,
      input.card.behaviour,
      input.card.charges,
    ],
  );
}

export async function findSubscription(id: string): Promise<SubscriptionRecord | null> {
  return queryOne<SubscriptionRecord>('select * from subscriptions where id = $1', [id]);
}

export async function listSubscriptions(userId: string): Promise<SubscriptionRecord[]> {
  return query<SubscriptionRecord>(
    'select * from subscriptions where user_id = $1 order by created_at desc',
    [userId],
  );
}

export async function listAllSubscriptions(): Promise<SubscriptionRecord[]> {
  return query<SubscriptionRecord>('select * from subscriptions order by created_at');
}

export async function updateSubscriptionPlan(id: string, plan: string): Promise<void> {
  await query('update subscriptions set plan = $2 where id = $1', [id, plan]);
}

export async function updateSubscriptionCard(
  id: string,
  card: NewSubscription['card'],
): Promise<void> {
  await query(
    `update subscriptions
        set card_brand = $2, card_last4 = $3, card_expiry_month = $4,
            card_expiry_year = $5, card_behaviour = $6, card_charges = $7
      where id = $1`,
    [
      id,
      card.brand,
      card.last4,
      card.expiryMonth,
      card.expiryYear,
      card.behaviour,
      card.charges,
    ],
  );
}

export async function countCardCharge(id: string): Promise<void> {
  await query('update subscriptions set card_charges = card_charges + 1 where id = $1', [id]);
}

export async function setShipmentsHeld(id: string, held: boolean): Promise<void> {
  await query('update subscriptions set shipments_held = $2 where id = $1', [id, held]);
}

/* ---------------------------------------------------------- change requests */

export async function insertChangeRequest(input: {
  subscriptionId: string;
  kind: ChangeKind;
  cycles: number | null;
  plan: string | null;
  effectiveDate: string | null;
}): Promise<ChangeRequestRecord> {
  const id = crypto.randomUUID();
  const rows = await query<ChangeRow>(
    `insert into change_requests (id, subscription_id, kind, cycles, plan, status, effective_date)
     values ($1,$2,$3,$4,$5,'pending_provider',$6)
     returning *`,
    [id, input.subscriptionId, input.kind, input.cycles, input.plan, input.effectiveDate],
  );
  return toChange(rows[0]!);
}

export async function findChangeRequest(id: string): Promise<ChangeRequestRecord | null> {
  const row = await queryOne<ChangeRow>('select * from change_requests where id = $1', [id]);
  return row === null ? null : toChange(row);
}

export async function pendingChange(
  subscriptionId: string,
): Promise<ChangeRequestRecord | null> {
  const row = await queryOne<ChangeRow>(
    `select * from change_requests
      where subscription_id = $1 and status = 'pending_provider'
      order by requested_at desc limit 1`,
    [subscriptionId],
  );
  return row === null ? null : toChange(row);
}

export async function latestChange(
  subscriptionId: string,
): Promise<ChangeRequestRecord | null> {
  const row = await queryOne<ChangeRow>(
    `select * from change_requests where subscription_id = $1 order by requested_at desc limit 1`,
    [subscriptionId],
  );
  return row === null ? null : toChange(row);
}

export async function settleChangeRequest(id: string, status: ChangeStatus): Promise<void> {
  await query(
    'update change_requests set status = $2, settled_at = now(), claimed_at = null where id = $1',
    [id, status],
  );
}

/** Claims pending change requests, so one process confirms each exactly once. */
export async function claimPendingChanges(): Promise<ChangeRequestRecord[]> {
  const rows = await query<ChangeRow>(
    `update change_requests set claimed_at = now()
      where id in (
        select id from change_requests
         where status = 'pending_provider'
           and (claimed_at is null or claimed_at < now() - interval '20 seconds')
         order by requested_at
         limit 20
         for update skip locked
      )
      returning *`,
  );
  return rows.map(toChange);
}

export async function releaseChangeClaim(id: string): Promise<void> {
  await query('update change_requests set claimed_at = null where id = $1', [id]);
}


/* --------------------------------------------------------- renewal invoices */

export type RenewalState = 'charging' | 'paid' | 'failed';

/** Claims a Kill Bill invoice for charging. Only the inserting process owns it. */
export async function claimRenewalInvoice(
  invoiceId: string,
  subscriptionId: string,
): Promise<boolean> {
  const inserted = await query<{ invoice_id: string }>(
    `insert into renewal_cycles (invoice_id, subscription_id, state)
     values ($1, $2, 'charging')
     on conflict (invoice_id) do nothing
     returning invoice_id`,
    [invoiceId, subscriptionId],
  );
  return inserted.length === 1;
}

export async function setRenewalState(
  invoiceId: string,
  state: RenewalState,
  orderNumber: string | null,
): Promise<void> {
  await query('update renewal_cycles set state = $2, order_number = $3 where invoice_id = $1', [
    invoiceId,
    state,
    orderNumber,
  ]);
}

export async function releaseRenewalClaim(invoiceId: string): Promise<void> {
  await query('delete from renewal_cycles where invoice_id = $1', [invoiceId]);
}


export async function unpaidRenewalOrders(): Promise<
  Array<{ invoice_id: string; subscription_id: string; order_number: string }>
> {
  return query(
    `select invoice_id, subscription_id, order_number from renewal_cycles
      where state = 'paid' and order_number is not null
        and order_number in (select number from orders where status = 'pending_payment')`,
  );
}

/* ------------------------------------------------------------------ dunning */

export interface DunningRun {
  id: string;
  subscription_id: string;
  invoice_id: string;
  failed_at: Date;
  outcome: 'recovered' | 'cancelled' | null;
}

export async function openDunningRun(subscriptionId: string): Promise<DunningRun | null> {
  return queryOne<DunningRun>(
    'select * from dunning_runs where subscription_id = $1 and outcome is null order by failed_at desc limit 1',
    [subscriptionId],
  );
}

export async function startDunningRun(input: {
  subscriptionId: string;
  invoiceId: string;
  failedAt: Date;
}): Promise<DunningRun> {
  const id = crypto.randomUUID();
  const rows = await query<DunningRun>(
    `insert into dunning_runs (id, subscription_id, invoice_id, failed_at) values ($1,$2,$3,$4)
     returning *`,
    [id, input.subscriptionId, input.invoiceId, input.failedAt],
  );
  return rows[0]!;
}

export async function finishDunningRun(
  id: string,
  outcome: 'recovered' | 'cancelled',
): Promise<void> {
  await query('update dunning_runs set outcome = $2 where id = $1', [id, outcome]);
}

export async function listOpenDunningRuns(): Promise<DunningRun[]> {
  return query<DunningRun>('select * from dunning_runs where outcome is null order by failed_at');
}

/** Claims one dunning step, so it runs exactly once across all processes. */
export async function claimDunningStep(
  runId: string,
  step: DunningStepName,
): Promise<boolean> {
  const inserted = await query<{ step: string }>(
    `insert into dunning_step_runs (run_id, step) values ($1, $2)
     on conflict (run_id, step) do nothing
     returning step`,
    [runId, step],
  );
  return inserted.length === 1;
}

export async function releaseDunningStep(runId: string, step: DunningStepName): Promise<void> {
  await query('delete from dunning_step_runs where run_id = $1 and step = $2', [runId, step]);
}

export async function ranDunningSteps(runId: string): Promise<DunningStepName[]> {
  const rows = await query<{ step: DunningStepName }>(
    'select step from dunning_step_runs where run_id = $1',
    [runId],
  );
  return rows.map((row) => row.step);
}

export async function dashboardDunning(): Promise<{
  entered: number;
  recovered: number;
  cancelled: number;
  in_progress: number;
}> {
  const row = await queryOne<{
    entered: string;
    recovered: string;
    cancelled: string;
    in_progress: string;
  }>(
    `select count(*)::text as entered,
            count(*) filter (where outcome = 'recovered')::text as recovered,
            count(*) filter (where outcome = 'cancelled')::text as cancelled,
            count(*) filter (where outcome is null)::text as in_progress
       from dunning_runs
      where failed_at >= now() - interval '30 days'`,
  );
  return {
    entered: Number(row?.entered ?? '0'),
    recovered: Number(row?.recovered ?? '0'),
    cancelled: Number(row?.cancelled ?? '0'),
    in_progress: Number(row?.in_progress ?? '0'),
  };
}

/* ------------------------------------------------- upcoming renewal notices */

/** Claims this cycle's upcoming-renewal email, so only one process sends it. */
export async function claimUpcomingRenewalNotice(
  subscriptionId: string,
  renewalDate: string,
): Promise<boolean> {
  const inserted = await query<{ renewal_date: Date }>(
    `insert into upcoming_renewal_notices (subscription_id, renewal_date) values ($1, $2)
     on conflict (subscription_id, renewal_date) do nothing
     returning renewal_date`,
    [subscriptionId, renewalDate],
  );
  return inserted.length === 1;
}
