import { now } from '../clock.js';
import { query } from '../db.js';
import { sendTo } from '../events.js';
import { officeDate, type OfficeDate } from '../officeTime.js';
import { newId, openSecret, secretHash } from '../secretStore.js';
import { FeedUnreachable, breachedDomains, exposedSuffixes } from '../services/breachFeed.js';
import type { CredentialRow, Health, VendorRow } from '../types.js';
import { loadCredentials, loadVendors, policyStand } from './credentials.js';
import { deskStaffIds } from './people.js';
import { loadRules, resolveRuleInForce, rulesOfVault } from './rules.js';

export type CheckCounts = {
  exposed: number;
  vendor_breached: number;
  out_of_policy: number;
  turns_due: number;
  turns_overdue: number;
};

export type CheckOutcome = { ok: boolean; at: Date; feed: 'ok' | 'unreachable' };

let running: Promise<CheckOutcome> | null = null;

/** Checks never overlap: a check asked for while one runs answers with that run's result. */
export function runBreachCheck(): Promise<CheckOutcome> {
  if (running !== null) return running;
  running = performCheck().finally(() => {
    running = null;
  });
  return running;
}

async function performCheck(): Promise<CheckOutcome> {
  const at = now();
  const credentials = await loadCredentials(null);
  const vendors = await loadVendors();
  const rules = await loadRules();
  try {
    const hashes = new Map<string, { prefix: string; suffix: string }>();
    for (const credential of credentials) {
      hashes.set(credential.id, secretHash(openSecret(credential.secret_cipher)));
    }
    const answers = new Map<string, Set<string>>();
    for (const prefix of new Set([...hashes.values()].map((hash) => hash.prefix))) {
      answers.set(prefix, await exposedSuffixes(prefix));
    }
    const breached = await breachedDomains();
    const health = new Map<string, { exposed: boolean; vendorBreached: boolean; health: Health }>();
    const counts: CheckCounts = {
      exposed: 0,
      vendor_breached: 0,
      out_of_policy: 0,
      turns_due: 0,
      turns_overdue: 0,
    };
    for (const credential of credentials) {
      const hash = hashes.get(credential.id) as { prefix: string; suffix: string };
      const exposed = (answers.get(hash.prefix) ?? new Set<string>()).has(hash.suffix);
      const vendorBreached = isVendorBreached(credential, vendors, breached);
      const stand = policyStand(credential, resolveRuleInForce(rulesOfVault(rules, credential.vault_id), officeDate(at)));
      const value: Health = exposed
        ? 'exposed'
        : vendorBreached
          ? 'vendor_breached'
          : stand.outOfPolicy
            ? 'out_of_policy'
            : 'sound';
      health.set(credential.id, { exposed, vendorBreached, health: value });
      if (exposed) counts.exposed += 1;
      if (vendorBreached) counts.vendor_breached += 1;
      if (stand.outOfPolicy) counts.out_of_policy += 1;
    }
    const turnRows = await query<{ state: string; total: string }>(
      "select state, count(*) as total from turns where state in ('due','overdue') group by state",
    );
    for (const row of turnRows) {
      if (row.state === 'due') counts.turns_due = Number(row.total);
      if (row.state === 'overdue') counts.turns_overdue = Number(row.total);
    }
    const checkId = newId();
    await query('insert into breach_checks (id, at, office_day, ok, counts) values ($1,$2,$3,true,$4)', [
      checkId,
      at,
      officeDate(at),
      JSON.stringify(counts),
    ]);
    for (const [credentialId, value] of health) {
      await query(
        `insert into breach_check_health (check_id, credential_id, exposed, vendor_breached, health)
         values ($1,$2,$3,$4,$5)`,
        [checkId, credentialId, value.exposed, value.vendorBreached, value.health],
      );
    }
    sendTo(await deskStaffIds(), { name: 'check-finished', data: { feed: 'ok' } });
    return { ok: true, at, feed: 'ok' };
  } catch (error) {
    if (!(error instanceof FeedUnreachable)) throw error;
    await query('insert into breach_checks (id, at, office_day, ok, counts) values ($1,$2,$3,false,null)', [
      newId(),
      at,
      officeDate(at),
    ]);
    sendTo(await deskStaffIds(), { name: 'check-finished', data: { feed: 'unreachable' } });
    return { ok: false, at, feed: 'unreachable' };
  }
}

function isVendorBreached(
  credential: CredentialRow,
  vendors: readonly VendorRow[],
  breached: ReadonlySet<string>,
): boolean {
  const vendor = vendors.find((entry) => entry.id === credential.vendor_id);
  return vendor !== undefined && breached.has(vendor.domain.toLowerCase());
}

export async function feedState(): Promise<'ok' | 'unreachable'> {
  const rows = await query<{ ok: boolean }>('select ok from breach_checks order by at desc limit 1');
  const latest = rows[0];
  return latest === undefined || latest.ok ? 'ok' : 'unreachable';
}

export type Snapshot = {
  checkId: string;
  at: Date;
  counts: CheckCounts;
  health: Map<string, { exposed: boolean; vendor_breached: boolean; health: Health }>;
};

export async function snapshotFor(day: OfficeDate, isToday: boolean): Promise<Snapshot | null> {
  const rows = isToday
    ? await query<{ id: string; at: Date; counts: CheckCounts }>(
        'select id, at, counts from breach_checks where ok = true order by at desc limit 1',
      )
    : await query<{ id: string; at: Date; counts: CheckCounts }>(
        'select id, at, counts from breach_checks where ok = true and office_day = $1 order by at desc limit 1',
        [day],
      );
  const latest = rows[0];
  if (latest === undefined) return null;
  const healthRows = await query<{ credential_id: string; exposed: boolean; vendor_breached: boolean; health: Health }>(
    'select credential_id, exposed, vendor_breached, health from breach_check_health where check_id = $1',
    [latest.id],
  );
  return {
    checkId: latest.id,
    at: latest.at,
    counts: latest.counts,
    health: new Map(healthRows.map((row) => [row.credential_id, row])),
  };
}

export const emptyCounts: CheckCounts = {
  exposed: 0,
  vendor_breached: 0,
  out_of_policy: 0,
  turns_due: 0,
  turns_overdue: 0,
};
