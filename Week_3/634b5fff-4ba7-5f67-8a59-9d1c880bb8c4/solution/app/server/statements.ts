import { randomUUID } from "node:crypto";
import { OUTAGE_COPY } from "../shared/copy.js";
import { CHARITY_NAME } from "../shared/domain.js";
import { copenhagenMonth, businessNow } from "./clock.js";
import { config } from "./config.js";
import { pool, withTx } from "./db.js";
import { statementHtml, type StatementLine } from "./documents.js";
import { fail } from "./http.js";
import { enqueue } from "./jobs.js";
import { newToken } from "./ids.js";
import { serial } from "./locks.js";
import { PdfUnreachable, renderPdf } from "./pdf.js";
import { getObject, putObject, StorageUnreachable } from "./s3.js";

/** Monthly charity statements: sale and refund lines in the Copenhagen month they posted, as a stored PDF. */

interface StatementLineOut extends StatementLine {
  rateBasisPoints: number;
  postedAt: string;
}

interface StatementRow {
  id: string;
  month: string;
  revision: number;
  charity_total_ore: number;
  maker_total_ore: number;
  vat_total_ore: number;
  token: string;
  issued_at: Date;
}

const statementKey = (month: string, revision: number): string => `statements/${month}-r${revision}.pdf`;

const summary = (row: StatementRow): Record<string, unknown> => ({
  id: row.id, month: row.month, revision: row.revision, charityTotalOre: row.charity_total_ore, makerTotalOre: row.maker_total_ore,
  vatTotalOre: row.vat_total_ore, pdfUrl: `/api/staff/statements/${row.id}/pdf`, issuedAt: row.issued_at.toISOString(),
});

export const listStatements = async (): Promise<Record<string, unknown>[]> =>
  ((await pool.query("SELECT * FROM statements ORDER BY issued_at DESC, revision DESC")).rows as StatementRow[]).map(summary);

const DAY_MS = 24 * 3600 * 1000;

const linesOf = async (month: string): Promise<StatementLineOut[]> => {
  const [year = 0, number = 0] = month.split("-").map(Number);
  const rows = await pool.query(
    "SELECT * FROM split_lines WHERE posted_at >= $1 AND posted_at < $2 ORDER BY posted_at, id",
    [new Date(Date.UTC(year, number - 1, 1) - DAY_MS), new Date(Date.UTC(year, number, 1) + DAY_MS)],
  );
  const inMonth = (rows.rows as Record<string, unknown>[]).filter((row) => copenhagenMonth(row.posted_at as Date) === month);
  return inMonth.map((row) => ({
    reference: String(row.reference), boxNumber: Number(row.box_number), kind: row.kind as "sale" | "refund",
    grossOre: Number(row.gross_ore), netOre: Number(row.net_ore), vatOre: Number(row.vat_ore), charityOre: Number(row.charity_ore),
    makerOre: Number(row.maker_ore), rateBasisPoints: Number(row.rate_basis_points), postedAt: (row.posted_at as Date).toISOString(),
  }));
};

const sum = (lines: StatementLineOut[], pick: (line: StatementLineOut) => number): number =>
  lines.reduce((total, line) => total + pick(line), 0);

export const issueStatement = async (month: unknown): Promise<Record<string, unknown>> => {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > copenhagenMonth(businessNow())) return fail("month_invalid");
  return serial(`statement:${month}`, () => issueFor(month));
};

const issueFor = async (month: string): Promise<Record<string, unknown>> => {
  const lines = await linesOf(month);
  const revision = ((await pool.query("SELECT coalesce(max(revision), 0)::int AS latest FROM statements WHERE month = $1", [month])).rows[0].latest as number) + 1;
  const totals = {
    charityTotalOre: sum(lines, (line) => line.charityOre), makerTotalOre: sum(lines, (line) => line.makerOre), vatTotalOre: sum(lines, (line) => line.vatOre),
  };
  try {
    const pdf = await renderPdf(statementHtml({ month, revision, charityName: CHARITY_NAME, lines, ...totals }));
    await putObject(statementKey(month, revision), pdf, "application/pdf");
  } catch (error) {
    if (error instanceof PdfUnreachable) return fail("pdf_unreachable");
    if (error instanceof StorageUnreachable) return fail("storage_unreachable");
    throw error;
  }
  const id = `st_${randomUUID()}`;
  const issuedAt = businessNow();
  await withTx(async (tx) => {
    await tx.query(
      `INSERT INTO statements (id, month, revision, charity_total_ore, maker_total_ore, vat_total_ore, lines, token, issued_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, month, revision, totals.charityTotalOre, totals.makerTotalOre, totals.vatTotalOre, JSON.stringify(lines), newToken(), issuedAt],
    );
    await enqueue(tx, "statement-hook", `statement-hook-${id}`, { statementId: id });
  });
  const row = (await pool.query("SELECT * FROM statements WHERE id = $1", [id])).rows[0] as StatementRow;
  return { ...summary(row), lines };
};

export const statementPayload = async (statementId: string): Promise<Record<string, unknown>> => {
  const row = (await pool.query("SELECT * FROM statements WHERE id = $1", [statementId])).rows[0] as StatementRow;
  const count = ((await pool.query("SELECT jsonb_array_length(lines)::int AS total FROM statements WHERE id = $1", [statementId])).rows[0].total as number);
  return {
    eventId: `evt_statement_${row.id}`, statementId: row.id, month: row.month, revision: row.revision, charityTotalOre: row.charity_total_ore,
    lineCount: count, downloadUrl: `${config.publicUrl}/api/statements/${row.id}/pdf?token=${row.token}`, issuedAt: row.issued_at.toISOString(),
  };
};

/** The stored PDF for a statement; `token` guards the public link, staff pass null. */
export const statementPdf = async (statementId: string, token: string | null): Promise<Buffer> => {
  const found = await pool.query("SELECT month, revision, token FROM statements WHERE id = $1", [statementId]);
  const row = found.rows[0] as { month: string; revision: number; token: string } | undefined;
  if (!row || (token !== null && token !== row.token)) return fail("not_found");
  try {
    return (await getObject(statementKey(row.month, row.revision))) ?? fail("not_found");
  } catch (error) {
    if (error instanceof StorageUnreachable) return fail("storage_unreachable", { message: OUTAGE_COPY.download });
    throw error;
  }
};
