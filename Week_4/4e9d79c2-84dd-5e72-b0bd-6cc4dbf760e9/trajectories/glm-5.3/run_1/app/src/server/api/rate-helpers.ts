import type { Ctx } from "../app.js";
import { isoDate } from "../repo.js";
import { addDays, ukToInstant } from "../uktime.js";
import type { DepositLimits } from "../rules.js";

export interface RateTableFull {
  id: string;
  effectiveFrom: string;
  defaultMarginPercent: string;
  waitingRatePennies: number;
  secondDriverPennies: number;
  deposits: DepositLimits;
}

/** The table in force on a date is the latest whose date is not after it. */
export async function rateTableFor(ctx: Ctx, deskId: string, on: Date): Promise<RateTableFull> {
  const r = await ctx.db.query(
    "SELECT * FROM rate_tables WHERE desk_id=$1 AND effective_from <= (NOW() AT TIME ZONE 'Europe/London')::date ORDER BY effective_from DESC LIMIT 1",
    [deskId]
  );
  const row = r.rows[0];
  void on;
  if (!row) {
    return {
      id: "",
      effectiveFrom: "2000-01-01",
      defaultMarginPercent: "15",
      waitingRatePennies: 2000,
      secondDriverPennies: 15000,
      deposits: { minibus: 5000, minibusHigher: 10000, coach: 10000, coachHigher: 15000, minibusHigherAt: 75000, coachHigherAt: 100000 },
    };
  }
  return rowToRate(row);
}

export async function rateTableForDate(ctx: Ctx, deskId: string, date: string): Promise<RateTableFull> {
  const r = await ctx.db.query("SELECT * FROM rate_tables WHERE desk_id=$1 AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1", [deskId, date]);
  const row = r.rows[0];
  if (!row) {
    return {
      id: "",
      effectiveFrom: "2000-01-01",
      defaultMarginPercent: "15",
      waitingRatePennies: 2000,
      secondDriverPennies: 15000,
      deposits: { minibus: 5000, minibusHigher: 10000, coach: 10000, coachHigher: 15000, minibusHigherAt: 75000, coachHigherAt: 100000 },
    };
  }
  return rowToRate(row);
}

export function rowToRate(row: Record<string, unknown>): RateTableFull {
  return {
    id: String(row.id),
    effectiveFrom: isoDate(row.effective_from),
    defaultMarginPercent: String(row.default_margin_percent),
    waitingRatePennies: Number(row.waiting_rate_pennies),
    secondDriverPennies: Number(row.second_driver_pennies),
    deposits: {
      minibus: Number(row.deposit_minibus),
      minibusHigher: Number(row.deposit_minibus_higher),
      coach: Number(row.deposit_coach),
      coachHigher: Number(row.deposit_coach_higher),
      minibusHigherAt: 75000,
      coachHigherAt: 100000,
    },
  };
}

/** A quote ends at the end of the fifth UK calendar day after sending, or by QUOTE_VALID_SECONDS. */
export function quoteEndFor(sentAt: Date, quoteValidSeconds: number | null): Date {
  if (quoteValidSeconds !== null) {
    return new Date(Math.floor(sentAt.getTime() / 1000) * 1000 + quoteValidSeconds * 1000 - 1000);
  }
  const sentDay = ukDayString(sentAt);
  const endDay = addDays(sentDay, 5);
  const r = ukToInstant(endDay, "23:59");
  return new Date(r.instant.getTime() + 59999);
}

function ukDayString(d: Date): string {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const [dd, mm, yyyy] = f.split("/");
  return `${yyyy}-${mm}-${dd}`;
}