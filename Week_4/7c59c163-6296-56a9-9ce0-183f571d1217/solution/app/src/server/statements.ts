import { randomUUID } from "node:crypto";
import { money, monthLabel } from "../shared/rules.js";
import { config } from "./config.js";
import { one, pool, rows, tx } from "./db.js";
import { account } from "./ledger.js";
import { enqueueEmail } from "./outbox.js";
import { renderPdf, type Line } from "./pdf.js";
import { putObject } from "./s3.js";
import { iso, type MemberRow, type VenueRow } from "./views.js";

export const statementKey = (venueId: string, memberId: string, month: string): string => `venues/${venueId}/statements/${memberId}/${month}.pdf`;

/** The month that is current in the venue's time zone, as YYYY-MM. */
export async function venueMonth(timeZone: string, monthsBack = 0): Promise<string> {
  const row = await one<{ month: string }>(pool, "SELECT to_char((now() AT TIME ZONE $1) - make_interval(months => $2), 'YYYY-MM') AS month", [timeZone, monthsBack]);
  return row?.month ?? "";
}

/** [start, end) of a calendar month in the venue's time zone. */
export async function monthBounds(month: string, timeZone: string): Promise<{ start: Date; end: Date }> {
  const row = await one<{ start: Date; end: Date }>(
    pool,
    `SELECT (to_date($1, 'YYYY-MM')::timestamp AT TIME ZONE $2) AS start,
            ((to_date($1, 'YYYY-MM') + interval '1 month')::timestamp AT TIME ZONE $2) AS end`,
    [month, timeZone],
  );
  return row as { start: Date; end: Date };
}

async function totalBalanceBefore(memberId: string, at: Date): Promise<number> {
  const row = await one<{ total: number }>(
    pool,
    `SELECT coalesce(sum(l.amount_cents), 0) AS total FROM journal_legs l JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.account IN ($1, $2, $3) AND e.created_at < $4`,
    [account.available(memberId), account.held(memberId), account.collateral(memberId), at],
  );
  return row?.total ?? 0;
}

/** Renders one member's statement: only that member's own activity in the month. */
async function statementPdf(venue: VenueRow, member: MemberRow, month: string): Promise<Buffer> {
  const { start, end } = await monthBounds(month, venue.time_zone);
  const fmt = (at: Date) => new Intl.DateTimeFormat("en-US", { timeZone: venue.time_zone, dateStyle: "medium", timeStyle: "short" }).format(at);
  const range = [member.id, start, end];
  const deposits = await rows<{ id: string; amount_cents: number; card_last4: string; created_at: Date }>(
    pool,
    "SELECT id, amount_cents, card_last4, created_at FROM deposits WHERE member_id = $1 AND status = 'succeeded' AND created_at >= $2 AND created_at < $3 ORDER BY created_at",
    range,
  );
  const refunds = await rows<{ amount_cents: number; deposit_id: string; created_at: Date }>(
    pool,
    "SELECT r.amount_cents, r.deposit_id, r.created_at FROM refunds r JOIN deposits d ON d.id = r.deposit_id WHERE d.member_id = $1 AND r.created_at >= $2 AND r.created_at < $3 ORDER BY r.created_at",
    range,
  );
  const fills = await rows<{ symbol: string; kind: string; mode: string | null; outcome: string | null; side: string; price: number; quantity: number; fee_cents: number; filled_at: Date }>(
    pool,
    `SELECT m.symbol, m.kind, f.mode, f.outcome, f.side, f.price, f.quantity, f.fee_cents, f.filled_at
       FROM fills f JOIN markets m ON m.id = f.market_id WHERE f.member_id = $1 AND f.filled_at >= $2 AND f.filled_at < $3 ORDER BY f.seq`,
    range,
  );
  const ledger = await rows<{ kind: string; symbol: string | null; amount: number; created_at: Date }>(
    pool,
    `SELECT e.kind, coalesce(m.symbol, pm.symbol) AS symbol, sum(l.amount_cents) AS amount, e.created_at
       FROM journal_entries e JOIN journal_legs l ON l.entry_id = e.id
       LEFT JOIN markets m ON m.id = e.reference_id
       LEFT JOIN margin_positions p ON p.id = e.reference_id LEFT JOIN markets pm ON pm.id = p.market_id
      WHERE l.account = $1 AND e.kind IN ('payout', 'netting', 'liquidation') AND e.created_at >= $2 AND e.created_at < $3
      GROUP BY e.id, e.kind, m.symbol, pm.symbol, e.created_at ORDER BY e.created_at`,
    [account.available(member.id), start, end],
  );
  const lines: Line[] = [
    { text: venue.name, bold: true, size: 18 },
    { text: `Monthly statement — ${monthLabel(month)}`, bold: true, size: 13, gap: 4 },
    { text: `Member: ${member.display_name}`, gap: 6 },
    { text: `Period: ${fmt(start)} to ${fmt(end)} (${venue.time_zone})` },
    { text: `Opening total balance: ${money(await totalBalanceBefore(member.id, start))}`, gap: 6 },
    { text: `Closing total balance: ${money(await totalBalanceBefore(member.id, end))}` },
    { text: "Deposits", bold: true, size: 12, gap: 10 },
  ];
  const section = (items: string[]) => (items.length ? items : ["None this month."]).forEach((text) => lines.push({ text }));
  section(deposits.map((d) => `${fmt(d.created_at)}  ${money(d.amount_cents)}  card ending ${d.card_last4}  deposit ${d.id}`));
  lines.push({ text: "Refunds", bold: true, size: 12, gap: 10 });
  section(refunds.map((r) => `${fmt(r.created_at)}  ${money(r.amount_cents)}  on deposit ${r.deposit_id}`));
  lines.push({ text: "Fills", bold: true, size: 12, gap: 10 });
  section(
    fills.map((f) => {
      const price = f.kind === "event" ? `${f.price}¢` : money(f.price);
      const what = f.kind === "event" ? `${(f.outcome ?? "").toUpperCase()} buy` : `${f.mode} ${f.side}`;
      return `${fmt(f.filled_at)}  ${f.symbol}  ${what}  ${f.quantity} at ${price}  fee ${money(f.fee_cents)}`;
    }),
  );
  lines.push({ text: "Payouts, netting and liquidations", bold: true, size: 12, gap: 10 });
  section(ledger.map((e) => `${fmt(e.created_at)}  ${e.kind}  ${e.symbol ?? ""}  ${money(e.amount)} to available`));
  return renderPdf(lines);
}

