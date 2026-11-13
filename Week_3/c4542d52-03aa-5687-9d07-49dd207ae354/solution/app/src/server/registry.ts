import type { CapTable, CapTableRow, Person, Pool, ShareClass, Valuation } from "../shared/types.js";
import { formatPrice, formatScaled } from "./decimal.js";
import type { Queryable } from "./db.js";
import { largestRemainder } from "./ownership.js";
import { pacificDate, now } from "./time.js";

export const SHARE_CLASSES: ShareClass[] = ["Common", "Series Seed Preferred", "Series A Preferred"];
const POOL_LABEL = "Unallocated option pool";

export type RegisterTotals = {
  holders: Map<string, { name: string; issued: number; options: number }>;
  classTotals: Map<ShareClass, number>;
  authorized: number;
  outstanding: number;
  exercised: number;
  reserved: number;
  issuedTotal: number;
  unallocated: number;
  fullyDiluted: number;
};

/** The register's totals: shares from the ledger, options from accepted grants, the pool from its setting. */
export async function loadRegisterTotals(db: Queryable): Promise<RegisterTotals> {
  const shares = await db.query<{ holder_id: string; name: string; class: ShareClass; shares: number }>(
    `SELECT l.holder_id, p.name, l.class, sum(l.shares_delta)::bigint AS shares
       FROM ledger l JOIN people p ON p.id = l.holder_id
      WHERE l.holder_id IS NOT NULL AND l.class IS NOT NULL GROUP BY l.holder_id, p.name, l.class`,
  );
  const options = await db.query<{ holder_id: string; name: string; options: number; exercised: number }>(
    `SELECT g.holder_id, p.name,
            sum(g.options - g.exercised - g.cancelled - g.forfeited)::bigint AS options, sum(g.exercised)::bigint AS exercised
       FROM grants g JOIN people p ON p.id = g.holder_id WHERE g.state = 'accepted' GROUP BY g.holder_id, p.name`,
  );
  const pool = await db.query<{ value: number }>("SELECT value::text::bigint AS value FROM settings WHERE key = 'authorized'");
  const reserved = await db.query<{ reserved: number }>(
    "SELECT coalesce(sum(options), 0)::bigint AS reserved FROM grants WHERE state IN ('board_queue', 'approved', 'offered')",
  );
  const holders = new Map<string, { name: string; issued: number; options: number }>();
  const classTotals = new Map<ShareClass, number>(SHARE_CLASSES.map((name) => [name, 0]));
  for (const row of shares) {
    const holder = holders.get(row.holder_id) ?? { name: row.name, issued: 0, options: 0 };
    holder.issued += row.shares;
    holders.set(row.holder_id, holder);
    classTotals.set(row.class, (classTotals.get(row.class) ?? 0) + row.shares);
  }
  let outstanding = 0;
  let exercised = 0;
  for (const row of options) {
    const holder = holders.get(row.holder_id) ?? { name: row.name, issued: 0, options: 0 };
    holder.options += row.options;
    holders.set(row.holder_id, holder);
    outstanding += row.options;
    exercised += row.exercised;
  }
  const authorized = pool[0]?.value ?? 0;
  const issuedTotal = [...holders.values()].reduce((sum, holder) => sum + holder.issued, 0);
  const unallocated = authorized - outstanding - exercised;
  return {
    holders,
    classTotals,
    authorized,
    outstanding,
    exercised,
    reserved: reserved[0]?.reserved ?? 0,
    issuedTotal,
    unallocated,
    fullyDiluted: issuedTotal + outstanding + unallocated,
  };
}

export function presentPool(totals: RegisterTotals): Pool {
  return {
    authorized: totals.authorized,
    outstanding: totals.outstanding,
    exercised: totals.exercised,
    reserved: totals.reserved,
    available: totals.authorized - totals.outstanding - totals.exercised - totals.reserved,
    unallocated: totals.unallocated,
  };
}

