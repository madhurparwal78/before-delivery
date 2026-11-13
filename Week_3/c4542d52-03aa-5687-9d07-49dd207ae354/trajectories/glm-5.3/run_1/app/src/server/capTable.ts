import type { PoolClient } from 'pg';
import { holdingsByHolder, optionsOutstandingByHolder, poolFigures } from './register.js';

export interface CapRow {
  key: string;
  label: string;
  issued_shares: number;
  options_outstanding: number;
  fully_diluted: number;
  ownership: string;
}

export interface CapTable {
  fully_diluted_total: number;
  rows: CapRow[];
  total_ownership: string;
}

/**
 * Largest-remainder ownership at two decimals, in exact integer arithmetic:
 * 1. cut each row's exact percentage down to two decimals;
 * 2. the missing hundredths go one each to the rows with the largest cut-off remainders;
 * 3. ties go to the row with more fully diluted shares, then the earlier row.
 */
export function largestRemainder(shares: number[], total: number): string[] {
  const bigShares = shares.map((s) => BigInt(s));
  const bigTotal = BigInt(total);
  const n = bigShares.map((s) => (s * 10_000n) / bigTotal); // hundredths, floored
  const rem = bigShares.map((s) => (s * 10_000n) % bigTotal); // exact cut-off remainders
  let missing = 10_000n - n.reduce((a, b) => a + b, 0n);
  const order = n.map((_, i) => i).sort((a, b) => {
    if (rem[a]! !== rem[b]!) return Number(rem[b]! - rem[a]!);
    if (bigShares[a]! !== bigShares[b]!) return Number(bigShares[b]! - bigShares[a]!);
    return a - b;
  });
  let k = 0;
  while (missing > 0n && k < order.length) {
    n[order[k]!]! += 1n;
    missing -= 1n;
    k += 1;
  }
  while (missing < 0n && k > 0) {
    k -= 1;
    n[order[k]!]! -= 1n;
    missing += 1n;
  }
  return n.map((h) => `${h / 100n}.${(h % 100n).toString().padStart(2, '0')}`);
}

/** The founder admin's rows: one per holder with fully diluted shares above 0, plus the pool row. */
export async function adminCapTable(client: PoolClient): Promise<CapTable> {
  const holdings = await holdingsByHolder(client);
  const options = await optionsOutstandingByHolder(client);
  const pool = await poolFigures(client);
  const people = await client.query<{ id: string; name: string }>(
    'SELECT id, name FROM people ORDER BY id',
  );
  const rows: CapRow[] = [];
  for (const p of people.rows) {
    const issued = holdings.get(p.id) ?? 0;
    const opts = options.get(p.id) ?? 0;
    const fd = issued + opts;
    if (fd <= 0) continue;
    rows.push({ key: p.id, label: p.name, issued_shares: issued, options_outstanding: opts, fully_diluted: fd, ownership: '' });
  }
  const unallocated = pool.unallocated;
  if (unallocated > 0) {
    rows.push({
      key: 'pool', label: 'Unallocated option pool',
      issued_shares: 0, options_outstanding: 0, fully_diluted: unallocated, ownership: '',
    });
  }
  const total = rows.reduce((a, r) => a + r.fully_diluted, 0);
  const ownership = largestRemainder(rows.map((r) => r.fully_diluted), total);
  rows.forEach((r, i) => (r.ownership = ownership[i]!));
  rows.sort((a, b) => b.fully_diluted - a.fully_diluted || a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
  return { fully_diluted_total: total, rows, total_ownership: '100.00' };
}

/** A holder's own view: their row plus "All other holders". */
export async function holderCapTable(client: PoolClient, personId: string): Promise<CapTable> {
  const admin = await adminCapTable(client);
  const mineRow = admin.rows.find((r) => r.key === personId);
  const myOwnership = mineRow?.ownership ?? '0.00';
  const myFd = mineRow?.fully_diluted ?? 0;
  const others = new Map<string, CapRow>();
  for (const r of admin.rows) {
    if (r.key === personId || r.key === 'pool') continue;
    const agg = others.get(r.key) ?? { key: 'others', label: 'All other holders', issued_shares: 0, options_outstanding: 0, fully_diluted: 0, ownership: '0.00' };
    agg.issued_shares += r.issued_shares;
    agg.options_outstanding += r.options_outstanding;
    agg.fully_diluted += r.fully_diluted;
    others.set(r.key, agg);
  }
  const rows: CapRow[] = [];
  if (mineRow) {
    rows.push({
      key: personId, label: mineRow.label,
      issued_shares: mineRow.issued_shares, options_outstanding: mineRow.options_outstanding,
      fully_diluted: myFd, ownership: myOwnership,
    });
  }
  let othersFd = 0;
  let othersIssued = 0;
  let othersOpts = 0;
  for (const o of others.values()) {
    othersFd += o.fully_diluted;
    othersIssued += o.issued_shares;
    othersOpts += o.options_outstanding;
  }
  const poolRow = admin.rows.find((r) => r.key === 'pool');
  if (poolRow) {
    othersFd += poolRow.fully_diluted;
    othersIssued += poolRow.issued_shares;
    othersOpts += poolRow.options_outstanding;
  }
  const othersOwnership = subHundred(myOwnership);
  if (othersFd > 0) {
    rows.push({
      key: 'others', label: 'All other holders',
      issued_shares: othersIssued, options_outstanding: othersOpts,
      fully_diluted: othersFd, ownership: othersOwnership,
    });
  }
  return { fully_diluted_total: admin.fully_diluted_total, rows, total_ownership: '100.00' };
}

function subHundred(pct: string): string {
  const [whole, frac] = pct.split('.');
  const h = Number(whole) * 100 + Number(frac);
  const rest = 10_000 - h;
  return `${Math.floor(rest / 100)}.${String(rest % 100).padStart(2, '0')}`;
}

/** A board member's view: class summary rows with largest remainder across them. */
export async function boardCapTable(client: PoolClient): Promise<CapTable> {
  const classes = await client.query<{ class: string; total: string }>(
    'SELECT class, coalesce(sum(shares),0)::text AS total FROM share_holdings GROUP BY class',
  );
  const pool = await poolFigures(client);
  const rows: CapRow[] = [];
  const classMap = new Map(classes.rows.map((c) => [c.class, Number(c.total)]));
  const defs: Array<[string, string]> = [
    ['common', 'Common'],
    ['series_seed', 'Series Seed Preferred'],
    ['series_a', 'Series A Preferred'],
  ];
  for (const [key, label] of defs) {
    const shares = classMap.get(key === 'common' ? 'Common' : key === 'series_seed' ? 'Series Seed Preferred' : 'Series A Preferred') ?? 0;
    rows.push({ key, label, issued_shares: shares, options_outstanding: 0, fully_diluted: shares, ownership: '' });
  }
  rows.push({
    key: 'options_outstanding', label: 'Options outstanding',
    issued_shares: 0, options_outstanding: pool.outstanding, fully_diluted: pool.outstanding, ownership: '',
  });
  rows.push({
    key: 'pool', label: 'Unallocated option pool',
    issued_shares: 0, options_outstanding: 0, fully_diluted: pool.unallocated, ownership: '',
  });
  const total = rows.reduce((a, r) => a + r.fully_diluted, 0);
  const ownership = largestRemainder(rows.map((r) => r.fully_diluted), total);
  rows.forEach((r, i) => (r.ownership = ownership[i]!));
  return { fully_diluted_total: total, rows, total_ownership: '100.00' };
}
