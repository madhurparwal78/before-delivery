import type { Route, Ctx } from "../http.js";
import { query, type Row } from "../db.js";
import { errors, validationError } from "../errors.js";
import { invoiceJson, creditNoteJson } from "../services/shapes.js";


export function groupRoutes(): Route[] {
  // Group bookers see only their own organisation; finance may read every one.
  const dashboard: Route = {
    method: "GET",
    pattern: "/api/group/dashboard",
    roles: ["group_booker", "finance"],
    bodyLimit: "none",
    async handler(ctx) {
      const user = ctx.user!;
      const orgId = user.organisation_id;
      if (!orgId) throw errors.notFound();
      const org = (await query("select * from organisations where id = $1", [orgId])).rows[0];
      const orders = await query("select count(*) as n from orders where organisation_id = $1", [orgId]);
      const tickets = await query("select count(*) as n from lines where order_id in (select id from orders where organisation_id = $1)", [orgId]);
      const invoiced = await query("select coalesce(sum(amount_cents),0) as n from invoices where organisation_id = $1", [orgId]);
      const credited = await query("select coalesce(sum(amount_cents),0) as n from credit_notes where invoice_id in (select id from invoices where organisation_id = $1)", [orgId]);
      const paid = await query("select coalesce(sum(paid_cents),0) as n from invoices where organisation_id = $1", [orgId]);
      const outstanding = await query("select coalesce(sum(balance_cents),0) as n from invoices where organisation_id = $1", [orgId]);
      return {
        status: 200,
        body: {
          organisation: { id: String(org.id), name: String(org.name) },
          orders: Number(orders.rows[0].n),
          tickets: Number(tickets.rows[0].n),
          invoiced_cents: Number(invoiced.rows[0].n),
          credited_cents: Number(credited.rows[0].n),
          paid_cents: Number(paid.rows[0].n),
          outstanding_cents: Number(outstanding.rows[0].n),
        },
      };
    },
  };

  const attendees: Route = {
    method: "GET",
    pattern: "/api/group/attendees",
    roles: ["group_booker", "finance"],
    bodyLimit: "none",
    async handler(ctx) {
      const user = ctx.user!;
      const orgId = user.organisation_id;
      if (!orgId) throw errors.notFound();
      const q = (ctx.query.get("q") ?? "").trim();
      if (q.length < 2) throw validationError({ q: "too_short" });
      const res = await query(
        `select l.*, o.id as order_ref from lines l join orders o on o.id = l.order_id
         where o.organisation_id = $1 and lower(l.holder_name) like '%' || lower($2) || '%'
         order by o.created_at, l.position`,
        [orgId, q],
      );
      return {
        status: 200,
        body: {
          attendees: res.rows.map((l: Row) => ({
            name: String(l.holder_name),
            order_ref: String(l.order_ref),
            line_id: Number(l.id),
            item_title: String(l.title),
            state: String(l.state),
          })),
        },
      };
    },
  };

  const exportCsv: Route = {
    method: "GET",
    pattern: "/api/group/export.csv",
    roles: ["group_booker", "finance"],
    bodyLimit: "none",
    async handler(ctx) {
      const user = ctx.user!;
      const orgId = user.organisation_id;
      if (!orgId) throw errors.notFound();
      const res = await query(
        `select l.*, o.id as order_ref, i.id as invoice_id, i.amount_cents as invoice_amount
         from lines l
         join orders o on o.id = l.order_id
         left join invoices i on i.order_id = o.id
         where o.organisation_id = $1
         order by o.created_at, l.position`,
        [orgId],
      );
      const header = "order_ref,attendee_name,item,festival_day,list_eur,group_discount_eur,voucher_eur,invoiced_eur,state";
      const rows = res.rows.map((l: Row) => {
        const festivalDay = l.festival_day === null || l.festival_day === undefined ? "" : String(l.festival_day);
        const invoicedEur = l.invoice_id === null || l.invoice_id === undefined
          ? "0.00"
          : (Number(l.invoice_amount) / 100).toFixed(2);
        return [
          String(l.order_ref),
          String(l.holder_name),
          String(l.title),
          festivalDay,
          (Number(l.list_cents) / 100).toFixed(2),
          (Number(l.group_discount_cents) / 100).toFixed(2),
          (Number(l.voucher_cents) / 100).toFixed(2),
          invoicedEur,
          String(l.state),
        ].join(",");
      });
      const csv = `${header}\n${rows.join("\n")}\n`;
      return {
        status: 200,
        body: Buffer.from(csv, "utf8"),
        headers: { "Content-Type": "text/csv; charset=utf-8" },
      };
    },
  };

  const listInvoices: Route = {
    method: "GET",
    pattern: "/api/invoices",
    roles: ["group_booker", "finance"],
    bodyLimit: "none",
    async handler(ctx) {
      const user = ctx.user!;
      const res = user.role === "finance"
        ? await query("select * from invoices order by issued_at")
        : await query("select * from invoices where organisation_id = $1 order by issued_at", [user.organisation_id]);
      const invoices = [];
      for (const row of res.rows) invoices.push(await invoiceJson(row));
      return { status: 200, body: { invoices } };
    },
  };

  const invoiceDetail: Route = {
    method: "GET",
    pattern: "/api/invoices/:id",
    roles: ["group_booker", "finance"],
    bodyLimit: "none",
    async handler(ctx) {
      const res = await query("select * from invoices where id = $1", [ctx.params.id]);
      const invoice = res.rows[0];
      if (!invoice) throw errors.notFound();
      if (ctx.user!.role !== "finance" && String(invoice.organisation_id) !== ctx.user!.organisation_id) {
        throw errors.notFound();
      }
      return { status: 200, body: await invoiceJson(invoice) };
    },
  };

  const creditNoteDetail: Route = {
    method: "GET",
    pattern: "/api/credit-notes/:id",
    roles: ["group_booker", "finance"],
    bodyLimit: "none",
    async handler(ctx) {
      const res = await query("select * from credit_notes where id = $1", [ctx.params.id]);
      const note = res.rows[0];
      if (!note) throw errors.notFound();
      const invoice = (await query("select * from invoices where id = $1", [String(note.invoice_id)])).rows[0];
      if (ctx.user!.role !== "finance" && String(invoice.organisation_id) !== ctx.user!.organisation_id) {
        throw errors.notFound();
      }
      return { status: 200, body: await creditNoteJson(note) };
    },
  };

  return [dashboard, attendees, exportCsv, listInvoices, invoiceDetail, creditNoteDetail];
}
