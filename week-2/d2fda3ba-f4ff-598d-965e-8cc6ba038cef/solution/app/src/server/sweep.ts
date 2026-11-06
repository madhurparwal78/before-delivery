// The sweep (Business rules "Sweep"): entitlement refresh, Publish warnings, lapse takedowns,
// object clean-up and outbox retries. Kill Bill catalog and seed subscriptions are retried here too.
import { billingView, deadlines, entitlement, type Entitlement } from "./billing.ts";
import { config } from "./config.ts";
import { exclusive, pool } from "./db.ts";
import { BillingUnavailable, createAccount, createSubscription, current, ensureCatalog, findAccount, subscriptions } from "./killbill.ts";
import { enqueue, flushOutbox, publishWarningEmail } from "./mail.ts";
import { clearPrefix, StorageUnavailable } from "./s3.ts";
import { settleExpiredLinks, takeDown, type DossierRow } from "./routes/dossiers.ts";
import type { AccountRow } from "./session.ts";
import type { AddonName, SweepResult } from "../shared/types.ts";

let bootstrapped = false;

/** Catalog upload and the seeded accounts' Kill Bill accounts and subscriptions, until both succeed.
 * Instances sharing the database take turns, so the catalog is uploaded once. */
export async function bootstrapKillBill(): Promise<void> {
  if (bootstrapped) return;
  try {
    await exclusive("cairn:killbill-bootstrap", bootstrapOnce, 30000);
  } catch (error) {
    if (!(error instanceof BillingUnavailable)) throw error;
    console.error("Kill Bill not ready; the sweep will retry:", error.message);
  }
}

async function bootstrapOnce(): Promise<void> {
  await ensureCatalog();
  const { rows } = await pool.query<AccountRow & { kb_seed_addons: AddonName[] }>(
    "SELECT id, email, display_name, time_zone, operator, kb_seed_addons FROM accounts WHERE cardinality(kb_seed_addons) > 0");
  for (const account of rows) {
    const kbId = await findAccount(account.id) ?? await createAccount(account);
    const subs = await subscriptions(kbId);
    for (const addon of account.kb_seed_addons) {
      if (!current(subs, addon)) await createSubscription(kbId, account.id, addon);
    }
    await pool.query("UPDATE accounts SET kb_account_id = $2, kb_seed_addons = '{}' WHERE id = $1", [account.id, kbId]);
  }
  bootstrapped = true;
}

const COLUMNS = "id, account_id, slug, root_note_id, state, radius, public_count, severed_count, published_at, live_publish_id";

async function sweepOnce(sweepId: number): Promise<SweepResult> {
  const result: SweepResult = { warnings_sent: 0, dossiers_taken_down: 0, objects_removed: 0 };
  await bootstrapKillBill();

  const accounts = await pool.query<AccountRow>(
    `SELECT DISTINCT a.id, a.email, a.display_name, a.time_zone, a.operator FROM accounts a
     JOIN entitlement_cache c ON c.account_id = a.id WHERE c.subscribed OR c.billing_end IS NOT NULL`);
  const now = new Date();
  const refreshed: (Entitlement | null)[] = [];
  for (let i = 0; i < accounts.rows.length; i += 16) {
    refreshed.push(...await Promise.all(accounts.rows.slice(i, i + 16).map(async (account) => {
      try {
        return await entitlement(account);
      } catch (error) {
        if (!(error instanceof BillingUnavailable)) throw error;
        return null;
      }
    })));
  }
  for (const [i, account] of accounts.rows.entries()) {
    const ent = refreshed[i];
    const end = ent?.facts.publish.billingEnd;
    if (!ent || !end || billingView(ent, account.time_zone).publish.state === "active") continue;
    const due = deadlines(end, account.time_zone);
    const live = await pool.query<DossierRow>(`SELECT ${COLUMNS} FROM dossiers WHERE account_id = $1 AND state = 'published'`, [account.id]);
    if (live.rows.length === 0) continue;
    const warned = await pool.query<{ sweep_id: string }>("SELECT sweep_id FROM publish_warnings WHERE account_id = $1 AND period_end = $2",
      [account.id, due.periodEnd]);
    if (now >= due.warningAt && warned.rows.length === 0) {
      const inserted = await pool.query(
        "INSERT INTO publish_warnings (account_id, period_end, sweep_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        [account.id, due.periodEnd, sweepId]);
      if (inserted.rowCount) {
        await enqueue(pool, publishWarningEmail(account.email, due.takedownAt, account.time_zone, live.rows.map((d) => d.slug)));
        result.warnings_sent += 1;
      }
      continue;
    }
    if (now >= due.takedownAt && warned.rows.length > 0 && Number(warned.rows[0].sweep_id) < sweepId) {
      for (const dossier of live.rows) {
        try {
          result.objects_removed += await takeDown(dossier, "takedown");
          result.dossiers_taken_down += 1;
        } catch (error) {
          if (!(error instanceof StorageUnavailable)) throw error;
        }
      }
    }
  }

  await settleExpiredLinks(pool, null);
  const ended = await pool.query<{ id: string; prefix: string; kind: "preview_links" | "publishes" }>(
    `SELECT id, 'preview/' || id || '/' AS prefix, 'preview_links' AS kind FROM preview_links WHERE state <> 'active' AND NOT objects_cleared
     UNION ALL
     SELECT p.id, p.prefix, 'publishes' AS kind FROM publishes p JOIN dossiers d ON d.id = p.dossier_id
     WHERE p.status IN ('failed', 'retired') AND NOT p.objects_cleared AND p.id IS DISTINCT FROM d.live_publish_id`);
  for (const row of ended.rows) {
    try {
      result.objects_removed += await clearPrefix(row.prefix);
      await pool.query(`UPDATE ${row.kind} SET objects_cleared = true WHERE id = $1`, [row.id]);
    } catch (error) {
      if (!(error instanceof StorageUnavailable)) throw error;
    }
  }

  await flushOutbox();
  return result;
}

/** One sweep across every instance at a time; waits up to `waitMs` for a running one, else null. */
export async function runSweep(waitMs = 0): Promise<SweepResult | null> {
  return exclusive("cairn:sweep", async () => {
    const { rows } = await pool.query<{ id: string }>("INSERT INTO sweeps DEFAULT VALUES RETURNING id");
    const sweepId = Number(rows[0].id);
    const result = await sweepOnce(sweepId);
    await pool.query("UPDATE sweeps SET finished_at = now() WHERE id = $1", [sweepId]);
    return result;
  }, waitMs);
}

export function startSweeps(): void {
  setInterval(() => {
    runSweep().catch((error: Error) => console.error("sweep failed:", error.message));
  }, config.timers.sweepInterval * 1000);
}