const running = new Set<string>();

/**
 * Renders and stores every missing statement of a run. A statement is rendered once: its row is
 * written with its "ready" email after the object is stored. Failures are retried by the worker.
 */
async function renderRun(venueId: string, month: string): Promise<void> {
  const runKey = `${venueId}:${month}`;
  if (running.has(runKey)) return;
  running.add(runKey);
  const client = await pool.connect();
  try {
    const locked = await one<{ ok: boolean }>(client, "SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [runKey]);
    if (!locked?.ok) return;
    try {
      const venue = (await one<VenueRow>(pool, "SELECT * FROM venues WHERE id = $1", [venueId])) as VenueRow;
      const members = await rows<MemberRow>(
        pool,
        "SELECT * FROM members m WHERE venue_id = $1 AND NOT EXISTS (SELECT 1 FROM statements s WHERE s.member_id = m.id AND s.month = $2) ORDER BY created_at",
        [venueId, month],
      );
      for (const member of members) {
        await putObject(statementKey(venueId, member.id, month), await statementPdf(venue, member, month), "application/pdf");
        await tx(async (db) => {
          await db.query("INSERT INTO statements (id, venue_id, member_id, month) VALUES ($1, $2, $3, $4)", [randomUUID(), venueId, member.id, month]);
          await enqueueEmail(db, venueId, {
            to: member.email,
            subject: `Your ${monthLabel(month)} statement is ready`,
            text: `Your ${monthLabel(month)} statement for ${venue.name} is ready. Open it from Statements:\n\n${config.publicUrl}/statements\n`,
          });
        });
      }
      await pool.query("UPDATE statement_runs SET completed_at = now() WHERE venue_id = $1 AND month = $2", [venueId, month]);
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [runKey]);
    }
  } finally {
    client.release();
    running.delete(runKey);
  }
}

/** Starts a run for the month; false when a run for that venue and month had already started. */
export async function startRun(venueId: string, month: string): Promise<{ started: boolean; members: number }> {
  const count = await one<{ n: number }>(pool, "SELECT count(*)::int AS n FROM members WHERE venue_id = $1", [venueId]);
  const inserted = await one<{ members: number }>(
    pool,
    "INSERT INTO statement_runs (venue_id, month, members) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING members",
    [venueId, month, count?.n ?? 0],
  );
  if (inserted) {
    renderRun(venueId, month).catch((error: unknown) => console.error("statement run:", error instanceof Error ? error.message : error));
    return { started: true, members: inserted.members };
  }
  const existing = await one<{ members: number }>(pool, "SELECT members FROM statement_runs WHERE venue_id = $1 AND month = $2", [venueId, month]);
  return { started: false, members: existing?.members ?? 0 };
}

/**
 * Automatic run within 10 minutes after midnight on the 1st (venue time) for the month that just
 * ended, by a server running then; also retries unfinished runs every minute. Missed months are
 * never caught up.
 */
export async function statementTick(): Promise<void> {
  const due = await rows<{ id: string; time_zone: string }>(
    pool,
    `SELECT id, time_zone FROM venues
      WHERE extract(day FROM now() AT TIME ZONE time_zone) = 1
        AND (now() AT TIME ZONE time_zone)::time < time '00:10'`,
  );
  for (const venue of due) await startRun(venue.id, await venueMonth(venue.time_zone, 1));
  const unfinished = await rows<{ venue_id: string; month: string }>(pool, "SELECT venue_id, month FROM statement_runs WHERE completed_at IS NULL AND started_at < now() - interval '50 seconds'");
  for (const run of unfinished) await renderRun(run.venue_id, run.month);
}

export interface StatementRow {
  id: string;
  month: string;
  created_at: Date;
}

export const statementView = (s: StatementRow) => ({ id: s.id, month: s.month, created_at: iso(s.created_at) });
