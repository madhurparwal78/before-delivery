import type { Sql } from "../db.js";
import { errors } from "../errors.js";
import { monthBounds, royaltySplit, isoInstant, formatCoopTime, formatMonthName } from "../../shared/time.js";
import { asJson } from "../db.js";

// Monthly royalty statements: one per closed co-op month, covering licences
// confirmed within its bounds whose invoice is raised. Each line splits the
// invoiced amount into commission and co-contributor shares under the exact
// remainder rule, and the rate fixed at confirmation.
export interface StatementLine {
  licence_id: string;
  essay_title: string;
  newsroom: { slug: string; name: string };
  confirmed_at: string;
  confirmed_display: string;
  amount_minor: number;
  rate_bp: number;
  commission_minor: number;
  shares: { handle: string; name: string; position: number; split_bp: number; amount_minor: number }[];
}

export interface StatementTotals {
  invoiced_minor: number;
  commission_minor: number;
  contributors: { handle: string; name: string; amount_minor: number }[];
}

export interface Statement {
  month: string;
  lines: StatementLine[];
  totals: StatementTotals;
  payouts: { handle: string; amount_minor: number; state: "queued" | "recorded" }[];
}

export type RunStatementResult =
  | { status: "created" | "existing"; statement: Statement }
  | { status: "pending" }
  | { status: "notClosed" }
  | { status: "invalid" };

export async function runStatement(sql: Sql, month: string, nowMs: number): Promise<RunStatementResult> {
  const bounds = monthBounds(month);
  if (!bounds) return { status: "invalid" };
  const [startMs, endMs] = bounds;
  if (nowMs < endMs) return { status: "notClosed" };

  const existing = await sql`SELECT month, lines, totals FROM royalty_statements WHERE month = ${month}`;
  if (existing.length > 0) {
    const payouts = await sql`SELECT handle, amount_minor, state FROM payouts WHERE month = ${month} ORDER BY handle`;
    return {
      status: "existing",
      statement: {
        month,
        lines: asJson<StatementLine[]>(existing[0].lines),
        totals: asJson<StatementTotals>(existing[0].totals),
        payouts: payouts.map((p) => ({ handle: p.handle, amount_minor: Number(p.amount_minor), state: p.state })),
      },
    };
  }

  const pending = await sql`
    SELECT id FROM licences
    WHERE confirmed_epoch_ms >= ${BigInt(startMs)} AND confirmed_epoch_ms < ${BigInt(endMs)} AND state = 'pending_invoice'`;
  if (pending.length > 0) return { status: "pending" };

  const licences = await sql`
    SELECT l.id, l.kind, l.confirmed_epoch_ms, l.amount_minor, l.rate_bp,
           e.id AS essay_id, e.title AS essay_title, e.taken_down_at IS NOT NULL AS taken_down,
           n.slug AS newsroom_slug, n.name AS newsroom_name
    FROM licences l
    JOIN essays e ON e.id = l.essay_id
    JOIN newsrooms n ON n.id = l.newsroom_id
    WHERE l.confirmed_epoch_ms >= ${BigInt(startMs)} AND l.confirmed_epoch_ms < ${BigInt(endMs)}
      AND l.invoice_state = 'raised'
    ORDER BY l.confirmed_epoch_ms, l.id`;

  const lines: StatementLine[] = [];
  const contributorTotals = new Map<string, { handle: string; name: string; amount_minor: number }>();
  let invoiced = 0;
  let commission = 0;

  for (const lic of licences) {
    const credits = await sql`
      SELECT c.handle, p.name, c.position, c.split_bp
      FROM credits c JOIN people p ON p.id = c.person_id
      WHERE c.essay_id = ${lic.essay_id} ORDER BY c.position`;
    const split = royaltySplit(Number(lic.amount_minor), Number(lic.rate_bp), credits.map((c) => ({
      handle: c.handle,
      position: Number(c.position),
      split_bp: Number(c.split_bp),
    })));
    const shares = split.shares.map((s) => {
      const person = credits.find((c) => c.handle === s.handle);
      return { handle: s.handle, name: person?.name ?? s.handle, position: s.position, split_bp: s.split_bp, amount_minor: s.amount_minor };
    });
    for (const share of shares) {
      const entry = contributorTotals.get(share.handle) ?? { handle: share.handle, name: share.name, amount_minor: 0 };
      entry.amount_minor += share.amount_minor;
      contributorTotals.set(share.handle, entry);
    }
    invoiced += Number(lic.amount_minor);
    commission += split.commission_minor;
    lines.push({
      licence_id: lic.id,
      essay_title: lic.taken_down ? "Removed essay (legal takedown)" : lic.essay_title,
      newsroom: { slug: lic.newsroom_slug, name: lic.newsroom_name },
      confirmed_at: isoInstant(Number(lic.confirmed_epoch_ms)),
      confirmed_display: formatCoopTime(Number(lic.confirmed_epoch_ms)),
      amount_minor: Number(lic.amount_minor),
      rate_bp: Number(lic.rate_bp),
      commission_minor: split.commission_minor,
      shares,
    });
  }

  const totals: StatementTotals = {
    invoiced_minor: invoiced,
    commission_minor: commission,
    contributors: [...contributorTotals.entries()].map(([, v]) => v).sort((a, b) => a.handle.localeCompare(b.handle)),
  };

  await sql.begin(async (tx) => {
    await tx`INSERT INTO royalty_statements (month, lines, totals) VALUES (${month}, ${JSON.stringify(lines)}::jsonb, ${JSON.stringify(totals)}::jsonb)
             ON CONFLICT (month) DO NOTHING`;
    for (const contributor of totals.contributors) {
      if (contributor.amount_minor <= 0) continue;
      const person = await tx`SELECT id FROM people WHERE contributor_handle = ${contributor.handle}`;
      if (person.length === 0) continue;
      await tx`INSERT INTO payouts (month, handle, person_id, amount_minor, state)
               VALUES (${month}, ${contributor.handle}, ${person[0].id}, ${contributor.amount_minor}, 'queued')
               ON CONFLICT (month, handle) DO NOTHING`;
    }
  });

  const payouts = await sql`SELECT handle, amount_minor, state FROM payouts WHERE month = ${month} ORDER BY handle`;
  return {
    status: "created",
    statement: {
      month,
      lines,
      totals,
      payouts: payouts.map((p) => ({ handle: p.handle, amount_minor: Number(p.amount_minor), state: p.state })),
    },
  };
}

export async function getStatement(sql: Sql, month: string): Promise<Statement | null> {
  const existing = await sql`SELECT month, lines, totals FROM royalty_statements WHERE month = ${month}`;
  if (existing.length === 0) return null;
  const payouts = await sql`SELECT handle, amount_minor, state FROM payouts WHERE month = ${month} ORDER BY handle`;
  return {
    month,
    lines: asJson<StatementLine[]>(existing[0].lines),
    totals: asJson<StatementTotals>(existing[0].totals),
    payouts: payouts.map((p) => ({ handle: p.handle, amount_minor: Number(p.amount_minor), state: p.state })),
  };
}

export function statementStatusText(statement: Statement): string {
  void statement;
  return "";
}

export { formatMonthName };
