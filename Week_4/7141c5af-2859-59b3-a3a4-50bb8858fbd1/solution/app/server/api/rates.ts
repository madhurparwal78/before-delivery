import { query } from "../db/pool.ts";
import { copy } from "../domain/copy.ts";
import { fixed, fractionDigits, rational } from "../domain/decimal.ts";
import { withinAmountRange } from "../domain/estimate.ts";
import { type Currency, currencyDecimals, minorOfPrice, priceKey, type PriceKey, PRICE_KEYS } from "../domain/money.ts";
import { turinToday } from "../domain/time.ts";
import { conflict, invalid } from "../http/errors.ts";
import { type Ctx, json, route } from "../http/router.ts";
import { bodyOf, type Body, dateField, decimalField } from "./fields.ts";

type RateRow = { takesEffectOn: string } & Record<PriceKey, string>;

const RATE_COLUMNS = `takes_effect_on AS "takesEffectOn", eur, gbp, usd, jpy, aed`;

/** The latest row in effect on today's Turin date, in the currency's minor units. */
export async function labourRateMinor(deskId: string, currency: Currency): Promise<bigint> {
  const rows = await query<RateRow>(`SELECT ${RATE_COLUMNS} FROM rates WHERE desk_id = $1 AND takes_effect_on <= $2 ORDER BY takes_effect_on DESC LIMIT 1`, [deskId, turinToday()]);
  return minorOfPrice((rows[0] as RateRow)[priceKey(currency)], currency);
}

function readAmount(body: Body, key: PriceKey): string {
  const text = decimalField(body, key);
  const digits = currencyDecimals(key.toUpperCase() as Currency);
  if (fractionDigits(text) > digits || !withinAmountRange(text)) throw invalid(key, copy("F-08"));
  return fixed(rational(text), digits);
}

async function saveRate(ctx: Ctx) {
  const body = bodyOf(ctx);
  const takesEffectOn = dateField(body, "takesEffectOn");
  const amounts = PRICE_KEYS.map((key) => readAmount(body, key));
  if (takesEffectOn < turinToday()) throw invalid("takesEffectOn", copy("F-59"));
  const rows = await query<RateRow>(
    `INSERT INTO rates (desk_id, takes_effect_on, eur, gbp, usd, jpy, aed) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING RETURNING ${RATE_COLUMNS}`,
    [ctx.deskId, takesEffectOn, ...amounts],
  );
  if (rows.length === 0) throw conflict("rateTaken", copy("F-58"));
  return json(201, { rate: rows[0] });
}

export function register(): void {
  route({
    method: "GET",
    pattern: "/api/rates",
    handle: async (ctx) => json(200, { rates: await query<RateRow>(`SELECT ${RATE_COLUMNS} FROM rates WHERE desk_id = $1 ORDER BY takes_effect_on`, [ctx.deskId]) }),
  });
  route({ method: "POST", pattern: "/api/rates", handle: saveRate });
}
