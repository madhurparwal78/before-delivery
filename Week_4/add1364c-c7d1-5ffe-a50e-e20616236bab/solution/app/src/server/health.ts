import { db, write } from "./db.js";
import { now } from "./clock.js";
import { newId, open, sha1Upper } from "./crypto.js";
import { FeedUnreachable, breachedDomains, rangeSuffixes } from "./breach.js";
import { emitToDesk } from "./events.js";
import { ApiError, invalid } from "./http.js";
import type { CredentialRow, TurnRow, VendorRow } from "./model.js";
import { credentialViews, factsOf, healthOf, type Health } from "./credentials.js";
import { isRealDate, officeDate, officeStamp } from "./office-time.js";
import { rulesByVault } from "./rules.js";

interface CheckRow {
  id: string;
  at: Date;
  ok: boolean;
  office_day: string;
  counts: Record<string, number> | null;
  healths: Record<string, Health> | null;
}

const PARALLEL = 8;
let running: Promise<boolean> | null = null;

async function rangeFor(prefixes: string[]): Promise<Map<string, Set<string>>> {
  const found = new Map<string, Set<string>>();
  const queue = [...prefixes];
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, queue.length) }, async () => {
      for (let prefix = queue.shift(); prefix !== undefined; prefix = queue.shift()) {
        found.set(prefix, await rangeSuffixes(prefix));
      }
    }),
  );
  return found;
}

async function performCheck(): Promise<boolean> {
  const at = now();
  try {
    const logins = await db.query<CredentialRow & { domain: string }>(
      "SELECT c.*, v.domain FROM credentials c JOIN vendors v ON v.id = c.vendor_id ORDER BY c.ord",
    );
    const hashes = new Map<string, string>(logins.map((login) => [login.id, sha1Upper(open(login.secret_sealed))]));
    const ranges = await rangeFor([...new Set([...hashes.values()].map((hash) => hash.slice(0, 5)))]);
    const domains = await breachedDomains();
    const exposed = logins.filter((login) => {
      const hash = hashes.get(login.id) ?? "";
      return ranges.get(hash.slice(0, 5))?.has(hash.slice(5)) ?? false;
    });
    const rules = await rulesByVault(db);
    const context = { exposed: new Map(exposed.map((login) => [login.id, login.secret_rev])), domains: new Set(domains) };
    const healths: Record<string, Health> = {};
    let outOfPolicy = 0;
    let exposedCount = 0;
    let breachedCount = 0;
    for (const login of logins) {
      const facts = factsOf(login, rules.get(login.vault_id) ?? [], at);
      if (facts.outOfPolicy) outOfPolicy++;
      const health = healthOf(login, { domain: login.domain } as Pick<VendorRow, "domain">, facts.outOfPolicy, context);
      if (health === "exposed") exposedCount++;
      if (health === "vendor_breached") breachedCount++;
      if (health !== "sound") healths[login.id] = health;
    }
    const turns = await db.query<Pick<TurnRow, "state">>("SELECT state FROM turns WHERE state <> 'turned'");
    const counts = {
      exposed: exposedCount,
      vendor_breached: breachedCount,
      out_of_policy: outOfPolicy,
      turns_due: turns.filter((turn) => turn.state === "due").length,
      turns_overdue: turns.filter((turn) => turn.state === "overdue").length,
    };
    await store(at, true, counts, healths, exposed.map((login) => ({ id: login.id, rev: login.secret_rev })), domains);
    return true;
  } catch (error) {
    if (!(error instanceof FeedUnreachable)) throw error;
    await store(at, false, null, null, null, null);
    return false;
  }
}

async function store(
  at: Date,
  ok: boolean,
  counts: Record<string, number> | null,
  healths: Record<string, Health> | null,
  exposed: Array<{ id: string; rev: number }> | null,
  domains: string[] | null,
): Promise<void> {
  await write(async (tx) => {
    const day = officeDate(at);
    await tx.query(
      "INSERT INTO breach_checks (id, at, ok, office_day, counts, healths, exposed, domains) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [newId(), at, ok, day, JSON.stringify(counts), JSON.stringify(healths), JSON.stringify(exposed), JSON.stringify(domains)],
    );
    if (ok) await tx.query("DELETE FROM breach_checks WHERE ok AND office_day = $1 AND at < $2", [day, at]);
    else await tx.query("DELETE FROM breach_checks WHERE NOT ok AND at < $1", [at]);
    tx.after(() => emitToDesk("check-finished", { feed: ok ? "ok" : "unreachable" }));
  });
}

/** Checks never overlap: a request while one runs waits for that run and shares its result. */
export function runCheck(): Promise<boolean> {
  if (!running) {
    running = performCheck().finally(() => {
      running = null;
    });
  }
  return running;
}

export async function report(day: string | null): Promise<Record<string, unknown>> {
  const at = now();
  const today = officeDate(at);
  const chosen = day ?? today;
  if (!isRealDate(chosen) || chosen > today) throw invalid({ day: "Pick today or an earlier office day." });
  const snapshot = await db.one<CheckRow>(
    chosen === today
      ? "SELECT * FROM breach_checks WHERE ok ORDER BY at DESC LIMIT 1"
      : "SELECT * FROM breach_checks WHERE ok AND office_day = $1 ORDER BY at DESC LIMIT 1",
    chosen === today ? [] : [chosen],
  );
  const latest = await db.one<CheckRow>("SELECT * FROM breach_checks ORDER BY at DESC LIMIT 1");
  const healths = snapshot?.healths ?? {};
  const ids = Object.keys(healths);
  const rows = ids.length > 0 ? await db.query<CredentialRow>("SELECT c.* FROM credentials c JOIN vaults v ON v.id = c.vault_id WHERE c.id = ANY($1) ORDER BY v.ord, c.ord", [ids]) : [];
  const views = await credentialViews(db, rows, at);
  return {
    office_date: chosen,
    feed: latest && !latest.ok ? "unreachable" : "ok",
    last_good_check_at: snapshot ? snapshot.at.toISOString() : null,
    counts: snapshot?.counts ?? { exposed: 0, vendor_breached: 0, out_of_policy: 0, turns_due: 0, turns_overdue: 0 },
    credentials: views.map((view) => ({ ...view, health: healths[String(view.id)] ?? view.health })),
  };
}

export async function manualCheck(): Promise<Record<string, unknown>> {
  if (await runCheck()) return report(null);
  const good = await db.one<CheckRow>("SELECT * FROM breach_checks WHERE ok ORDER BY at DESC LIMIT 1");
  throw new ApiError(
    503,
    "breach_feed_unreachable",
    good
      ? `The breach feed can't be reached. Showing the last good check from ${officeStamp(good.at)}.`
      : "The breach feed can't be reached. No check has succeeded yet.",
  );
}
