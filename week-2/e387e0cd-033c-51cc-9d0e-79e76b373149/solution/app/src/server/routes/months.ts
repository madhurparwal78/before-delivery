// Business months: fee lines per tier, the month close (Kill Bill invoice, then the record, then the mail) and the
// regulator's monthly file.
import { allow, staff, type Staff } from "../auth.js";
import { config } from "../config.js";
import { lockName, one, pool, rows, type Db } from "../db.js";
import { refuse } from "../errors.js";
import { type Router } from "../http.js";
import { invoiceFeeLines, InvoicingUnreachable } from "../killbill.js";
import { amountText, feeLines, type FeeLine } from "../money.js";
import { initials, maskIdentity } from "../names.js";
import { csvLine } from "../csv.js";
import { record, spend, type Limit } from "../ratelimit.js";
import { deliverLater } from "../smtp.js";
import { tx } from "../db.js";
import type { Workspace } from "../workspaces.js";
import { effectiveStatus, type CaseRow } from "../cases/record.js";
import { listCases } from "../cases/transitions.js";
import { businessDate, formatMoney, formatMonth, isoInstant, plainMoney, plural, shiftMonth, stamp, zonedInstant } from "../../shared/format.js";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function monthRange(workspace: Workspace, ym: string): [number, number] {
  return [zonedInstant(workspace.timeZone, `${ym}-01`), zonedInstant(workspace.timeZone, `${shiftMonth(ym, 1)}-01`)];
}

/** Every business month from the first seeded month to the current one, oldest first. */
function listedMonths(workspace: Workspace, now: number): string[] {
  const first = shiftMonth(workspace.firstBusinessDate.slice(0, 7), -3);
  const current = businessDate(workspace.timeZone, now).slice(0, 7);
  const out: string[] = [];
  for (let m = first; m <= current; m = shiftMonth(m, 1)) out.push(m);
  return out;
}

interface ClosedMonthRow {
  month: string;
  invoice_id: string;
  closed_at: Date;
  message_count: number;
  total_cents: bigint;
}

interface FeeLineRow {
  tier: number;
  label: string;
  count: number;
  unit_price: string;
  amount_cents: bigint;
}

async function meteredCount(db: Db, workspace: Workspace, ym: string): Promise<number> {
  const [start, end] = monthRange(workspace, ym);
  const found = await one<{ n: number }>(db,
    "SELECT count(*)::int AS n FROM metered_messages WHERE workspace_slug = $1 AND at >= $2 AND at < $3",
    [workspace.slug, new Date(start), new Date(end)]);
  return found!.n;
}

/** A month as computed figures until it is invoiced, then as recorded. */
async function monthBody(db: Db, workspace: Workspace, ym: string, now: number, withLines: boolean) {
  const closed = await one<ClosedMonthRow>(db, "SELECT * FROM closed_months WHERE workspace_slug = $1 AND month = $2", [workspace.slug, ym]);
  let lines: FeeLine[];
  if (closed) {
    lines = (await rows<FeeLineRow>(db, "SELECT * FROM fee_lines WHERE workspace_slug = $1 AND month = $2 ORDER BY tier", [workspace.slug, ym]))
      .map((l) => ({ tier: l.tier, label: l.label, count: l.count, unitPrice: l.unit_price, amountCents: l.amount_cents }));
  } else {
    lines = feeLines(workspace.currency, await meteredCount(db, workspace, ym));
  }
  const ended = now >= monthRange(workspace, ym)[1];
  return {
    month: ym,
    status: closed ? "invoiced" : ended ? "ready" : "open",
    messageCount: closed ? closed.message_count : lines.reduce((n, l) => n + l.count, 0),
    totalCents: closed ? closed.total_cents : lines.reduce((sum, l) => sum + l.amountCents, 0n),
    currency: workspace.currency,
    invoiceId: closed?.invoice_id ?? null,
    closedAt: closed ? isoInstant(closed.closed_at.getTime()) : null,
    ...(withLines ? { lines } : {}),
  };
}

