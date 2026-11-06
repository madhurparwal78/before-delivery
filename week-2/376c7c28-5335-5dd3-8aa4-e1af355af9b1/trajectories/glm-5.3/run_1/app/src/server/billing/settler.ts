import { pool, q, one } from "../db";
import { lockName } from "../lockname";
import { config } from "../config";
import { settleCharge } from "./charges";
import { settlePackAttempt } from "./packs";
import { settleRefund } from "./refunds";
import type { ChargeRow, PackAttemptRow } from "../types";

// The background settler: retries pending charges, finishes pending pack purchases
// and refund_pending refunds, and releases held pack attempts. Each item is handled
// by exactly one instance at a time through advisory locks; each settles exactly once.

async function withItemLock<T>(name: string, fn: () => Promise<T>): Promise<boolean> {
  const client = await pool.connect();
  try {
    const res = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [name]);
    if (!res.rows[0].ok) return false;
    try {
      await fn();
      return true;
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [name]);
    }
  } finally {
    client.release();
  }
}

export async function settlerPass(): Promise<void> {
  // Pending charges, each member's in creation order.
  const pendingCharges = await q<ChargeRow>(
    pool,
    "SELECT * FROM charges WHERE status = 'pending' ORDER BY member_id, created_at, id",
  );
  for (const charge of pendingCharges) {
    await withItemLock(lockName.charge(charge.id), async () => {
      const fresh = await one<ChargeRow>(pool, "SELECT * FROM charges WHERE id = $1", [charge.id]);
      if (fresh && fresh.status === "pending") {
        await settleCharge(fresh, 30000, { adoptFirst: true });
      }
    });
  }

  // Pending and held pack purchases.
  const attempts = await q<PackAttemptRow>(
    pool,
    "SELECT * FROM pack_attempts WHERE state IN ('pending','held') ORDER BY created_at",
  );
  for (const attempt of attempts) {
    await withItemLock(`kd-packattempt-${attempt.id}`, async () => {
      const fresh = await one<PackAttemptRow>(pool, "SELECT * FROM pack_attempts WHERE id = $1", [attempt.id]);
      if (fresh && (fresh.state === "pending" || fresh.state === "held")) {
        await settlePackAttempt(fresh);
      }
    });
  }

  // Refunds waiting for billing.
  const refundPending = await q<ChargeRow>(
    pool,
    "SELECT * FROM charges WHERE status = 'refund_pending' ORDER BY created_at",
  );
  for (const charge of refundPending) {
    await withItemLock(`kd-refundwork-${charge.id}`, async () => {
      const fresh = await one<ChargeRow>(pool, "SELECT * FROM charges WHERE id = $1", [charge.id]);
      if (fresh && fresh.status === "refund_pending") {
        await settleRefund(fresh);
      }
    });
  }
}

let running = false;

export function startBackgroundWork(callbacks: { sweep: () => Promise<void> }): void {
  const billingMs = config.billingRetrySeconds * 1000;
  const sweepMs = config.reminderSweepSeconds * 1000;
  setInterval(() => {
    if (running) return;
    running = true;
    void settlerPass().catch(() => {}).finally(() => {
      running = false;
    });
  }, billingMs);
  setInterval(() => {
    void callbacks.sweep().catch(() => {});
  }, sweepMs);
  // Run both once shortly after boot to catch up on downtime.
  setTimeout(() => {
    void settlerPass().catch(() => {});
    void callbacks.sweep().catch(() => {});
  }, 3000);
}
