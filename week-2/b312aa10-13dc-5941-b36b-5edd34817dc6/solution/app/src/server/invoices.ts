// Member invoices (one line per Kill Bill item) and the month close.

import { lockMonths, pool, tx, type Db } from "./db.js";
import { ApiError, apiError, variantError, forbidden, invalid, route } from "./http.js";
import { refuseAnyKey } from "./bodies.js";
import { applyDueLapses } from "./states.js";
import { hourBank } from "./ledger.js";
import { queueMail } from "./mail.js";
import { BillingDown, commitInvoice, killBillAmount, probeBilling } from "./billing.js";
import { visibleMember } from "./kitchen.js";
import { freeze, surfaceText } from "./frozen.js";
import { usageCsvText, utilisationText } from "./reports.js";
import { money } from "../shared/format.js";
import { isMonth, monthName, type Month } from "../shared/time.js";

const LINE_KINDS: Record<string, "booking" | "penalty" | "credit"> = {
  Booking: "booking", "Late cancellation": "penalty", Moved: "credit", Cancelled: "credit", "Waived late cancellation": "credit", Adjustment: "credit",
};

interface InvoiceLine { kind: "booking" | "penalty" | "credit"; bookingId: string; description: string; amountCents: number; billingStatus: "billed" | "pending_billing" }

async function invoiceLines(db: Db, memberId: string, month: Month): Promise<InvoiceLine[]> {
  const { rows } = await db.query(
    "SELECT kind, booking_id, description, amount_cents, recorded_at FROM billing_items WHERE member_id = $1 AND month = $2 ORDER BY id",
    [memberId, month],
  );
  return rows.map((r) => ({
    kind: LINE_KINDS[r.kind]!, bookingId: r.booking_id, description: r.description, amountCents: r.amount_cents,
    billingStatus: r.recorded_at ? "billed" : "pending_billing",
  }));
}

const total = (lines: InvoiceLine[]): number => lines.reduce((sum, l) => sum + l.amountCents, 0);

const monthPath = (raw: string | undefined): Month => {
  if (!isMonth(raw)) throw invalid({ month: "Use a month in the form YYYY-MM." });
  return raw;
};

async function isClosed(db: Db, kitchenId: string, month: Month): Promise<boolean> {
  const { rows } = await db.query("SELECT 1 FROM closed_months WHERE kitchen_id = $1 AND month = $2", [kitchenId, month]);
  return rows.length > 0;
}

/** The live invoice response: every line, their exact sum and the member's hour bank for the month. */
async function invoiceText(db: Db, kitchenId: string, memberId: string, month: Month): Promise<string> {
  await applyDueLapses(db, kitchenId);
  const lines = await invoiceLines(db, memberId, month);
  return JSON.stringify({
    memberId, month, status: (await isClosed(db, kitchenId, month)) ? "closed" : "open",
    lines, totalCents: total(lines), hourBank: await hourBank(db, memberId, month),
  });
}

route("GET", "/api/members/:id/invoices/:month", async (ctx) => {
  const s = ctx.session!;
  const member = await visibleMember(s, ctx.params.id!);
  if (s.person.role === "shift_lead") throw forbidden();
  const month = monthPath(ctx.params.month);
  const text = await surfaceText(pool, s.kitchen.id, month, "invoice", member.id, () => invoiceText(pool, s.kitchen.id, member.id, month));
  return { status: 200, body: JSON.parse(text) };
});

const billingUnavailable = (): ApiError => apiError(503, "billing_unavailable");

/**
 * The month close: closes of one month wait for each other and for every booking action touching
 * the month (the exclusive month key). Each member's draft invoice is committed once; then one
 * transaction marks the month closed, stores the close-time names and queues the statements.
 */
