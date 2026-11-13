import type { Valuation } from "../../shared/types.js";
import type { Transaction } from "../db.js";
import { compareYmd } from "../domain/dates.js";
import { parseDecimal } from "../domain/money.js";

export interface ValuationRow {
  id: string;
  effective_on: string;
  expires_on: string;
  fmv_per_share: string;
  firm: string;
  seq: number;
}

export interface ValuationView {
  rows: Valuation[];
  currentId: string | null;
  /** The fair market value in effect today, or null when the latest has lapsed. */
  fmvPerShare: bigint | null;
  lapsedExpiresOn: string | null;
}

export async function loadValuations(tx: Transaction, serverDate: string): Promise<ValuationView> {
  const rows = await tx.query<ValuationRow>(
    `select id, effective_on::text as effective_on, expires_on::text as expires_on,
            fmv_per_share::text as fmv_per_share, firm, seq
       from valuations
      order by effective_on desc, seq desc`,
  );
  const inEffect = rows.find((row) => compareYmd(row.effective_on, serverDate) <= 0) ?? null;
  const lapsed = inEffect !== null && compareYmd(inEffect.expires_on, serverDate) < 0;
  const currentId = inEffect !== null && !lapsed ? inEffect.id : null;
  const view: Valuation[] = rows.map((row) => ({
    id: row.id,
    effective_on: row.effective_on,
    expires_on: row.expires_on,
    fmv_per_share: row.fmv_per_share,
    firm: row.firm,
    status:
      inEffect !== null && row.id === inEffect.id ? (lapsed ? "lapsed" : "current") : "superseded",
  }));
  return {
    rows: view,
    currentId,
    fmvPerShare: currentId === null || inEffect === null ? null : parseDecimal(inEffect.fmv_per_share, 4),
    lapsedExpiresOn: lapsed && inEffect !== null ? inEffect.expires_on : null,
  };
}
