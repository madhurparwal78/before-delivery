/** The cloth ledger: balanced pairs, pages, footers, reconciliation and the CSV export. */
import { lockNamed, one, opaqueId, rows, run, type Queryable, type Row } from "./db.js";
import { instant, now, wholeSecond } from "./time.js";
import { keysetPage, type PageRequest } from "./paging.js";
import { inchesOf, squareFeetOf, squareMetresOf } from "../shared/units.js";
import type { LedgerFooter, LedgerLine, LedgerPage } from "../shared/types.js";

interface PairSide {
  account: string;
  stockCode: string;
}

export interface PairSpec {
  /** The amount on the first side; the second side takes the opposite. */
  amount: number;
  first: PairSide;
  second: PairSide;
  drawingCode: string;
  reason: string;
}

export interface PostedPair {
  pair_id: string;
  lines: [LedgerLine, LedgerLine];
}

function lineOf(row: Row): LedgerLine {
  return {
    line_id: row.line_id,
    pair_id: row.pair_id,
    posted_at: instant(row.posted_at),
    account: row.account,
    amount_mm2: row.amount_mm2,
    stock_code: row.stock_code,
    drawing_code: row.drawing_code,
    actor_email: row.actor_email,
    reason: row.reason,
  };
}

/** Posts balanced pairs under the ledger lock, so line numbers and instants rise together. */
export async function postPairs(db: Queryable, actorEmail: string, specs: PairSpec[]): Promise<PostedPair[]> {
  await lockNamed(db, "ledger");
  const postedAt = wholeSecond(now());
  const posted: PostedPair[] = [];
  for (const spec of specs) {
    const pairId = await opaqueId(db, "P-");
    const lines: LedgerLine[] = [];
    for (const [side, amount] of [[spec.first, spec.amount], [spec.second, -spec.amount]] as const) {
      const id = (await one<{ n: number }>(db, "SELECT nextval('ledger_line_seq') AS n"))!.n;
      await run(
        db,
        `INSERT INTO ledger_line (line_id, pair_id, posted_at, account, amount_mm2, stock_code, drawing_code, actor_email, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, pairId, postedAt, side.account, amount, side.stockCode, spec.drawingCode, actorEmail, spec.reason],
      );
      lines.push({
        line_id: id,
        pair_id: pairId,
        posted_at: instant(postedAt),
        account: side.account,
        amount_mm2: amount,
        stock_code: side.stockCode,
        drawing_code: spec.drawingCode,
        actor_email: actorEmail,
        reason: spec.reason,
      });
    }
    posted.push({ pair_id: pairId, lines: lines as [LedgerLine, LedgerLine] });
  }
  return posted;
}

async function ledgerFooter(db: Queryable, stockCode: string | null): Promise<LedgerFooter> {
  const offcuts = (await one<{ n: number }>(db, "SELECT count(*)::int AS n FROM stock WHERE kind = 'offcut' AND remaining_mm > 0"))!.n;
  if (stockCode === null) {
    const total = (await one<{ lines: number; area: number }>(
      db,
      "SELECT (SELECT count(*)::int FROM ledger_line) AS lines, (SELECT COALESCE(sum(on_hand_mm2), 0) FROM stock) AS area",
    ))!;
    return {
      stock_code: null,
      remaining_mm: null,
      remaining_in: null,
      offcut_count: offcuts,
      on_hand_mm2: total.area,
      on_hand_m2: squareMetresOf(total.area),
      on_hand_ft2: squareFeetOf(total.area),
      lines: total.lines,
    };
  }
  const item = await one<{ remaining_mm: number; on_hand_mm2: number }>(db, "SELECT remaining_mm, on_hand_mm2 FROM stock WHERE code = $1", [stockCode]);
  const lines = (await one<{ n: number }>(db, "SELECT count(*)::int AS n FROM ledger_line WHERE stock_code = $1", [stockCode]))!.n;
  return {
    stock_code: stockCode,
    remaining_mm: item?.remaining_mm ?? 0,
    remaining_in: inchesOf(item?.remaining_mm ?? 0),
    offcut_count: offcuts,
    on_hand_mm2: item?.on_hand_mm2 ?? 0,
    on_hand_m2: squareMetresOf(item?.on_hand_mm2 ?? 0),
    on_hand_ft2: squareFeetOf(item?.on_hand_mm2 ?? 0),
    lines,
  };
}

export async function ledgerPage(db: Queryable, stockCode: string | null, request: PageRequest): Promise<LedgerPage> {
  const page = await keysetPage(db, {
    base: `SELECT *, posted_at AS k1, line_id AS k2 FROM ledger_line ${stockCode ? "WHERE stock_code = $1" : ""}`,
    params: stockCode ? [stockCode] : [],
    types: ["timestamptz", "bigint"],
    direction: "desc",
    filter: `stock=${stockCode ?? ""}`,
    request,
    map: lineOf,
  });
  return { ...page, footer: await ledgerFooter(db, stockCode) };
}

export async function allLines(db: Queryable): Promise<LedgerLine[]> {
  return (await rows(db, "SELECT * FROM ledger_line ORDER BY posted_at DESC, line_id DESC")).map(lineOf);
}

interface Reconciliation {
  lines: number;
  ledger_sum_mm2: number;
  stored_on_hand_mm2: number;
  ledger_on_hand_mm2: number;
  difference_mm2: number;
  items: { stock_code: string; stored_on_hand_mm2: number; ledger_on_hand_mm2: number; difference_mm2: number }[];
}

export async function reconcile(db: Queryable): Promise<Reconciliation> {
  const items = await rows(
    db,
    `SELECT s.code, s.on_hand_mm2 AS stored, COALESCE(sum(l.amount_mm2), 0)::bigint AS ledger
       FROM stock s LEFT JOIN ledger_line l ON l.account = s.code GROUP BY s.code, s.on_hand_mm2 ORDER BY s.kind DESC, s.num`,
  );
  const totals = (await one<{ lines: number; sum: number }>(db, "SELECT count(*)::int AS lines, COALESCE(sum(amount_mm2), 0)::bigint AS sum FROM ledger_line"))!;
  const stored = items.reduce((total, item) => total + item.stored, 0);
  const ledger = items.reduce((total, item) => total + item.ledger, 0);
  return {
    lines: totals.lines,
    ledger_sum_mm2: totals.sum,
    stored_on_hand_mm2: stored,
    ledger_on_hand_mm2: ledger,
    difference_mm2: stored - ledger,
    items: items.map((item) => ({
      stock_code: item.code,
      stored_on_hand_mm2: item.stored,
      ledger_on_hand_mm2: item.ledger,
      difference_mm2: item.stored - item.ledger,
    })),
  };
}

const CSV_HEADER = ["line_id", "pair_id", "posted_at", "account", "amount_mm2", "stock_code", "drawing_code", "actor_email", "reason"];

function csvText(value: string): string {
  const neutralised = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(neutralised) ? `"${neutralised.replace(/"/g, '""')}"` : neutralised;
}

/** The ledger as CSV: text fields neutralised then quoted, numbers left exactly as they are. */
export function ledgerCsv(lines: LedgerLine[]): string {
  const body = lines.map((line) =>
    [
      String(line.line_id),
      line.pair_id,
      line.posted_at,
      csvText(line.account),
      String(line.amount_mm2),
      csvText(line.stock_code),
      csvText(line.drawing_code),
      csvText(line.actor_email),
      csvText(line.reason),
    ].join(","),
  );
  return `${[CSV_HEADER.join(","), ...body].join("\n")}\n`;
}
