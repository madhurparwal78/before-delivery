import { dollars, monthName } from "../shared/rules.js";
import { requireRole, signedIn } from "./auth.js";
import { one, pool, rows, tx, type Db } from "./db.js";
import { statementHtml, type StatementLine } from "./documents.js";
import { conflict, notFound, validationFailed } from "./errors.js";
import { htmlToPdf } from "./gotenberg.js";
import { json, type Ctx, type Route } from "./http.js";
import { queueEmail } from "./outbox.js";
import { putObject } from "./s3.js";

// Payout statements: each creator's own split rows in a month, dated by paid_at or refund time.
// A month closes at 00:00 UTC on the 1st of the next month.

const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;
const CLAIM_SECONDS = 90;

function bounds(period: string): { start: Date; end: Date } {
  const [, year, month] = PERIOD.exec(period) as RegExpExecArray;
  return { start: new Date(Date.UTC(Number(year), Number(month) - 1, 1)), end: new Date(Date.UTC(Number(year), Number(month), 1)) };
}

/** A creator's lines: sale for their own piece, remix_sale as remixer, royalty on a remix of theirs, refund reversals. */
async function linesFor(db: Db, creatorId: string, period: string): Promise<StatementLine[]> {
  const { start, end } = bounds(period);
  const found = await rows<{ at: Date; piece_title: string; edition: number; party: string; kind: string; amount_cents: number; remix: boolean }>(
    db,
    `SELECT s.at, p.title AS piece_title, o.edition, s.party, s.kind, s.amount_cents, p.remix_of_id IS NOT NULL AS remix
       FROM split_rows s JOIN orders o ON o.id = s.order_id JOIN pieces p ON p.id = o.piece_id
      WHERE s.holder_id = $1 AND s.at >= $2 AND s.at < $3
      ORDER BY s.at, s.id`,
    [creatorId, start, end],
  );
  return found.map((r) => ({
    date: r.at.toISOString().slice(0, 10),
    piece_title: r.piece_title,
    edition: r.edition,
    kind: r.kind === "refund" ? "refund" : r.party === "remixer" ? "remix_sale" : r.remix ? "royalty" : "sale",
    amount_cents: r.amount_cents,
  }));
}

const total = (lines: StatementLine[]): number => lines.reduce((sum, l) => sum + l.amount_cents, 0);

async function myStatement(ctx: Ctx) {
  const user = await signedIn(ctx);
  const period = ctx.params.period ?? "";
  if (!PERIOD.test(period)) throw notFound();
  requireRole(user, "creator");
  const closed = await one(pool, "SELECT 1 FROM statement_periods WHERE period = $1", [period]);
  const lines = await linesFor(pool, user.id, period);
  return json(200, { period, status: closed ? "closed" : "open", lines, total_cents: total(lines) });
}

async function founder(ctx: Ctx) {
  const user = await signedIn(ctx);
  requireRole(user, "founder-operator");
}

async function closePeriod(ctx: Ctx) {
  await founder(ctx);
  const period = ctx.body !== null && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>).period : undefined;
  if (typeof period !== "string" || !PERIOD.test(period)) throw validationFailed({ period: "Send the month as YYYY-MM." });
  const creators = await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('statements'))");
    if (bounds(period).end.getTime() > Date.now()) throw conflict("period_open", `${monthName(period)} is still open.`);
    if (await one(client, "SELECT 1 FROM statement_periods WHERE period = $1", [period])) {
      throw conflict("period_closed", `${monthName(period)} is already closed.`);
    }
    await client.query("INSERT INTO statement_periods (period) VALUES ($1)", [period]);
    const { start, end } = bounds(period);
    const holders = await rows<{ holder_id: string }>(
      client,
      "SELECT DISTINCT holder_id FROM split_rows WHERE holder_id IS NOT NULL AND at >= $1 AND at < $2",
      [start, end],
    );
    for (const { holder_id } of holders) {
      await client.query("INSERT INTO statements (period, creator_id, total_cents) VALUES ($1, $2, $3)", [
        period,
        holder_id,
        total(await linesFor(client, holder_id, period)),
      ]);
    }
    return holders.map((h) => h.holder_id);
  });
  for (const creatorId of creators) await renderStatement(period, creatorId);
  return json(201, { period, creators: creators.length });
}