function knownMonth(who: Staff, ym: string, now: number): string {
  if (!MONTH.test(ym) || !listedMonths(who.workspace, now).includes(ym)) throw refuse.notFound();
  return ym;
}

function closedMail(workspace: Workspace, ym: string, lines: FeeLine[], total: bigint, invoiceId: string, to: string[]) {
  return {
    to,
    subject: `Lanternline: ${formatMonth(ym)} closed`,
    text: [
      `${workspace.name} closed ${formatMonth(ym)} on the Lanternline Handshake Desk.`,
      "",
      "Fee lines:",
      ...lines.map((l) => `- ${l.label}: ${plural(l.count, "message", "messages")} at ${workspace.currency} ${l.unitPrice} = ${formatMoney(workspace.currency, l.amountCents)}`),
      "",
      `Total: ${formatMoney(workspace.currency, total)}`,
      `Kill Bill invoice: ${invoiceId}`,
    ].join("\n"),
  };
}

const PERSONAL = ["Originator name", "Originator identity number", "Originator date of birth", "Beneficiary name"];
const REGULATOR_HEADER = [
  "Reference", "Created at", "Asset", "Amount", "Fiat value", "Currency", "Threshold", "Rule in force since", "Rate",
  "Counterparty name", "Counterparty LEI", "Counterparty jurisdiction", "Counterparty rule", "Path", "Status", "Data sent via",
  "Data sent at", "Answer", "Answer late", "Answered at", ...PERSONAL, "Closed at", "Outcome",
];

/** One row of the regulator's monthly file, from what the case was decided under. */
function regulatorRow(c: CaseRow, masked: boolean, now: number): (string | null)[] {
  const d = c.decided_under;
  const at = (x: Date | null) => (x ? isoInstant(x.getTime()) : null);
  const name = c.originator_name;
  const personal = masked
    ? [name && initials(name), c.originator_identity_number && maskIdentity(c.originator_identity_number), null,
      c.beneficiary_name && initials(c.beneficiary_name)]
    : [name, c.originator_identity_number, c.originator_date_of_birth, c.beneficiary_name];
  return [
    c.reference, at(c.created_at), c.asset, amountText(c.asset, BigInt(c.amount_atomic)), plainMoney(c.fiat_value_cents), c.currency,
    d.thresholdCents === null ? null : plainMoney(BigInt(d.thresholdCents)), d.ruleInForceSince, plainMoney(BigInt(d.rateCents)),
    d.counterpartyName, c.cp_lei, c.cp_jurisdiction, d.counterpartyRule, c.path, effectiveStatus(c, now), c.data_sent_channel,
    at(c.data_sent_at), c.answer_decision, c.answer_decision ? String(c.answer_late === true) : null, at(c.answer_at), ...personal,
    at(c.closed_at), c.outcome,
  ];
}

