// Cut tickets at the saw, their stored PDFs, and invoices.
import type { User } from "../../shared/api";
import { volumeMm3, zonesWithin, type TicketStatus } from "../../shared/domain";
import { one, pool, withTransaction } from "../db";
import { ApiError, isObject, isStaff, ok, requireRole, requireUser, route, type Context } from "../http";
import { Unreachable } from "../services";
import { getObject } from "../storage";
import { boardRow, invoicesWhere, notFound, now, publicInvoice, publicTicket, ticketsWhere, writeMovement } from "../store";

/** A ticket loads for its maker and the yard staff; any other maker gets not_found. */
async function readableTicket(user: User, id: string) {
  const [ticket] = await ticketsWhere(pool, "t.id = $1", [id]);
  if (ticket === undefined || (!isStaff(user) && ticket.makerId !== user.id)) notFound();
  return ticket;
}

route("GET", "/api/tickets", async (ctx) => {
  const user = requireUser(ctx);
  const status = ctx.url.searchParams.get("status");
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (!isStaff(user)) {
    params.push(user.id);
    clauses.push(`t.maker_id = $${params.length}`);
  }
  if (status !== null && status !== "") {
    params.push(status);
    clauses.push(`t.status = $${params.length}`);
  }
  const tickets = await ticketsWhere(pool, clauses.length ? clauses.join(" AND ") : "TRUE", params);
  return ok({ tickets: tickets.map(publicTicket) });
});

route("GET", "/api/tickets/:id", async (ctx) => {
  const user = requireUser(ctx);
  return ok({ ticket: publicTicket(await readableTicket(user, ctx.params["id"] ?? "")) });
});

route("GET", "/api/tickets/:id/pdf", async (ctx) => {
  const user = requireUser(ctx);
  const ticket = await readableTicket(user, ctx.params["id"] ?? "");
  try {
    const { bytes } = await getObject(ticket.pdf_key);
    return { status: 200, raw: { bytes, contentType: "application/pdf", headers: { "Content-Disposition": `inline; filename="${ticket.id}.pdf"` } } };
  } catch (error) {
    if (error instanceof Unreachable) throw new ApiError("storage_unavailable");
    throw error;
  }
});

interface LockedTicket {
  id: string;
  status: TicketStatus;
  offcut_tag: string | null;
  planned_mm: number | null;
}

async function sawStep(ctx: Context, from: TicketStatus) {
  const user = requireUser(ctx);
  const id = ctx.params["id"] ?? "";
  await readableTicket(user, id);
  requireRole(user, "owner", "hand");
  const body = isObject(ctx.body) ? ctx.body : {};
  await withTransaction(async (db) => {
    const t = await one<LockedTicket>(db, "SELECT id, status, offcut_tag, planned_mm FROM tickets WHERE id = $1 FOR UPDATE", [id]);
    if (t === undefined) notFound();
    if (t.status !== from) throw new ApiError("ticket_state");
    const at = now();
    if (from === "issued") {
      await db.query("UPDATE tickets SET status = 'at-saw' WHERE id = $1", [id]);
      await db.query("INSERT INTO ticket_events (ticket_id, kind, by_user, at) VALUES ($1, 'started', $2, $3)", [id, user.id, at]);
      return;
    }
    const measured = body["offcut_mm"];
    if (t.offcut_tag === null || t.planned_mm === null) {
      if (measured !== undefined) throw new ApiError("validation", { offcut_mm: "This ticket has no offcut." });
    } else if (typeof measured !== "number" || !Number.isInteger(measured) || measured < 1 || measured > t.planned_mm) {
      throw new ApiError("validation", { offcut_mm: `Enter the measured offcut from 1 to ${t.planned_mm} mm.` });
    }
    await db.query("UPDATE tickets SET status = 'done', measured_mm = $2 WHERE id = $1", [id, typeof measured === "number" ? measured : null]);
    if (t.offcut_tag !== null && t.planned_mm !== null && typeof measured === "number") {
      const offcut = await boardRow(db, t.offcut_tag, true);
      if (offcut === undefined) notFound();
      await db.query("UPDATE boards SET length_mm = $2, defects = $3 WHERE tag = $1",
        [offcut.tag, measured, JSON.stringify(zonesWithin(offcut.defects, 0, measured))]);
      const shortfall = t.planned_mm - measured;
      if (shortfall > 0) {
        const v = volumeMm3(offcut.thickness_mm, offcut.width_mm, shortfall);
        await writeMovement(db, "trim", id, user.id, [{ account: `board:${offcut.tag}`, volume_mm3: -v }, { account: "kerf", volume_mm3: v }], at);
      }
    }
    await db.query("INSERT INTO ticket_events (ticket_id, kind, by_user, at) VALUES ($1, 'done', $2, $3)", [id, user.id, at]);
  });
  return ok({ ticket: publicTicket(await readableTicket(user, id)) });
}

route("POST", "/api/tickets/:id/start", (ctx) => sawStep(ctx, "issued"));
route("POST", "/api/tickets/:id/done", (ctx) => sawStep(ctx, "at-saw"));

route("GET", "/api/invoices", async (ctx) => {
  const user = requireUser(ctx);
  requireRole(user, "maker", "owner");
  const invoices = user.role === "owner" ? await invoicesWhere(pool, "TRUE", []) : await invoicesWhere(pool, "maker_id = $1", [user.id]);
  return ok({ invoices: invoices.map(publicInvoice) });
});

route("GET", "/api/invoices/:id", async (ctx) => {
  const user = requireUser(ctx);
  const [invoice] = await invoicesWhere(pool, "id = $1", [ctx.params["id"] ?? ""]);
  if (invoice === undefined || (user.role === "maker" && invoice.makerId !== user.id)) notFound();
  requireRole(user, "maker", "owner");
  return ok({ invoice: publicInvoice(invoice) });
});
