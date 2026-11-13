import type { CapTable, CapTableRow, Pool, Role } from "../../shared/types.js";
import type { Transaction } from "../db.js";
import { formatPercent } from "../domain/money.js";
import { largestRemainder } from "../domain/ownership.js";

export interface HolderTotals {
  personId: string;
  name: string;
  issuedShares: number;
  optionsOutstanding: number;
  byClass: Map<string, number>;
}

export interface RegisterTotals {
  fullyDilutedTotal: number;
  pool: Pool;
  holders: Map<string, HolderTotals>;
  classTotals: Map<string, number>;
}

interface HoldingRow {
  person_id: string;
  share_class: string;
  shares: number;
}

interface GrantTotalsRow {
  holder_id: string;
  outstanding: number;
  exercised: number;
}

export async function loadRegisterTotals(tx: Transaction): Promise<RegisterTotals> {
  const holdingRows = await tx.query<HoldingRow>("select person_id, share_class, shares from holdings where shares > 0");
  const grantRows = await tx.query<GrantTotalsRow>(
    `select holder_id,
            coalesce(sum(options - exercised - cancelled - forfeited), 0)::int as outstanding,
            coalesce(sum(exercised), 0)::int as exercised
       from grants
      where state = 'accepted'
      group by holder_id`,
  );
  const reservedRow = await tx.queryOne<{ reserved: number }>(
    `select coalesce(sum(options), 0)::int as reserved
       from grants
      where state in ('board_queue', 'approved', 'offered')`,
  );
  const poolRow = await tx.queryOne<{ authorized: number }>("select authorized from option_pool where id = 1");
  const peopleRows = await tx.query<{ id: string; name: string }>("select id, name from people");

  const names = new Map(peopleRows.map((row) => [row.id, row.name]));
  const holders = new Map<string, HolderTotals>();
  const classTotals = new Map<string, number>();

  const ensure = (personId: string): HolderTotals => {
    const existing = holders.get(personId);
    if (existing !== undefined) return existing;
    const created: HolderTotals = {
      personId,
      name: names.get(personId) ?? personId,
      issuedShares: 0,
      optionsOutstanding: 0,
      byClass: new Map<string, number>(),
    };
    holders.set(personId, created);
    return created;
  };

  for (const row of holdingRows) {
    const holder = ensure(row.person_id);
    holder.issuedShares += row.shares;
    holder.byClass.set(row.share_class, (holder.byClass.get(row.share_class) ?? 0) + row.shares);
    classTotals.set(row.share_class, (classTotals.get(row.share_class) ?? 0) + row.shares);
  }

  let outstanding = 0;
  let exercised = 0;
  for (const row of grantRows) {
    const holder = ensure(row.holder_id);
    holder.optionsOutstanding += row.outstanding;
    outstanding += row.outstanding;
    exercised += row.exercised;
  }

  const authorized = poolRow === null ? 0 : poolRow.authorized;
  const reserved = reservedRow === null ? 0 : reservedRow.reserved;
  const unallocated = authorized - outstanding - exercised;
  const issuedTotal = [...classTotals.values()].reduce((sum, value) => sum + value, 0);

  return {
    fullyDilutedTotal: issuedTotal + outstanding + unallocated,
    pool: {
      authorized,
      outstanding,
      exercised,
      reserved,
      available: authorized - outstanding - exercised - reserved,
      unallocated,
    },
    holders,
    classTotals,
  };
}

const CLASS_ROWS: ReadonlyArray<[string, string]> = [
  ["common", "Common"],
  ["series_seed", "Series Seed Preferred"],
  ["series_a", "Series A Preferred"],
];

interface Draft {
  key: string;
  label: string;
  issuedShares: number;
  optionsOutstanding: number;
}

function toRows(drafts: readonly Draft[]): CapTableRow[] {
  const ownership = largestRemainder(
    drafts.map((draft) => ({
      key: draft.key,
      label: draft.label,
      fullyDiluted: draft.issuedShares + draft.optionsOutstanding,
    })),
  );
  return drafts.map((draft) => ({
    key: draft.key,
    label: draft.label,
    issued_shares: draft.issuedShares,
    options_outstanding: draft.optionsOutstanding,
    fully_diluted: draft.issuedShares + draft.optionsOutstanding,
    ownership: ownership.get(draft.key) ?? "0.00",
  }));
}

function percentHundredthsOf(text: string): bigint {
  const [whole, fraction] = text.split(".");
  return BigInt(whole ?? "0") * 100n + BigInt(fraction ?? "0");
}

/** The founder admin's view: one row per holder with shares, then the pool row. */
export function adminCapRows(totals: RegisterTotals): CapTableRow[] {
  const drafts: Draft[] = [...totals.holders.values()]
    .filter((holder) => holder.issuedShares + holder.optionsOutstanding > 0)
    .map((holder) => ({
      key: holder.personId,
      label: holder.name,
      issuedShares: holder.issuedShares,
      optionsOutstanding: holder.optionsOutstanding,
    }))
    .sort((a, b) => {
      const left = a.issuedShares + a.optionsOutstanding;
      const right = b.issuedShares + b.optionsOutstanding;
      if (left !== right) return right - left;
      return a.label.localeCompare(b.label, "en");
    });
  drafts.push({ key: "pool", label: "Unallocated option pool", issuedShares: 0, optionsOutstanding: totals.pool.unallocated });
  return toRows(drafts);
}

export function capTableForRole(totals: RegisterTotals, role: Role, personId: string): CapTable {
  const adminRows = adminCapRows(totals);
  if (role === "founder_admin") {
    return { fully_diluted_total: totals.fullyDilutedTotal, rows: adminRows, total_ownership: "100.00" };
  }
  if (role === "board_member") {
    const drafts: Draft[] = CLASS_ROWS.map(([key, label]) => ({
      key,
      label,
      issuedShares: totals.classTotals.get(label) ?? 0,
      optionsOutstanding: 0,
    }));
    drafts.push({
      key: "options_outstanding",
      label: "Options outstanding",
      issuedShares: 0,
      optionsOutstanding: totals.pool.outstanding,
    });
    drafts.push({ key: "pool", label: "Unallocated option pool", issuedShares: 0, optionsOutstanding: totals.pool.unallocated });
    return { fully_diluted_total: totals.fullyDilutedTotal, rows: toRows(drafts), total_ownership: "100.00" };
  }
  const holder = totals.holders.get(personId);
  const ownRow: CapTableRow = adminRows.find((row) => row.key === personId) ?? {
    key: personId,
    label: holder?.name ?? personId,
    issued_shares: 0,
    options_outstanding: 0,
    fully_diluted: 0,
    ownership: "0.00",
  };
  const othersRow: CapTableRow = {
    key: "others",
    label: "All other holders",
    issued_shares: 0,
    options_outstanding: 0,
    fully_diluted: totals.fullyDilutedTotal - ownRow.fully_diluted,
    ownership: formatPercent(10000n - percentHundredthsOf(ownRow.ownership)),
  };
  return { fully_diluted_total: totals.fullyDilutedTotal, rows: [ownRow, othersRow], total_ownership: "100.00" };
}