async function listPeriods(ctx: Ctx) {
  await founder(ctx);
  const sales = await one<{ first: Date | null }>(pool, "SELECT min(at) AS first FROM split_rows");
  const closed = new Map(
    (await rows<{ period: string; closed_at: Date; creators: number }>(
      pool,
      "SELECT sp.period, sp.closed_at, count(s.creator_id)::int AS creators FROM statement_periods sp LEFT JOIN statements s ON s.period = sp.period GROUP BY sp.period, sp.closed_at",
    )).map((p) => [p.period, p]),
  );
  const periods: { period: string; status: "open" | "closed"; creators: number | null; closed_at: string | null }[] = [];
  const first = sales?.first;
  if (first) {
    const now = new Date();
    for (let d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1)); d <= now; d.setUTCMonth(d.getUTCMonth() + 1)) {
      const period = d.toISOString().slice(0, 7);
      const row = closed.get(period);
      periods.unshift({ period, status: row ? "closed" : "open", creators: row?.creators ?? null, closed_at: row ? row.closed_at.toISOString() : null });
    }
  }
  return json(200, { periods });
}

/** Renders, stores and mails one creator's statement for a closed month. */
async function renderStatement(period: string, creatorId: string): Promise<void> {
  const claim = await one<{ display_name: string; email: string; total_cents: number }>(
    pool,
    `UPDATE statements s SET claimed_until = now() + make_interval(secs => ${CLAIM_SECONDS})
       FROM users u
      WHERE s.period = $1 AND s.creator_id = $2 AND u.id = s.creator_id AND s.pdf_status = 'pending'
        AND (s.claimed_until IS NULL OR s.claimed_until < now())
      RETURNING u.display_name, u.email, s.total_cents`,
    [period, creatorId],
  );
  if (!claim) return;
  try {
    const lines = await linesFor(pool, creatorId, period);
    const pdf = await htmlToPdf(statementHtml(period, claim.display_name, lines, claim.total_cents));
    await putObject(`statements/${period}/${creatorId}.pdf`, pdf, "application/pdf");
    await tx(async (client, after) => {
      const updated = await one(
        client,
        "UPDATE statements SET pdf_status = 'ready', claimed_until = NULL WHERE period = $1 AND creator_id = $2 AND pdf_status = 'pending' RETURNING period",
        [period, creatorId],
      );
      if (!updated) return;
      const send = await queueEmail(client, {
        kind: "statement",
        to: claim.email,
        subject: `Your ${monthName(period)} statement from Phosphene Yard`,
        text: [
          `Hello ${claim.display_name},`,
          "",
          `Your ${monthName(period)} statement is attached: ${lines.length} line${lines.length === 1 ? "" : "s"}, $${dollars(claim.total_cents)} owed in total.`,
          "It records what Phosphene Yard owes you; it is not a payout.",
          "",
          "Phosphene Yard, by Brightmoss Works",
        ].join("\n"),
        attachment: { name: `statement-${period}.pdf`, data: pdf },
      });
      after(send);
    });
  } catch (error) {
    console.error(`statement ${period} for ${creatorId} not rendered yet:`, error instanceof Error ? error.message : error);
    await pool.query("UPDATE statements SET claimed_until = NULL WHERE period = $1 AND creator_id = $2", [period, creatorId]);
  }
}

export async function retryPendingStatements(): Promise<void> {
  const pending = await rows<{ period: string; creator_id: string }>(
    pool,
    "SELECT period, creator_id FROM statements WHERE pdf_status = 'pending' AND (claimed_until IS NULL OR claimed_until < now())",
  );
  for (const s of pending) await renderStatement(s.period, s.creator_id);
}

export const statementRoutes: Route[] = [
  { method: "GET", pattern: "/api/me/statements/{period}", handler: myStatement },
  { method: "GET", pattern: "/api/admin/statements", handler: listPeriods },
  { method: "POST", pattern: "/api/admin/statements", handler: closePeriod },
];
