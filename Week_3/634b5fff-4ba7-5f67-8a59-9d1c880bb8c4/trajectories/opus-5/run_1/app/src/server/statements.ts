import { randomUUID } from 'node:crypto';
import { keepCharityEvent, flushCharityEvent } from './charityEvents.js';
import { businessNow } from './clock.js';
import { config } from './config.js';
import { monthBounds } from './copenhagen.js';
import { query } from './db.js';
import { statementHtml, type StatementLine } from './documents.js';
import { fail, failStorage } from './errors.js';
import { newEventId, newToken } from './orders.js';
import { CHARITY_NAME } from './rates.js';
import { PdfUnreachable, renderPdf } from './services/pdf.js';
import { getObject, putObject } from './services/storage.js';

export interface StatementSummary {
  id: string;
  month: string;
  revision: number;
  charityTotalOre: number;
  makerTotalOre: number;
  vatTotalOre: number;
  pdfUrl: string;
}

function pdfUrlFor(id: string): string {
  return `/api/staff/statements/${id}/pdf`;
}

export async function monthLines(month: string): Promise<StatementLine[]> {
  const rows = await query<{
    reference: string;
    box_number: number;
    kind: 'sale' | 'refund';
    gross_ore: number;
    net_ore: number;
    vat_ore: number;
    charity_ore: number;
    maker_ore: number;
    rate_basis_points: number;
    posted_at: Date;
  }>(
    `SELECT reference, box_number, kind, gross_ore, net_ore, vat_ore, charity_ore, maker_ore,
            rate_basis_points, posted_at
       FROM split_lines WHERE posted_month = $1 ORDER BY posted_at, id`,
    [month],
  );
  return rows.map((row) => ({
    reference: row.reference,
    boxNumber: row.box_number,
    kind: row.kind,
    grossOre: row.gross_ore,
    netOre: row.net_ore,
    vatOre: row.vat_ore,
    charityOre: row.charity_ore,
    makerOre: row.maker_ore,
    rateBasisPoints: row.rate_basis_points,
    postedAt: row.posted_at.toISOString(),
  }));
}

export async function listStatements(): Promise<StatementSummary[]> {
  const rows = await query<{
    id: string;
    month: string;
    revision: number;
    charity_total_ore: number;
    maker_total_ore: number;
    vat_total_ore: number;
  }>(
    `SELECT id, month, revision, charity_total_ore, maker_total_ore, vat_total_ore
       FROM statements ORDER BY month DESC, revision DESC`,
  );
  return rows.map((row) => ({
    id: row.id,
    month: row.month,
    revision: row.revision,
    charityTotalOre: row.charity_total_ore,
    makerTotalOre: row.maker_total_ore,
    vatTotalOre: row.vat_total_ore,
    pdfUrl: pdfUrlFor(row.id),
  }));
}

export interface IssuedStatement extends StatementSummary {
  lines: StatementLine[];
}

/** Issuing again creates a new revision with its own PDF and event. */
export async function issueStatement(month: unknown): Promise<IssuedStatement> {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw fail(422, 'month_invalid');
  }
  if (monthBounds(month).start.getTime() > businessNow().getTime()) throw fail(422, 'month_invalid');

  const lines = await monthLines(month);
  const charityTotalOre = lines.reduce((sum, line) => sum + line.charityOre, 0);
  const makerTotalOre = lines.reduce((sum, line) => sum + line.makerOre, 0);
  const vatTotalOre = lines.reduce((sum, line) => sum + line.vatOre, 0);

  const previous = await query<{ revision: number }>(
    'SELECT coalesce(max(revision), 0) AS revision FROM statements WHERE month = $1',
    [month],
  );
  const revision = (previous[0]?.revision ?? 0) + 1;

  let pdf: Buffer;
  try {
    pdf = await renderPdf(
      statementHtml({ month, revision, charityName: CHARITY_NAME, lines, charityTotalOre }),
    );
  } catch (error) {
    if (error instanceof PdfUnreachable) throw fail(503, 'pdf_unreachable');
    throw error;
  }

  const pdfKey = `statements/${month}-r${revision}.pdf`;
  try {
    await putObject(pdfKey, pdf, 'application/pdf');
  } catch {
    throw failStorage('upload');
  }

  const id = randomUUID();
  const token = newToken();
  await query(
    `INSERT INTO statements (id, month, revision, charity_total_ore, maker_total_ore, vat_total_ore,
        lines, pdf_key, token)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, month, revision, charityTotalOre, makerTotalOre, vatTotalOre, JSON.stringify(lines), pdfKey, token],
  );

  const eventId = newEventId();
  await keepCharityEvent(eventId, 'statement.issued', {
    eventId,
    statementId: id,
    month,
    revision,
    charityTotalOre,
    lineCount: lines.length,
    downloadUrl: `${config.publicUrl}/api/statements/${id}/pdf?token=${token}`,
    issuedAt: businessNow().toISOString(),
  });
  await flushCharityEvent(eventId).catch(() => undefined);

  return { id, month, revision, charityTotalOre, makerTotalOre, vatTotalOre, lines, pdfUrl: pdfUrlFor(id) };
}

export async function statementPdf(id: string, token: string | null): Promise<Buffer | null> {
  const rows = await query<{ pdf_key: string; token: string }>(
    'SELECT pdf_key, token FROM statements WHERE id = $1',
    [id],
  );
  const row = rows[0];
  if (row === undefined) return null;
  if (token !== null && token !== row.token) return null;
  const stored = await getObject(row.pdf_key);
  return stored === null ? null : stored.body;
}
