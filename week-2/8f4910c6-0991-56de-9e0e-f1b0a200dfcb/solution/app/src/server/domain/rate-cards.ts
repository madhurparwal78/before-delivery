// Effective-dated rate cards.

import { exec, lockKey, one, pool, rows, tx, type Db } from "../db.js";
import { memberRoute, json } from "../http.js";
import { STAFF } from "../auth.js";
import { FieldErrors, required } from "../errors.js";
import { asObject, isWholeNumber, newId, str } from "../util.js";
import { isIsoDate } from "../../shared/zones.js";
import { formatDate } from "../../shared/format.js";
import { BOARDS, MEDIA, type BoardRates, type Media, type RateCard } from "./fees.js";

interface RateCardRow {
  id: string;
  name: string;
  effective_from: string;
  boards: RateCard["boards"];
  usage_base: RateCard["usageBaseCents"];
}

function rateCardBody(row: RateCardRow): RateCard {
  return { id: row.id, name: row.name, effectiveFrom: row.effective_from, boards: row.boards, usageBaseCents: row.usage_base };
}

/** The card with the greatest `effectiveFrom` on or before the job day. */
export async function cardFor(db: Db, jobDate: string): Promise<RateCard> {
  const row = await one<RateCardRow>(
    db, "SELECT * FROM rate_cards WHERE effective_from <= $1 ORDER BY effective_from DESC LIMIT 1", [jobDate]);
  if (!row) throw new Error(`no rate card in effect on ${jobDate}`);
  return rateCardBody(row);
}

memberRoute("GET", "/api/rate-cards", async (ctx) => {
  ctx.allow(...STAFF);
  const found = await rows<RateCardRow>(pool, "SELECT * FROM rate_cards ORDER BY effective_from");
  return json(200, { rateCards: found.map(rateCardBody) });
});

const RATE_KEYS: Array<keyof BoardRates> = ["fullDayCents", "halfDayCents", "overtimeQuarterHourCents"];
const CENTS_COPY = "Enter a whole number of cents above zero.";

function positive(value: unknown): value is number {
  return isWholeNumber(value) && value > 0;
}

memberRoute("POST", "/api/rate-cards", async (ctx) => {
  ctx.allow("agency_director");
  const body = asObject(await ctx.json());
  const name = str(body, "name").trim();
  const effectiveFrom = str(body, "effectiveFrom");
  const boardsIn = asObject(body.boards);
  const usageIn = asObject(body.usageBaseCents);
  const errors: FieldErrors = new FieldErrors();
  if (!name) errors.add("name", required("Name"));
  const boards: Record<string, BoardRates> = {};
  for (const board of BOARDS) {
    const rates = asObject(boardsIn[board]);
    if (RATE_KEYS.every((key) => positive(rates[key]))) {
      boards[board] = { fullDayCents: Number(rates.fullDayCents), halfDayCents: Number(rates.halfDayCents),
        overtimeQuarterHourCents: Number(rates.overtimeQuarterHourCents) };
    } else errors.add(`boards.${board}`, CENTS_COPY);
  }
  const usage: Partial<Record<Media, number>> = {};
  for (const media of Object.keys(MEDIA) as Media[]) {
    const value = usageIn[media];
    if (positive(value)) usage[media] = value;
    else errors.add(`usageBaseCents.${media}`, CENTS_COPY);
  }
  return tx(async (client) => {
    await lockKey(client, "rate-cards");
    const latest = await one<{ effective_from: string }>(client,
      "SELECT effective_from FROM rate_cards ORDER BY effective_from DESC LIMIT 1");
    if (!isIsoDate(effectiveFrom)) errors.add("effectiveFrom", "Enter the effective date like 2027-04-01.");
    else if (latest && effectiveFrom <= latest.effective_from) {
      errors.add("effectiveFrom", `Choose a date after ${formatDate(latest.effective_from)}, the latest card's start.`);
    }
    errors.throwIfAny();
    const id = newId();
    await exec(client, "INSERT INTO rate_cards (id, name, effective_from, boards, usage_base) VALUES ($1, $2, $3, $4, $5)",
      [id, name, effectiveFrom, JSON.stringify(boards), JSON.stringify(usage)]);
    return json(201, rateCardBody({ id, name, effective_from: effectiveFrom, boards: boards as RateCard["boards"],
      usage_base: usage as RateCard["usageBaseCents"] }));
  });
});
