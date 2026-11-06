import type { Db, Tx } from './db.ts';
import type { AppCtx } from './context.ts';
import { ERRORS } from './errors.ts';
import { KillBillError } from './providers/killbill.ts';

/**
 * The queue of pending provider effects. Each effect is claimed through
 * Postgres by one process at a time and applied exactly once. A failed
 * attempt releases its claim for retry.
 */
export interface QueuePayload {
  kind: 'killbill_account' | 'killbill_subscription' | 'killbill_subscription_cancel' | 'email';
  payload: Record<string, unknown>;
}

export async function enqueue(db: Db, kind: QueuePayload['kind'], payload: Record<string, unknown>): Promise<void> {
  await db.query(
    'INSERT INTO queue (kind, payload, created_at) VALUES ($1,$2,now())',
    [kind, JSON.stringify(payload)],
  );
}

const CLAIM_TIMEOUT_MS = 25_000;

interface QueueRow {
  id: string;
  kind: QueuePayload['kind'];
  payload: Record<string, unknown>;
}

async function claimNext(db: Db): Promise<QueueRow | null> {
  const result = await db.withTx(async (tx) => {
    const rows = await tx.query(
      `SELECT id, kind, payload FROM queue
       WHERE claimed_at IS NULL OR claimed_at < now() - interval '${CLAIM_TIMEOUT_MS} milliseconds'
       ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
    );
    const row = rows.rows[0] as { id: string; kind: QueuePayload['kind']; payload: string } | undefined;
    if (!row) return null;
    await tx.query(
      'UPDATE queue SET claimed_at = now(), claimed_by = $2, attempts = attempts + 1 WHERE id = $1',
      [row.id, process.pid.toString()],
    );
    return { id: row.id, kind: row.kind, payload: JSON.parse(row.payload) as Record<string, unknown> };
  });
  return result;
}

async function releaseClaim(db: Db, id: string, error: string): Promise<void> {
  await db.query(
    'UPDATE queue SET claimed_at = NULL, claimed_by = NULL, last_error = $2 WHERE id = $1',
    [id, error.slice(0, 500)],
  );
}

async function done(db: Db, id: string): Promise<void> {
  await db.query('DELETE FROM queue WHERE id = $1', [id]);
}

/** One pass over the queue; returns how many effects were applied. */
export async function queuePass(ctx: AppCtx): Promise<number> {
  let applied = 0;
  for (let i = 0; i < 50; i++) {
    const item = await claimNext(ctx.db);
    if (!item) break;
    try {
      await applyEffect(ctx, item);
      await done(ctx.db, item.id);
      applied += 1;
    } catch (err) {
      await releaseClaim(ctx.db, item.id, err instanceof Error ? err.message : String(err));
      break; // service unreachable; try again on the next pass
    }
  }
  return applied;
}

async function applyEffect(ctx: AppCtx, item: QueueRow): Promise<void> {
  switch (item.kind) {
    case 'killbill_account':
      await applyAccount(ctx, item.payload);
      return;
    case 'killbill_subscription':
      await applySubscription(ctx, item.payload);
      return;
    case 'killbill_subscription_cancel':
      await applyCancel(ctx, item.payload);
      return;
    case 'email':
      await applyEmail(ctx, item.payload);
      return;
  }
}

function asKillBillError(err: unknown): KillBillError {
  if (err instanceof KillBillError) return err;
  return new KillBillError(0, String(err));
}

export async function isBillingDown(ctx: AppCtx): Promise<boolean> {
  const up = await ctx.killbill.health();
  return !up;
}

async function applyAccount(ctx: AppCtx, payload: Record<string, unknown>): Promise<void> {
  const ownerId = String(payload['owner_id']);
  const users = await ctx.db.query<{ name: string; email: string }>(
    'SELECT name, email FROM users WHERE id = $1',
    [ownerId],
  );
  const owner = users[0];
  if (!owner) throw new Error(`owner ${ownerId} missing`);
  await ctx.killbill.ensureAccount(
    `${ctx.env.killbill.keyPrefix}owner-${ownerId}`,
    owner.name,
    owner.email,
  );
}

async function applySubscription(ctx: AppCtx, payload: Record<string, unknown>): Promise<void> {
  const carId = String(payload['car_id']);
  const car = await loadCar(ctx, carId);
  if (!car) throw new Error(`car ${carId} missing`);
  if (car.status === 'released') return; // released before billing caught up; cancellation handled at release
  await ensureSubscriptionForCar(ctx, car);
}

export async function ensureSubscriptionForCar(
  ctx: AppCtx,
  car: { id: string; owner_id: string; bay_id: string | null; bay_class: string | null; bay_subscription_id: string | null },
): Promise<void> {
  const accountId = await ctx.killbill.ensureAccount(
    `${ctx.env.killbill.keyPrefix}owner-${car.owner_id}`,
    ...await ownerNameEmail(ctx, car.owner_id),
  );
  const plan = car.bay_class ?? 'standard';
  const planId = planForClass(plan);
  const key = `${ctx.env.killbill.keyPrefix}car-${car.id}`;
  let subscriptionId = car.bay_subscription_id;
  if (!subscriptionId) {
    const existing = await ctx.killbill.findSubscriptionByExternalKey(key);
    if (existing && existing.state !== 'CANCELLED') {
      subscriptionId = existing.subscriptionId;
    } else if (existing && existing.state === 'CANCELLED') {
      // a cancelled subscription from an earlier stay: create a fresh one
      let n = 2;
      for (;;) {
        const candidate = await ctx.killbill.findSubscriptionByExternalKey(`${key}-${n}`);
        if (!candidate || candidate.state !== 'CANCELLED') {
          if (candidate) {
            subscriptionId = candidate.subscriptionId;
            break;
          }
          const created = await ctx.killbill.createSubscription(accountId, `${key}-${n}`, planId);
          subscriptionId = created.subscriptionId;
          break;
        }
        n += 1;
      }
    } else {
      const created = await ctx.killbill.createSubscription(accountId, key, planId);
      subscriptionId = created.subscriptionId;
    }
    await ctx.db.query('UPDATE cars SET bay_subscription_id = $1 WHERE id = $2', [subscriptionId, car.id]);
  }
}

async function ownerNameEmail(ctx: AppCtx, ownerId: string): Promise<[string, string]> {
  const users = await ctx.db.query<{ name: string; email: string }>('SELECT name, email FROM users WHERE id = $1', [ownerId]);
  const owner = users[0];
  if (!owner) throw new Error(`owner ${ownerId} missing`);
  return [owner.name, owner.email];
}

function planForClass(bayClass: string): string {
  switch (bayClass) {
    case 'standard':
      return 'bay-standard-monthly';
    case 'covered_lift':
      return 'bay-covered-lift-monthly';
    case 'sealed_capsule':
      return 'bay-sealed-capsule-monthly';
    default:
      return 'bay-standard-monthly';
  }
}

async function applyCancel(ctx: AppCtx, payload: Record<string, unknown>): Promise<void> {
  const carId = String(payload['car_id']);
  const car = await loadCar(ctx, carId);
  if (!car) throw new Error(`car ${carId} missing`);
  if (!car.bay_subscription_id) return;
  // Only cancel once Kill Bill shows the charged-through date
  const sub = await ctx.killbill.getSubscription(car.bay_subscription_id);
  if (!sub.chargedThroughDate) {
    throw new Error('charged-through date not yet visible');
  }
  const cancelled = await ctx.killbill.cancelSubscriptionEndOfTerm(car.bay_subscription_id);
  const billingEnd = cancelled.billingEndDate ?? cancelled.chargedThroughDate;
  await ctx.db.query(
    'UPDATE cars SET bay_billing_end_date = $1 WHERE id = $2',
    [billingEnd, carId],
  );
}

async function applyEmail(ctx: AppCtx, payload: Record<string, unknown>): Promise<void> {
  const to = String(payload['to']);
  const subject = String(payload['subject']);
  const text = String(payload['text']);
  await ctx.mail.send(to, subject, text, `<pre>${escapeHtml(text)}</pre>`);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function loadCar(
  ctx: AppCtx,
  carId: string,
): Promise<{ id: string; owner_id: string; bay_id: string | null; bay_class: string | null; bay_subscription_id: string | null; status: string } | null> {
  const rows = await ctx.db.query<{
    id: string; owner_id: string; bay_id: string | null; bay_class: string | null;
    bay_subscription_id: string | null; status: string;
  }>(
    `SELECT c.id, c.owner_id, c.bay_id, b.class AS bay_class, c.bay_subscription_id, c.status
     FROM cars c LEFT JOIN bays b ON b.id = c.bay_id WHERE c.id = $1`,
    [carId],
  );
  return rows[0] ?? null;
}

export async function startQueueWorker(ctx: AppCtx): Promise<void> {
  const tick = async (): Promise<void> => {
    try {
      await queuePass(ctx);
    } catch {
      // keep the worker alive across provider outages
    }
  };
  await tick();
  const timer = setInterval(tick, 5_000);
  timer.unref();
}
