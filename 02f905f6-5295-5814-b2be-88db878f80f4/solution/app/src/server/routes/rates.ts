// Dated rate sets.
import type { RateSet } from "../../shared/api";
import { allow } from "../auth";
import { studioDate, studioLabel } from "../clock";
import { pool, type Db } from "../db";
import { fieldsOf, HttpError, invalidFields, type Route } from "../http";
import type { RateSetRow } from "../measure";

interface StoredRateSet extends RateSetRow {
  effective_date: string;
  created_at: Date;
}

function rateSetOut(row: StoredRateSet): RateSet {
  return {
    id: row.id,
    bisque_rate: row.bisque_rate,
    glaze_rate: row.glaze_rate,
    member_discount_percent: row.member_discount_percent,
    order_minimum_cents: row.order_minimum_cents,
    effective_date: row.effective_date,
    created_at: row.created_at.toISOString(),
    created_at_label: studioLabel(row.created_at),
  };
}

/** The rate set with the latest effective date on or before the studio date of `at`. */
export async function rateSetInEffect(db: Db, at: Date): Promise<StoredRateSet> {
  const found = await db.query<StoredRateSet>(
    "SELECT * FROM rate_sets WHERE effective_date <= $1 ORDER BY effective_date DESC LIMIT 1",
    [studioDate(at)],
  );
  return found.rows[0];
}

const RATE = /^\d+(\.\d{1,4})?$/;

function rateField(value: unknown): string | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!RATE.test(text)) return null;
  const [whole = "0", fraction = ""] = text.split(".");
  const units = Number(whole) * 10000 + Number(fraction.padEnd(4, "0"));
  return units > 0 && units <= 10000 ? `${whole}.${fraction.padEnd(4, "0")}` : null;
}

function wholeNumber(value: unknown, min: number, max: number): number | null {
  const number = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function realDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

export const rateRoutes: Route[] = [
  {
    method: "GET",
    path: "/api/rates",
    auth: true,
    body: "none",
    handler: async (ctx) => {
      allow(ctx.user, "owner");
      const found = await pool.query<StoredRateSet>("SELECT * FROM rate_sets ORDER BY effective_date DESC");
      return { status: 200, body: found.rows.map(rateSetOut) };
    },
  },
  {
    method: "GET",
    path: "/api/rates/current",
    auth: true,
    body: "none",
    handler: async () => ({ status: 200, body: rateSetOut(await rateSetInEffect(pool, new Date())) }),
  },
  {
    method: "POST",
    path: "/api/rates",
    auth: true,
    body: "json",
    handler: async (ctx) => {
      allow(ctx.user, "owner");
      const body = fieldsOf(ctx.body);
      const fields: Record<string, string> = {};
      const bisque = rateField(body.bisque_rate);
      const glaze = rateField(body.glaze_rate);
      const discount = wholeNumber(body.member_discount_percent, 0, 50);
      const minimum = wholeNumber(body.order_minimum_cents, 0, 10000);
      const date = realDate(body.effective_date);
      if (bisque === null) fields.bisque_rate = "Enter a rate above 0 and at most 1.0000, with up to four decimals";
      if (glaze === null) fields.glaze_rate = "Enter a rate above 0 and at most 1.0000, with up to four decimals";
      if (discount === null) fields.member_discount_percent = "Enter a whole percent from 0 to 50";
      if (minimum === null) fields.order_minimum_cents = "Enter a minimum from $0.00 to $100.00";
      if (date === null) fields.effective_date = "Enter a date as YYYY-MM-DD";
      else if (date < studioDate(new Date())) fields.effective_date = "Choose today or a later date";
      if (Object.keys(fields).length > 0) throw invalidFields(fields);
      const created = await pool.query<StoredRateSet>(
        `INSERT INTO rate_sets (bisque_rate, glaze_rate, member_discount_percent, order_minimum_cents, effective_date, created_at)
         VALUES ($1, $2, $3, $4, $5, now()) ON CONFLICT (effective_date) DO NOTHING RETURNING *`,
        [bisque, glaze, discount, minimum, date],
      );
      const row = created.rows[0];
      if (!row) throw new HttpError(409, "rate_date_taken", `Rates already set for ${date}.`);
      return { status: 201, body: rateSetOut(row) };
    },
  },
];
