/** Start-up and supervision: apply the schema and seed, keep the realm's users in step, retry the store, and report health. */
import { databaseState, isConnectionError, pool, rows, run } from "./db.js";
import { applySchemaAndSeed } from "./seed.js";
import { ACCOUNTS } from "./seed-data.js";
import { ensureRealmRoles, findUser, identityState, probeIdentity, provisionUser } from "./identity.js";
import { retryPendingStore } from "./sheets.js";
import { ensureBucket } from "./s3.js";
import type { AccountRow } from "./accounts.js";

const IDENTITY_LOCK = 7_314_002;
const TICK_MS = 1000;
const DATABASE_PROBE_MS = 3000;
const STORE_RETRY_MS = 4000;
const IDENTITY_CHECK_MS = 15000;

const lifecycle = { identityReady: false };

function log(message: string, error?: unknown): void {
  const detail = error instanceof Error ? ` ${error.message}` : "";
  process.stderr.write(`[boltrope] ${message}${detail}\n`);
}

/** A database that misses two probes in a row is treated as down; one slow answer on a busy host is not an outage. */
let missedProbes = 0;

async function probeDatabase(): Promise<boolean> {
  try {
    await Promise.race([pool.query("SELECT 1"), new Promise((_, reject) => setTimeout(() => reject(new Error("probe timeout")), 3000))]);
    missedProbes = 0;
    return true;
  } catch {
    missedProbes += 1;
    if (missedProbes >= 2) databaseState.ready = false;
    return false;
  }
}

async function initialiseDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await applySchemaAndSeed(client);
    databaseState.ready = true;
  } finally {
    client.release();
  }
}

/** Every stored, non-deleted seeded account exists as a realm user with its role; missing users are re-created. */
async function syncIdentity(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [IDENTITY_LOCK]);
    await ensureRealmRoles();
    const stored = await rows<AccountRow>(client, "SELECT * FROM account WHERE seeded AND NOT deleted ORDER BY num");
    for (const account of stored) {
      const seeded = ACCOUNTS.find((candidate) => candidate.email === account.email);
      if (!seeded) continue;
      const existing = await findUser(account.email);
      if (existing && existing.id === account.keycloak_id) continue;
      const user = await provisionUser(account.email, account.display_name, seeded.password, account.role);
      await run(client, "UPDATE account SET keycloak_id = $2 WHERE id = $1", [account.id, user.id]);
    }
    lifecycle.identityReady = true;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [IDENTITY_LOCK]).catch(() => undefined);
    client.release();
  }
}

export function superviseForever(): void {
  let initialising = false;
  let syncing = false;
  let retrying = false;
  let lastProbe = 0;
  let lastStoreRetry = 0;
  let lastIdentityCheck = 0;
  setInterval(() => {
    const at = Date.now();
    if (!databaseState.ready && !initialising) {
      initialising = true;
      initialiseDatabase()
        .catch((error) => log(isConnectionError(error) ? "database is not answering" : "database set-up failed:", isConnectionError(error) ? undefined : error))
        .finally(() => (initialising = false));
    }
    if (databaseState.ready && at - lastProbe >= DATABASE_PROBE_MS) {
      lastProbe = at;
      void probeDatabase();
    }
    const checkDue = at - lastIdentityCheck >= IDENTITY_CHECK_MS;
    if (databaseState.ready && (!lifecycle.identityReady || checkDue) && !syncing) {
      syncing = true;
      lastIdentityCheck = at;
      syncIdentity()
        .catch(async (error) => {
          log(`identity sync failed (${identityState.lastFailure}):`, error);
          if (!lifecycle.identityReady || !(await probeIdentity())) lifecycle.identityReady = false;
        })
        .finally(() => (syncing = false));
    }
    if (databaseState.ready && at - lastStoreRetry >= STORE_RETRY_MS && !retrying) {
      retrying = true;
      lastStoreRetry = at;
      ensureBucket()
        .catch(() => undefined)
        .then(() => retryPendingStore())
        .catch((error) => log("store retry failed:", error))
        .finally(() => (retrying = false));
    }
    if (!identityState.reachable && databaseState.ready) void probeIdentity();
  }, TICK_MS);
}

/** Which dependency is keeping the loft from answering, judged the same way for health and for every other address. */
export async function outage(): Promise<"database" | "identity" | null> {
  const [databaseUp, identityUp] = await Promise.all([probeDatabase(), probeIdentity()]);
  if (!databaseUp) return "database";
  if (!identityUp) return "identity";
  if (!databaseState.ready) return "database";
  if (!lifecycle.identityReady) return "identity";
  return null;
}

export async function health(): Promise<{ status: number; body: Record<string, string> }> {
  const dependency = await outage();
  return dependency ? { status: 503, body: { status: "unavailable", dependency } } : { status: 200, body: { status: "ok" } };
}
