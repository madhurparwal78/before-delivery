import type { Valuation } from "../shared/types.js";
import { parseDecimal } from "./decimal.js";
import { nextId, only, transaction, type Tx } from "./db.js";
import { validation } from "./errors.js";
import { loadValuations } from "./registry.js";
import { isCalendarDate, now, pacificDate } from "./time.js";

export async function recordValuation(body: Record<string, unknown>): Promise<Valuation> {
  const today = pacificDate(now());
  const fields: Record<string, string> = {};
  const effective = body.effective_on;
  const expires = body.expires_on;
  const effectiveOk = typeof effective === "string" && isCalendarDate(effective);
  const expiresOk = typeof expires === "string" && isCalendarDate(expires);
  if (!effectiveOk) fields.effective_on = "Enter the date as YYYY-MM-DD.";
  else if (effective > today) fields.effective_on = "The effective date can't be after today.";
  if (!expiresOk) fields.expires_on = "Enter the date as YYYY-MM-DD.";
  else if (effectiveOk && expires < effective) fields.expires_on = "The expiry date can't be before the effective date.";
  const units = parseDecimal(body.fmv_per_share, 4);
  if (units === null || units <= 0n) fields.fmv_per_share = "Enter a value above $0.0000 with up to four decimals.";
  const firm = typeof body.firm === "string" ? body.firm.trim() : "";
  if (firm.length < 1 || firm.length > 120) fields.firm = "Enter the valuation firm.";
  if (Object.keys(fields).length > 0) throw validation(fields);
  return transaction(async (tx) => {
    const id = await nextId(tx, "valuation_number", "VAL-", 2);
    await tx.query(
      "INSERT INTO valuations (id, effective_on, expires_on, fmv_units, firm) VALUES ($1, $2, $3, $4, $5)",
      [id, effective, expires, (units ?? 0n).toString(), firm],
    );
    const { all, current } = await loadValuations(tx);
    await tx.query(
      `INSERT INTO settings (key, value) VALUES ('valuation_state', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(valuationState(current))],
    );
    tx.emit({ to: null, type: "changed", data: { topics: ["valuations"] } });
    await announceValuation(tx, current);
    return only(all.filter((valuation) => valuation.id === id));
  });
}

export const valuationState = (current: Valuation | null): string => `${current?.id ?? "none"}:${current?.status ?? "none"}`;

/** Tells every open admin page what the current valuation now is. */
export async function announceValuation(tx: Tx, current: Valuation | null): Promise<void> {
  const admins = await tx.query<{ id: string }>("SELECT id FROM people WHERE role = 'founder_admin'");
  for (const admin of admins) {
    tx.emit({
      to: admin.id,
      type: "valuation.changed",
      data: {
        status: current?.status ?? "none",
        expires_on: current?.expires_on ?? null,
        fmv_per_share: current?.fmv_per_share ?? null,
      },
    });
  }
}
