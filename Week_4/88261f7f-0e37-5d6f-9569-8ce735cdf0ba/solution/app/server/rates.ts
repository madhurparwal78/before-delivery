import type { RatePlan, TaxRate } from "../shared/api";
import { isIsoDate, type IsoDate } from "../shared/dates";
import { isAmountCents, parsePercentHundredths, percentText } from "../shared/money";
import { atomic, database, inserted, one, rows, run, type Row } from "./db";
import { fail, isUuid, ok, type JsonObject, type Reply } from "./http";
import { loadHotel } from "./hotel";
import { emit } from "./live";

interface PlanRow extends Row { id: string; name: string; weeknight_cents: number; weekend_cents: number }
interface RateRow extends Row { id: string; hundredths: number; start_date: IsoDate | null }

const planView = (row: PlanRow): RatePlan => ({ id: row.id, name: row.name, weeknightCents: row.weeknight_cents, weekendCents: row.weekend_cents });
const rateView = (row: RateRow): TaxRate => ({ id: row.id, percent: percentText(row.hundredths), startDate: row.start_date });

export async function listPlans(hotelId: string): Promise<Reply> {
  const plans = await rows<PlanRow>(database(), "SELECT * FROM rate_plans WHERE hotel_id = $1 ORDER BY name DESC", [hotelId]);
  return ok({ ratePlans: plans.map(planView) });
}

export async function savePlan(hotelId: string, planId: string, body: JsonObject): Promise<Reply> {
  const saved = await atomic(async (client) => {
    const found = isUuid(planId) ? await one<PlanRow>(client, "SELECT * FROM rate_plans WHERE id = $1 AND hotel_id = $2 FOR UPDATE", [planId, hotelId]) : undefined;
    if (!found) throw fail.notFound();
    const errors: Record<string, string> = {};
    if (!isAmountCents(body.weeknightCents)) errors.weeknightCents = "Enter an amount above zero.";
    if (!isAmountCents(body.weekendCents)) errors.weekendCents = "Enter an amount above zero.";
    if (!isAmountCents(body.weeknightCents) || !isAmountCents(body.weekendCents)) throw fail.invalid(errors);
    await run(client, "UPDATE rate_plans SET weeknight_cents = $2, weekend_cents = $3 WHERE id = $1", [planId, body.weeknightCents, body.weekendCents]);
    await emit(client, hotelId, { type: "report", notice: null });
    return planId;
  });
  return ok(planView(await inserted<PlanRow>(database(), "SELECT * FROM rate_plans WHERE id = $1", [saved])));
}

export async function listTaxRates(hotelId: string): Promise<Reply> {
  const found = await rows<RateRow>(database(), "SELECT * FROM tax_rates WHERE hotel_id = $1 ORDER BY start_date NULLS FIRST", [hotelId]);
  return ok({ taxRates: found.map(rateView) });
}

export async function saveTaxRate(hotelId: string, body: JsonObject): Promise<Reply> {
  const hotel = await loadHotel(database(), hotelId);
  const errors: Record<string, string> = {};
  const hundredths = typeof body.percent === "string" ? parsePercentHundredths(body.percent) : null;
  if (hundredths === null) errors.percent = "Enter a rate from 0 to 30 with at most two decimals.";
  const startDate = isIsoDate(body.startDate) && body.startDate > hotel.businessDate ? body.startDate : null;
  if (startDate === null) errors.startDate = "The start date must be after the business date.";
  if (hundredths === null || startDate === null) throw fail.invalid(errors);
  const saved = await atomic(async (client) => {
    const row = await inserted<RateRow>(
      client,
      `INSERT INTO tax_rates (hotel_id, hundredths, start_date) VALUES ($1, $2, $3)
       ON CONFLICT (hotel_id, COALESCE(start_date, '0001-01-01')) DO UPDATE SET hundredths = EXCLUDED.hundredths RETURNING *`,
      [hotelId, hundredths, startDate],
    );
    await emit(client, hotelId, { type: "report", notice: null });
    return row;
  });
  return ok(rateView(saved), 201);
}