function byWeight(a: { label: string; fully_diluted: number }, b: { label: string; fully_diluted: number }): number {
  return b.fully_diluted - a.fully_diluted || (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
}

function withOwnership(rows: Omit<CapTableRow, "ownership">[]): CapTableRow[] {
  const ownership = largestRemainder(rows.map((row) => row.fully_diluted));
  return rows.map((row, index) => ({ ...row, ownership: ownership[index] ?? "0.00" }));
}

function orderedWithPoolLast(rows: Omit<CapTableRow, "ownership">[]): Omit<CapTableRow, "ownership">[] {
  const pool = rows.filter((row) => row.key === "pool");
  return [...rows.filter((row) => row.key !== "pool").sort(byWeight), ...pool];
}

function founderRows(totals: RegisterTotals): CapTableRow[] {
  const holders = [...totals.holders.entries()]
    .map(([key, holder]) => ({
      key,
      label: holder.name,
      issued_shares: holder.issued,
      options_outstanding: holder.options,
      fully_diluted: holder.issued + holder.options,
    }))
    .filter((row) => row.fully_diluted > 0);
  const pool = { key: "pool", label: POOL_LABEL, issued_shares: 0, options_outstanding: 0, fully_diluted: totals.unallocated };
  return withOwnership(orderedWithPoolLast([...holders, pool]));
}

function boardRows(totals: RegisterTotals): CapTableRow[] {
  const classRow = (key: string, label: ShareClass) => {
    const shares = totals.classTotals.get(label) ?? 0;
    return { key, label, issued_shares: shares, options_outstanding: 0, fully_diluted: shares };
  };
  return withOwnership(
    orderedWithPoolLast([
      classRow("common", "Common"),
      classRow("series_seed", "Series Seed Preferred"),
      classRow("series_a", "Series A Preferred"),
      { key: "options_outstanding", label: "Options outstanding", issued_shares: 0, options_outstanding: totals.outstanding, fully_diluted: totals.outstanding },
      { key: "pool", label: POOL_LABEL, issued_shares: 0, options_outstanding: 0, fully_diluted: totals.unallocated },
    ]),
  );
}

function ownSliceRows(totals: RegisterTotals, person: Person): CapTableRow[] {
  const full = founderRows(totals).find((row) => row.key === person.id);
  const own = totals.holders.get(person.id);
  const ownRow: CapTableRow = {
    key: person.id,
    label: person.name,
    issued_shares: own?.issued ?? 0,
    options_outstanding: own?.options ?? 0,
    fully_diluted: (own?.issued ?? 0) + (own?.options ?? 0),
    ownership: full?.ownership ?? "0.00",
  };
  const ownHundredths = BigInt(ownRow.ownership.replace(".", ""));
  return [
    ownRow,
    {
      key: "others",
      label: "All other holders",
      issued_shares: totals.issuedTotal - ownRow.issued_shares,
      options_outstanding: totals.outstanding - ownRow.options_outstanding,
      fully_diluted: totals.fullyDiluted - ownRow.fully_diluted,
      ownership: formatScaled(10000n - ownHundredths, 2),
    },
  ];
}

export function presentCapTable(totals: RegisterTotals, person: Person): CapTable {
  const rows =
    person.role === "founder_admin" ? founderRows(totals) : person.role === "board_member" ? boardRows(totals) : ownSliceRows(totals, person);
  return { fully_diluted_total: totals.fullyDiluted, rows, total_ownership: "100.00" };
}

export function ownershipOf(totals: RegisterTotals, personId: string): string {
  return founderRows(totals).find((row) => row.key === personId)?.ownership ?? "0.00";
}

type ValuationRow = { id: string; effective_on: string; expires_on: string; fmv_units: string; firm: string };

type Valuations = { all: Valuation[]; current: Valuation | null };

/** The valuations with their status on the server date; the current one is the latest in effect, recorded last on a tie. */
export async function loadValuations(db: Queryable): Promise<Valuations> {
  const today = pacificDate(now());
  const rows = await db.query<ValuationRow>(
    "SELECT id, effective_on, expires_on, fmv_units::text AS fmv_units, firm FROM valuations ORDER BY effective_on DESC, recorded DESC",
  );
  const currentId = rows.find((row) => row.effective_on <= today)?.id ?? null;
  const all = rows.map<Valuation>((row) => ({
    id: row.id,
    effective_on: row.effective_on,
    expires_on: row.expires_on,
    fmv_per_share: formatPrice(BigInt(row.fmv_units)),
    firm: row.firm,
    status: row.id !== currentId ? "superseded" : row.expires_on >= today ? "current" : "lapsed",
  }));
  return { all, current: all.find((valuation) => valuation.id === currentId) ?? null };
}
