// Monthly statements: a PDF of the renter's available-account movements in one kitchen month.

import { randomUUID } from "node:crypto";
import type { MovementKind, StatementView } from "../../shared/api.js";
import { formatHours } from "../../shared/hours.js";
import { KITCHEN_TIME_ZONE, existingWallClockInstant, formatKitchenDateTime, kitchenMonthOf } from "../../shared/kitchenTime.js";
import { MOVEMENT_WORDS } from "../../shared/ledger.js";
import { iso, now } from "../clock.js";
import { type Db, only, pool, rows } from "../db.js";
import type { JsonObject } from "../http/body.js";
import { fail, invalid } from "../http/errors.js";
import { renderPdf } from "../services/pdf.js";
import { StorageUnavailable, putObject } from "../services/storage.js";
import { availableAccount, signedMinutes } from "../../shared/ledger.js";
import { balancesOf } from "./ledger.js";
import { renterRow } from "./renters.js";

interface StatementRow {
  id: string;
  renter_id: string;
  month: string;
  object_key: string;
  created_at: Date;
}

function statementView(row: StatementRow): StatementView {
  return { id: row.id, renter_id: row.renter_id, month: row.month, created_at: iso(row.created_at) };
}

export async function listStatements(renterId: string): Promise<StatementView[]> {
  return (await rows<StatementRow>(pool, "SELECT * FROM statements WHERE renter_id = $1 ORDER BY created_at, id", [renterId])).map(statementView);
}

export function statementRow(db: Db, statementId: string): Promise<StatementRow> {
  return only<StatementRow>(db, "SELECT * FROM statements WHERE id = $1", [statementId]);
}

function nextMonth(month: string): string {
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5, 7));
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
}

interface MovementRow {
  account: string;
  kind: MovementKind;
  direction: "debit" | "credit";
  minutes: number;
  created_at: Date;
}

export async function createStatement(renterId: string, body: JsonObject): Promise<StatementView> {
  const month = typeof body.month === "string" ? body.month : "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > kitchenMonthOf(now())) {
    throw invalid({ month: "Choose this month or an earlier one, as YYYY-MM." });
  }
  const renter = await renterRow(pool, renterId);
  const from = existingWallClockInstant(`${month}-01`, 0);
  const to = existingWallClockInstant(`${nextMonth(month)}-01`, 0);
  const movements = await rows<MovementRow>(
    pool,
    "SELECT account, kind, direction, minutes, created_at FROM ledger_entries WHERE account = $1 AND created_at >= $2 AND created_at < $3 ORDER BY id",
    [availableAccount(renterId), iso(from), iso(to)],
  );
  const opening = (await balancesOf(pool, renterId, from)).balance_minutes;
  const closing = (await balancesOf(pool, renterId, to)).balance_minutes;
  const pdf = renderPdf([
    { text: "Brigade & Bench Railside", size: 18, bold: true },
    { text: `Monthly statement for ${renter.business_name}`, size: 13, gap: 6 },
    { text: `Month: ${month}`, gap: 8 },
    { text: `Kitchen time zone: ${KITCHEN_TIME_ZONE}` },
    { text: `Opening balance: ${formatHours(opening)} hours`, bold: true, gap: 10 },
    ...(movements.length
      ? movements.map((row) => ({ text: `${formatKitchenDateTime(row.created_at.getTime())}   ${MOVEMENT_WORDS[row.kind]}   ${signedMinutes(row) >= 0 ? "+" : ""}${formatHours(signedMinutes(row))} h` }))
      : [{ text: "No hour movements this month." }]),
    { text: `Closing balance: ${formatHours(closing)} hours`, bold: true, gap: 10 },
  ]);
  const id = randomUUID();
  const key = `renters/${renterId}/statements/${month}-${id}.pdf`;
  try {
    await putObject(key, pdf, "application/pdf");
  } catch (error) {
    if (error instanceof StorageUnavailable) throw fail(503, "storage_unavailable");
    throw error;
  }
  const row = await only<StatementRow>(
    pool,
    "INSERT INTO statements (id, renter_id, month, object_key, created_at) VALUES ($1, $2, $3, $4, $5) RETURNING *",
    [id, renterId, month, key, iso(now())],
  );
  return statementView(row);
}
