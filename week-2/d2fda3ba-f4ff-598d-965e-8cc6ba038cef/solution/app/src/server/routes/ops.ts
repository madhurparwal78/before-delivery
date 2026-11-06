// The founder-operator console API (API: "Operator").
import { billingView, entitlement, NO_FACTS, type Entitlement } from "../billing.ts";
import { pool } from "../db.ts";
import { ApiError, route, sendJson, type Ctx } from "../http.ts";
import { BillingUnavailable } from "../killbill.ts";
import { accountJson, requireSession, type AccountRow, type Session } from "../session.ts";
import { runSweep } from "../sweep.ts";
import { isoSeconds } from "../../shared/time.ts";
import type { OpsAccountRow } from "../../shared/types.ts";

/** A manual run waits this long for a scheduled sweep that is already running. */
const SWEEP_WAIT_MS = 20000;

function requireOperator(session: Session): void {
  if (!session.account.operator) throw new ApiError(403, "not_operator", "The console is for the operator account.");
}

/** Live from Kill Bill, else the cache; with neither, the account was never billed. */
async function rowEntitlement(account: AccountRow): Promise<Entitlement> {
  try {
    return await entitlement(account);
  } catch (error) {
    if (!(error instanceof BillingUnavailable)) throw error;
    return { facts: NO_FACTS, checkedAt: new Date(), source: "cache" };
  }
}

route("GET", "/api/ops/accounts", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  requireOperator(session);
  const accounts = await pool.query<AccountRow & { vault_count: string; blob_count: string; stored_bytes: string }>(
    `SELECT a.id, a.email, a.display_name, a.time_zone, a.operator,
       (SELECT count(*) FROM vaults v WHERE v.owner_id = a.id) AS vault_count,
       (SELECT count(*) FROM revisions r JOIN vaults v ON v.id = r.vault_id WHERE v.owner_id = a.id) AS blob_count,
       (SELECT coalesce(sum(r.byte_length), 0) FROM revisions r JOIN vaults v ON v.id = r.vault_id WHERE v.owner_id = a.id) AS stored_bytes
     FROM accounts a ORDER BY a.created_at, a.id`);
  const live = await pool.query<{ account_id: string; slug: string; published_at: Date }>(
    "SELECT account_id, slug, published_at FROM dossiers WHERE state = 'published' AND live_publish_id IS NOT NULL ORDER BY published_at");
  const entitlements: Entitlement[] = [];
  for (let i = 0; i < accounts.rows.length; i += 16) {
    entitlements.push(...await Promise.all(accounts.rows.slice(i, i + 16).map(rowEntitlement)));
  }
  const rows: OpsAccountRow[] = accounts.rows.map((a, i) => ({
    account: accountJson(a),
    ...billingView(entitlements[i], a.time_zone),
    vault_count: Number(a.vault_count),
    blob_count: Number(a.blob_count),
    stored_bytes: Number(a.stored_bytes),
    live_dossiers: live.rows.filter((d) => d.account_id === a.id).map((d) => ({ slug: d.slug, published_at: isoSeconds(d.published_at) })),
  }));
  const source = entitlements.every((e) => e.source === "killbill") ? "killbill" : "cache";
  sendJson(ctx.res, 200, { source, accounts: rows });
});

route("POST", "/api/ops/sweep", async (ctx: Ctx) => {
  const session = await requireSession(ctx);
  requireOperator(session);
  const result = await runSweep(SWEEP_WAIT_MS);
  if (!result) throw new ApiError(409, "sweep_running", "A lapse check is already running.");
  sendJson(ctx.res, 200, result);
});
