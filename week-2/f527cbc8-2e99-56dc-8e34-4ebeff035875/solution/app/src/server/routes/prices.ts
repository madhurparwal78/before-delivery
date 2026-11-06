// Effective-dated, immutable price lists with a booking deposit (brief: API, Price lists; DP-02).
import { randomUUID } from "node:crypto";
import { audit } from "../audit.js";
import { db, transaction } from "../db.js";
import { WORK_CODES } from "../domain/prices.js";
import { FIELD_COPY, conflict, refuseInvalid } from "../errors.js";
import { json, route } from "../http.js";
import { isValidDate } from "../practiceTime.js";
import { inRange, isWholeNumber, objectBody } from "./input.js";

const COLUMNS = "id, effective_from, deposit_cents, prices";

route("GET", "/api/price-lists", ["farrier"], async () => {
  const { rows } = await db.query(`SELECT ${COLUMNS} FROM price_lists ORDER BY effective_from DESC`);
  return json(200, rows);
});

route("POST", "/api/price-lists", ["farrier"], async ({ body: raw, now }) => {
  const body = objectBody(raw);
  const effectiveFrom = body.effective_from;
  if (isValidDate(effectiveFrom)) {
    const { rowCount } = await db.query(`SELECT 1 FROM price_lists WHERE effective_from = $1`, [effectiveFrom]);
    if (rowCount) throw conflict("price_list_exists");
  }
  const errors: Record<string, string> = {};
  if (!isValidDate(effectiveFrom)) errors.effective_from = FIELD_COPY.required;
  if (!inRange(body.deposit_cents, 0, 100_000)) {
    errors.deposit_cents = isWholeNumber(body.deposit_cents) ? FIELD_COPY.range(0, 100_000) : FIELD_COPY.amount;
  }
  const given = objectBody(body.prices);
  for (const code of WORK_CODES) {
    const cents = given[code];
    if (!isWholeNumber(cents) || cents <= 0) errors[`prices.${code}`] = FIELD_COPY.amount;
  }
  refuseInvalid(errors);
  const prices = Object.fromEntries(WORK_CODES.map((code) => [code, given[code]]));
  const list = await transaction(async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO price_lists (id, effective_from, deposit_cents, prices, created_at) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (effective_from) DO NOTHING RETURNING ${COLUMNS}`,
      [randomUUID(), effectiveFrom, body.deposit_cents, JSON.stringify(prices), new Date(now)],
    );
    const row = inserted.rows[0];
    if (!row) throw conflict("price_list_exists");
    await audit(client, { action: "create", entityType: "price_list", entityId: row.id, from: null, to: "active" });
    return row;
  });
  return json(201, list);
});
