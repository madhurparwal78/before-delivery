import { pool } from "../db.js";
import type { InvoiceRow, User } from "../domain.js";
import { json, route } from "../http.js";
import { invoiceAmounts } from "../killbill.js";
import { INVOICE_COLUMNS, invoiceFor, kitchenMembers } from "../store.js";
import { authed } from "../validate.js";
import { invoiceView } from "../views.js";

/** Live billing amounts for the members owning these invoices; null while billing is down. */
async function billingAmountsFor(user: User, invoices: InvoiceRow[]): Promise<Map<string, number> | null> {
  const owners = new Set(invoices.filter((i) => i.killbill_invoice_id !== null).map((i) => i.member_id));
  if (owners.size === 0) return new Map();
  const accounts = (await kitchenMembers(user.kitchen_id))
    .filter((m) => owners.has(m.id))
    .flatMap((m) => (m.killbill_account_id ? [m.killbill_account_id] : []));
  return invoiceAmounts(accounts);
}

route(
  "GET",
  "/api/invoices",
  authed(async (_request, user) => {
    const found = await pool.query<InvoiceRow>(
      `SELECT ${INVOICE_COLUMNS} FROM invoices
        WHERE kitchen_id = $1 AND ($2::text IS NULL OR member_id = $2) ORDER BY issued_at DESC, ref DESC`,
      [user.kitchen_id, user.role === "member" ? user.member_id : null],
    );
    const amounts = await billingAmountsFor(user, found.rows);
    return json(200, { invoices: found.rows.map((i) => invoiceView(i, amounts)) });
  }),
);

route(
  "GET",
  "/api/invoices/:invoice_id",
  authed(async (request, user) => {
    const invoice = await invoiceFor(user, request.params.invoice_id ?? "");
    return json(200, { invoice: invoiceView(invoice, await billingAmountsFor(user, [invoice])) });
  }),
);
