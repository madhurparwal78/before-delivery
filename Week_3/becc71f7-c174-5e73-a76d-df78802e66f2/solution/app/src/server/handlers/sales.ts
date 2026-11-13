import { randomUUID } from "node:crypto";
import { addDays, brusselsDate, brusselsInstant, monthBounds } from "../../shared/brussels";
import type { Sale, SalesMonth } from "../../shared/api";
import { formatEuros, formatInstant, formatTime } from "../../shared/format";
import { config } from "../config";
import { pool, transaction, type Db } from "../db";
import { conflict, notFound, rateLimited, validationFailed } from "../errors";
import { loadPiece, pieceRowExists } from "../pieces";
import { file, reply, type Context, type Reply, type SignedIn } from "../pipeline";
import { splitSale } from "../rules/money";
import { periodEnd, priceAt, refundableUntil, refundWindowOpen } from "../rules/piece";
import { tagCodeOf } from "../rules/tagCode";
import { FieldProblems, isMonth, isUuid } from "../validate";

const EARLIEST_SALE_DAYS = 730;
const DOWNLOADS_PER_WINDOW = 5;
const DOWNLOAD_LIMIT_COPY = "You've downloaded the sales book 5 times in a short while. Try again in a moment.";

interface SaleRow {
  id: string;
  piece_id: string;
  tag_number: number;
  description: string;
  sold_at: Date;
  price_cents: number;
  consignor_share_cents: number;
  commission_cents: number;
  vat_cents: number;
  payment: Sale["payment"];
  sold_by: string;
  sold_by_name: string;
  consignor_name: string;
  refunded_at: Date | null;
}

const SELECT_SALES = `
  SELECT s.*, p.tag_number, p.description, m.name AS sold_by_name, c.name AS consignor_name
  FROM sales s JOIN pieces p ON p.id = s.piece_id JOIN members m ON m.id = s.sold_by JOIN consignors c ON c.id = p.consignor_id`;

const saleView = (row: SaleRow): Sale => ({
  id: row.id,
  pieceId: row.piece_id,
  tagCode: tagCodeOf(row.tag_number),
  soldAt: formatInstant(row.sold_at),
  priceCents: row.price_cents,
  consignorShareCents: row.consignor_share_cents,
  commissionCents: row.commission_cents,
  vatCents: row.vat_cents,
  payment: row.payment,
  soldBy: { id: row.sold_by, name: row.sold_by_name },
  consignorName: row.consignor_name,
  refundedAt: row.refunded_at && formatInstant(row.refunded_at),
  refundableUntil: formatInstant(refundableUntil(row.sold_at)),
});

async function saleById(db: Db, id: string): Promise<SaleRow> {
  const { rows } = await db.query<SaleRow>(`${SELECT_SALES} WHERE s.id = $1`, [id]);
  return rows[0];
}

export async function saleExists({ params }: Context): Promise<void> {
  if (!isUuid(params.id) || !(await pool.query("SELECT 1 FROM sales WHERE id = $1", [params.id])).rowCount) throw notFound();
}