route("POST", "/api/months/:month/close", async (ctx) => {
  const s = ctx.session!;
  if (s.person.role !== "operator") throw forbidden();
  const month = monthPath(ctx.params.month);
  refuseAnyKey(ctx.body);
  const invoices = await tx(async (client) => {
    await lockMonths(client, s.kitchen.id, [month], "exclusive");
    if (await isClosed(client, s.kitchen.id, month)) throw variantError(409, "month_closed", [monthName(month)]);
    const pending = await client.query("SELECT 1 FROM billing_items WHERE kitchen_id = $1 AND month = $2 AND recorded_at IS NULL LIMIT 1", [s.kitchen.id, month]);
    if (pending.rows.length) throw apiError(409, "billing_pending");
    if (!(await probeBilling())) throw billingUnavailable();
    const { rows: members } = await client.query(
      `SELECT m.id, m.email, m.business_name, k.kb_invoice_id, k.committed_at
       FROM members m JOIN kb_invoices k ON k.member_id = m.id AND k.month = $2
       WHERE m.kitchen_id = $1 AND EXISTS (SELECT 1 FROM billing_items i WHERE i.member_id = m.id AND i.month = $2) ORDER BY m.id`,
      [s.kitchen.id, month],
    );
    // Read every member's Kill Bill invoice back before the first commit; any difference refuses the whole close.
    const { rows: all } = await client.query(
      `SELECT m.id, m.business_name, k.kb_invoice_id FROM members m LEFT JOIN kb_invoices k ON k.member_id = m.id AND k.month = $2
       WHERE m.kitchen_id = $1 ORDER BY m.id`,
      [s.kitchen.id, month],
    );
    const differing: Array<{ id: string; business_name: string }> = [];
    for (const m of all) {
      let billed: number;
      try {
        billed = await killBillAmount(m.id, month, m.kb_invoice_id ?? null);
      } catch (error) {
        if (error instanceof BillingDown) throw billingUnavailable();
        throw error;
      }
      if (billed !== total(await invoiceLines(client, m.id, month))) differing.push(m);
    }
    if (differing.length) {
      differing.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      throw variantError(409, "billing_mismatch", [differing[0]!.business_name], { members: differing.map((m) => m.id) });
    }
    for (const m of members) {
      if (m.committed_at) continue;
      try {
        await commitInvoice(m.kb_invoice_id);
      } catch (error) {
        if (error instanceof BillingDown) throw billingUnavailable();
        throw error;
      }
      // Recorded outside this transaction: a commit that Kill Bill accepted stays recorded even if a later one fails.
      await pool.query("UPDATE kb_invoices SET committed_at = now() WHERE member_id = $1 AND month = $2", [m.id, month]);
    }
    await client.query("INSERT INTO closed_months (kitchen_id, month) VALUES ($1, $2)", [s.kitchen.id, month]);
    await client.query(
      `INSERT INTO close_time_names (kitchen_id, month, member_id, business_name) SELECT kitchen_id, $2, id, business_name FROM members WHERE kitchen_id = $1`,
      [s.kitchen.id, month],
    );
    const { rows: everyone } = await client.query("SELECT id FROM members WHERE kitchen_id = $1 ORDER BY id", [s.kitchen.id]);
    for (const m of everyone) await freeze(client, s.kitchen.id, month, "invoice", m.id, await invoiceText(client, s.kitchen.id, m.id, month));
    await freeze(client, s.kitchen.id, month, "report", "", await utilisationText(client, s.kitchen.id, month));
    await freeze(client, s.kitchen.id, month, "csv", "", await usageCsvText(client, s.kitchen.id, month));
    const out = [];
    for (const m of members) {
      const lines = await invoiceLines(client, m.id, month);
      // The published body, line for line (joined by CRLF on delivery), with nothing before or after.
      await queueMail(client, m.email, `Statement for ${monthName(month)}: ${m.business_name}`, [
        `Statement for ${monthName(month)}`, m.business_name, "",
        ...lines.map((l) => `${l.description} ${money(l.amountCents)}`), "", `Total ${money(total(lines))}`,
      ]);
      out.push({ memberId: m.id, totalCents: total(lines) });
    }
    return out;
  });
  return { status: 200, body: { month, invoices } };
});
