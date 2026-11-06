import { BAY_PLAN } from '../shared/bays';
import { query, withTransaction } from './db';
import {
  BillingUnavailable,
  cancelSubscription,
  catalogIsPublished,
  ensureAccount,
  ensureSubscription,
  publishCatalog,
  readSubscriptionById,
} from './providers/killbill';
import { sendMail, type OutgoingMail } from './providers/smtp';

const TICK_MS = 2000;
const REFRESH_MS = 60_000;
const CLAIM_STALE_SECONDS = 60;

interface QueueRow {
  id: string;
  kind: string;
  car_id: string | null;
  payload: Record<string, unknown>;
}

/** Every queued effect is claimed through Postgres by one process at a time. */
async function claim(): Promise<QueueRow[]> {
  return query<QueueRow>(
    `update queue set claimed_at = now(), attempts = attempts + 1
     where id in (
       select id from queue
       where done_at is null
         and (claimed_at is null or claimed_at < now() - make_interval(secs => $1))
       order by id
       for update skip locked
       limit 20
     )
     returning id, kind, car_id, payload`,
    [CLAIM_STALE_SECONDS],
  );
}

async function markDone(id: string): Promise<void> {
  await query('update queue set done_at = now(), claimed_at = null where id = $1', [id]);
}

async function release(id: string, error: unknown): Promise<void> {
  await query('update queue set claimed_at = null, last_error = $2 where id = $1', [
    id,
    String(error).slice(0, 500),
  ]);
}

interface SubscriptionJoin {
  car_id: string;
  owner_id: string;
  owner_name: string;
  owner_email: string;
  plan: string;
  killbill_subscription_id: string | null;
  charged_through_date: string | null;
  bay_class: string | null;
  stay_seq: number;
}

async function loadSubscription(carId: string): Promise<SubscriptionJoin | null> {
  const rows = await query<SubscriptionJoin>(
    `select s.car_id, s.owner_id, u.name as owner_name, u.email as owner_email, s.plan,
       s.killbill_subscription_id, s.charged_through_date, b.class as bay_class,
       coalesce(c.stay_seq, 1) as stay_seq
     from subscriptions s
     join users u on u.id = s.owner_id
     left join cars c on c.id = s.car_id
     left join bays b on b.id = c.bay_id
     where s.car_id = $1`,
    [carId],
  );
  return rows[0] ?? null;
}

/** Account, subscription, its first invoice, then cancellation: in that order, per car. */
async function applySubscriptionCreate(carId: string): Promise<boolean> {
  const row = await loadSubscription(carId);
  if (row === null) return true;
  const accountId = await ensureAccount(row.owner_id, row.owner_name, row.owner_email);
  const plan =
    row.bay_class !== null && row.bay_class in BAY_PLAN
      ? BAY_PLAN[row.bay_class as keyof typeof BAY_PLAN].plan
      : row.plan;
  const subscription = await ensureSubscription(carId, accountId, plan, row.stay_seq);
  await query(
    `update subscriptions set killbill_subscription_id = $2, plan = $3,
       charged_through_date = $4, billing_end_date = $5
     where car_id = $1`,
    [
      carId,
      subscription.subscriptionId,
      plan,
      subscription.chargedThroughDate,
      subscription.billingEndDate,
    ],
  );
  return subscription.chargedThroughDate !== null;
}

async function applySubscriptionCancel(carId: string): Promise<boolean> {
  const row = await loadSubscription(carId);
  if (row === null) return true;
  if (row.killbill_subscription_id === null || row.charged_through_date === null) {
    const ready = await applySubscriptionCreate(carId);
    if (!ready) return false;
    const refreshed = await loadSubscription(carId);
    if (refreshed === null || refreshed.killbill_subscription_id === null) return false;
    row.killbill_subscription_id = refreshed.killbill_subscription_id;
  }
  await cancelSubscription(row.killbill_subscription_id);
  const subscription = await readSubscriptionById(row.killbill_subscription_id);
  if (subscription === null) return false;
  await query(
    `update subscriptions set charged_through_date = coalesce($2, charged_through_date),
       billing_end_date = $3, cancelled = true
     where car_id = $1`,
    [carId, subscription.chargedThroughDate, subscription.billingEndDate],
  );
  return subscription.billingEndDate !== null;
}

async function applyEffect(row: QueueRow): Promise<boolean> {
  switch (row.kind) {
    case 'subscription_create':
      return applySubscriptionCreate(String(row.payload.car_id ?? row.car_id ?? ''));
    case 'subscription_cancel':
      return applySubscriptionCancel(String(row.payload.car_id ?? row.car_id ?? ''));
    case 'email': {
      await sendMail(row.payload as unknown as OutgoingMail);
      return true;
    }
    default:
      return true;
  }
}

let catalogPublished = false;

async function ensureCatalog(): Promise<void> {
  if (catalogPublished) return;
  try {
    if (!(await catalogIsPublished())) await publishCatalog();
    catalogPublished = true;
  } catch (error) {
    if (!(error instanceof BillingUnavailable)) throw error;
  }
}

/** Keeps each stored car's charged-through date as Kill Bill confirms it. */
async function refreshSubscriptions(): Promise<void> {
  const rows = await query<{ car_id: string; killbill_subscription_id: string }>(
    `select car_id, killbill_subscription_id from subscriptions
     where killbill_subscription_id is not null and cancelled = false`,
  );
  for (const row of rows) {
    try {
      const subscription = await readSubscriptionById(row.killbill_subscription_id);
      if (subscription === null) continue;
      await query(
        'update subscriptions set charged_through_date = $2, billing_end_date = $3 where car_id = $1',
        [row.car_id, subscription.chargedThroughDate, subscription.billingEndDate],
      );
    } catch (error) {
      if (!(error instanceof BillingUnavailable)) throw error;
      return;
    }
  }
}

async function tick(): Promise<void> {
  await ensureCatalog();
  const claimed = await claim();
  for (const row of claimed) {
    try {
      const done = await applyEffect(row);
      if (done) await markDone(row.id);
      else await release(row.id, 'waiting for the provider to confirm');
    } catch (error) {
      await release(row.id, error);
    }
  }
}

export function startQueueWorker(): void {
  const run = (): void => {
    void tick().catch((error: unknown) => {
      process.stderr.write(`queue tick failed: ${String(error)}\n`);
    });
  };
  run();
  setInterval(run, TICK_MS).unref();
  setInterval(() => {
    void refreshSubscriptions().catch(() => undefined);
  }, REFRESH_MS).unref();
}

/** Queues a car's bay-subscription effect, inside the action's own transaction. */
export async function queueSubscriptionEffect(
  tx: { query(text: string, values?: readonly (string | number | boolean | null | Date)[]): Promise<unknown[]> },
  kind: 'subscription_create' | 'subscription_cancel',
  carId: string,
): Promise<void> {
  await tx.query('insert into queue (kind, car_id, payload, created_at) values ($1,$2,$3,now())', [
    kind,
    carId,
    JSON.stringify({ car_id: carId }),
  ]);
}