function parseInstant(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function recordSale({ body, now }: Context, member: SignedIn): Promise<Reply> {
  const { pieceId, payment, soldAt } = body;
  if (pieceId === undefined || pieceId === null || pieceId === "") throw validationFailed({ pieceId: "Choose a piece." });
  return transaction(async (db) => {
    if (!(await pieceRowExists(db, pieceId))) throw notFound();
    const piece = await loadPiece(db, now, String(pieceId), true);
    const problems = new FieldProblems();
    if (payment !== "card" && payment !== "cash") problems.add("payment", "Choose Card or Cash.");
    const earlier = soldAt === undefined ? null : parseInstant(soldAt);
    if (soldAt !== undefined) {
      const earliest = brusselsInstant(addDays(brusselsDate(now), -EARLIEST_SALE_DAYS));
      const inPeriod = earlier !== null && earlier >= brusselsInstant(piece.intakeDate) && earlier < periodEnd(piece);
      if (!earlier || earlier > now || earlier < earliest || !inPeriod) problems.add("soldAt", "Give a past moment inside this piece's period, up to 730 days back.");
    }
    problems.check();
    if (piece.liveSale) {
      const { rows } = await db.query<{ name: string }>("SELECT m.name FROM sales s JOIN members m ON m.id = s.sold_by WHERE s.id = $1", [piece.liveSale.id]);
      throw conflict("already_sold", `Sold by ${rows[0].name} at ${formatTime(piece.liveSale.soldAt)}. Nothing was charged.`);
    }
    if (piece.status !== "on_rail" && piece.status !== "on_hold") throw conflict("not_for_sale", "This piece is archived, on a shelf or returned, so it can't be sold.");
    const at = earlier ?? new Date(now.getTime() - (now.getTime() % 1000));
    const priceCents = priceAt(piece, at);
    const split = splitSale(priceCents);
    const id = randomUUID();
    await db.query(
      `INSERT INTO sales (id, piece_id, sold_at, price_cents, consignor_share_cents, commission_cents, vat_cents, payment, sold_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, piece.id, at, priceCents, split.consignorShareCents, split.commissionCents, split.vatCents, payment, member.id],
    );
    await db.query("UPDATE holds SET ended_at = $2 WHERE piece_id = $1 AND released_at IS NULL AND ended_at IS NULL", [piece.id, now]);
    return reply(201, { sale: saleView(await saleById(db, id)) });
  });
}

export async function getSale({ params }: Context): Promise<Reply> {
  return reply(200, { sale: saleView(await saleById(pool, params.id)) });
}

export async function refundSale({ params, now }: Context): Promise<Reply> {
  return transaction(async (db) => {
    await db.query("SELECT 1 FROM sales WHERE id = $1 FOR UPDATE", [params.id]);
    const sale = await saleById(db, params.id);
    if (sale.refunded_at) throw conflict("already_refunded", "This sale was already refunded.");
    const { rowCount } = await db.query("SELECT 1 FROM payout_sales WHERE sale_id = $1", [params.id]);
    if (rowCount) throw conflict("sale_in_payout_run", "This sale is already in a payout run and can't be refunded.");
    if (!refundWindowOpen(sale.sold_at, now)) throw conflict("refund_window_closed", "This sale can no longer be refunded.");
    await db.query("UPDATE sales SET refunded_at = $2 WHERE id = $1", [params.id, now]);
    return reply(200, { sale: saleView(await saleById(db, params.id)) });
  });
}

async function monthLines(month: string): Promise<SaleRow[]> {
  const [from, to] = monthBounds(month);
  const { rows } = await pool.query<SaleRow>(`${SELECT_SALES} WHERE s.refunded_at IS NULL AND s.sold_at >= $1 AND s.sold_at < $2 ORDER BY s.sold_at, s.id`, [from, to]);
  return rows;
}

const totalsOf = (rows: SaleRow[]): SalesMonth["totals"] => ({
  priceCents: rows.reduce((sum, row) => sum + row.price_cents, 0),
  consignorShareCents: rows.reduce((sum, row) => sum + row.consignor_share_cents, 0),
  commissionCents: rows.reduce((sum, row) => sum + row.commission_cents, 0),
  vatCents: rows.reduce((sum, row) => sum + row.vat_cents, 0),
});

function checkedMonth(value: string | null): string {
  if (!isMonth(value)) throw validationFailed({ month: "Choose a month." });
  return value;
}

export async function salesOfMonth({ query }: Context): Promise<Reply> {
  const month = checkedMonth(query.get("month"));
  const rows = await monthLines(month);
  const view: SalesMonth = {
    month,
    lines: rows.map((row) => ({
      saleId: row.id,
      soldAt: formatInstant(row.sold_at),
      tagCode: tagCodeOf(row.tag_number),
      description: row.description,
      priceCents: row.price_cents,
      consignorShareCents: row.consignor_share_cents,
      commissionCents: row.commission_cents,
      vatCents: row.vat_cents,
      consignorName: row.consignor_name,
    })),
    totals: totalsOf(rows),
  };
  return reply(200, view);
}

const NEUTRALISED = new Set(["=", "+", "-", "@", "\t", "\r"]);

function cell(value: string): string {
  const safe = NEUTRALISED.has(value.charAt(0)) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

const line = (values: string[]): string => `${values.map(cell).join(",")}\r\n`;

const amounts = (row: { price: number; share: number; commission: number; vat: number }): string[] => [row.price, row.share, row.commission, row.vat].map(formatEuros);

function saleDateTime(instant: Date): string {
  return `${brusselsDate(instant)} ${formatTime(instant)}`;
}

export async function checkDownloadLimit(member: SignedIn, now: Date): Promise<void> {
  const windowMs = config.bookFileRateWindowSeconds * 1000;
  const { rows } = await pool.query<{ at: Date }>("SELECT at FROM book_downloads WHERE member_id = $1 AND at > $2 ORDER BY at", [member.id, new Date(now.getTime() - windowMs)]);
  if (rows.length >= DOWNLOADS_PER_WINDOW) throw rateLimited(DOWNLOAD_LIMIT_COPY, Math.max(1, Math.ceil((rows[0].at.getTime() + windowMs - now.getTime()) / 1000)));
}

export async function downloadSalesBook({ query, now }: Context, member: SignedIn): Promise<Reply> {
  const month = checkedMonth(query.get("month"));
  const rows = await monthLines(month);
  const totals = totalsOf(rows);
  const text = [
    '"Sale date","Tag code","Description","Sale price","Consignor share","Commission","VAT"\r\n',
    ...rows.map((row) =>
      line([saleDateTime(row.sold_at), tagCodeOf(row.tag_number), row.description, ...amounts({ price: row.price_cents, share: row.consignor_share_cents, commission: row.commission_cents, vat: row.vat_cents })]),
    ),
    line(["Total", "", "", ...amounts({ price: totals.priceCents, share: totals.consignorShareCents, commission: totals.commissionCents, vat: totals.vatCents })]),
  ].join("");
  await pool.query("INSERT INTO book_downloads (member_id, at) VALUES ($1, $2)", [member.id, now]);
  return file(Buffer.from(text), "text/csv; charset=utf-8", { "Content-Disposition": `attachment; filename="sales-book-${month}.csv"` });
}