export function registerMonths(router: Router): void {
  router.add("GET", "/api/w/:slug/months", async (ctx) => {
    const who = await staff(ctx);
    allow(who, "compliance_officer", "finance_lead");
    const now = Date.now();
    const months = await Promise.all(listedMonths(who.workspace, now).reverse().map((m) => monthBody(pool, who.workspace, m, now, false)));
    return { status: 200, json: { months } };
  });

  router.add("GET", "/api/w/:slug/months/:month", async (ctx) => {
    const who = await staff(ctx);
    const now = Date.now();
    const ym = knownMonth(who, ctx.params.month, now);
    allow(who, "compliance_officer", "finance_lead");
    return { status: 200, json: { month: await monthBody(pool, who.workspace, ym, now, true) } };
  });

  router.add("POST", "/api/w/:slug/months/:month/close", async (ctx) => {
    const who = await staff(ctx);
    const ym = knownMonth(who, ctx.params.month, Date.now());
    allow(who, "finance_lead");
    ctx.json();
    const label = formatMonth(ym);
    const closed = await tx(async (db) => {
      await lockName(db, `month:${who.workspace.slug}:${ym}`);
      const now = Date.now();
      if (await one(db, "SELECT 1 FROM closed_months WHERE workspace_slug = $1 AND month = $2", [who.workspace.slug, ym])) {
        throw refuse.conflict("month_closed", `${label} is already closed.`);
      }
      if (now < monthRange(who.workspace, ym)[1]) throw refuse.conflict("month_not_ended", `${label} has not ended yet.`);
      const count = await meteredCount(db, who.workspace, ym);
      if (count === 0) throw refuse.conflict("month_empty", `${label} has no messages to bill.`);
      const lines = feeLines(who.workspace.currency, count);
      let invoiceId: string;
      try {
        invoiceId = await invoiceFeeLines(who.workspace, label, lines);
      } catch (error) {
        if (error instanceof InvoicingUnreachable) {
          console.error(error.message);
          throw refuse.invoicingUnreachable();
        }
        throw error;
      }
      const total = lines.reduce((sum, l) => sum + l.amountCents, 0n);
      await db.query("INSERT INTO closed_months VALUES ($1, $2, $3, $4, $5, $6)",
        [who.workspace.slug, ym, invoiceId, stamp(now), count, total]);
      for (const l of lines) {
        await db.query("INSERT INTO fee_lines VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [who.workspace.slug, ym, l.tier, l.label, l.count, l.unitPrice, l.amountCents]);
      }
      return { lines, total, invoiceId };
    });
    const finance = await rows<{ email: string }>(pool,
      "SELECT email FROM members WHERE workspace_slug = $1 AND role = 'finance_lead' AND removed_at IS NULL", [who.workspace.slug]);
    if (finance.length) {
      deliverLater(closedMail(who.workspace, ym, closed.lines, closed.total, closed.invoiceId, finance.map((f) => f.email)));
    }
    return { status: 201, json: { month: await monthBody(pool, who.workspace, ym, Date.now(), true) } };
  });

  router.add("GET", "/api/w/:slug/files", async (ctx) => {
    const who = await staff(ctx);
    allow(who, "compliance_officer", "compliance_analyst", "support_agent");
    const now = Date.now();
    const months = await Promise.all(listedMonths(who.workspace, now).reverse().map(async (month) => {
      const [start, end] = monthRange(who.workspace, month);
      const found = await one<{ n: number }>(pool,
        "SELECT count(*)::int AS n FROM cases WHERE workspace_slug = $1 AND created_at >= $2 AND created_at < $3",
        [who.workspace.slug, new Date(start), new Date(end)]);
      return { month, cases: found!.n };
    }));
    return { status: 200, json: { months } };
  });

  router.add("GET", "/api/w/:slug/files/regulator", async (ctx) => {
    const who = await staff(ctx);
    const limit: Limit = { name: `regulator-file:${who.member.id}`, max: 5, windowSeconds: config.timers.regulatorFileRateWindow };
    await spend(limit, false);
    allow(who, "compliance_officer", "compliance_analyst", "support_agent");
    const ym = ctx.query.get("month") ?? "";
    const now = Date.now();
    if (!MONTH.test(ym) || monthRange(who.workspace, ym)[0] > now) throw refuse.invalid({ month: "Choose a month that has started." });
    const [start, end] = monthRange(who.workspace, ym);
    const found = (await listCases(pool, who.workspace, "c.created_at >= $2 AND c.created_at < $3", [new Date(start), new Date(end)]))
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.reference.localeCompare(b.reference));
    const masked = who.member.role === "support_agent";
    const text = csvLine(REGULATOR_HEADER) + found.map((c) => csvLine(regulatorRow(c, masked, now))).join("");
    await record(limit);
    return {
      status: 200,
      body: Buffer.from(text, "utf8"),
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${who.workspace.slug}-regulator-${ym}.csv"`,
      },
    };
  });
}
