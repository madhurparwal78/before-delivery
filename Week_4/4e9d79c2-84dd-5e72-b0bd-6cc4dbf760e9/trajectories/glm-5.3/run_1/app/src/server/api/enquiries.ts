import type { Express, Request, Response } from "express";
import type { Ctx } from "../app.js";
import { requireAuth } from "./auth.js";
import { errors } from "../errors.js";
import { readJson } from "../http.js";
import { enquiryById, stopsForEnquiry, enquiryRow, isoDate } from "../repo.js";
import { isoInstant } from "../domain.js";
import { foldEmail, foldTelephone } from "../domain.js";

export function registerEnquiryApi(app: Express, ctx: Ctx): void {
  app.get("/api/enquiries", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const state = typeof req.query.state === "string" && req.query.state ? req.query.state : "";
    const occasion = typeof req.query.occasion === "string" && req.query.occasion ? req.query.occasion : "";
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const after = typeof req.query.after === "string" ? req.query.after : "";
    const before = typeof req.query.before === "string" ? req.query.before : "";
    if (q.length > 200) throw errors.invalid({ q: "Search text can be up to 200 characters." });
    if (state && !["new", "priced", "quoted", "won", "lost"].includes(state)) throw errors.invalid({ state: "We can't find that." });
    const params: unknown[] = [deskId];
    let where = "e.desk_id=$1";
    if (state) {
      params.push(state);
      where += ` AND e.state=$${params.length}`;
    }
    if (occasion) {
      params.push(occasion);
      where += ` AND e.occasion=$${params.length}`;
    }
    if (q) {
      params.push("%" + q.toLowerCase() + "%");
      where += ` AND (LOWER(e.reference) LIKE $${params.length} OR LOWER(COALESCE(c.name,'')) LIKE $${params.length} OR LOWER(COALESCE(e.email,'')) LIKE $${params.length})`;
    }
    const orderBy = "ORDER BY e.created_at DESC, e.reference DESC";
    let cursorWhere = "";
    if (after) {
      const [aAt, aRef] = decodeCursor(after);
      params.push(new Date(aAt), aRef);
      cursorWhere += ` AND (e.created_at, e.reference) < ($${params.length - 1}, $${params.length})`;
    }
    if (before) {
      const [bAt, bRef] = decodeCursor(before);
      params.push(new Date(bAt), bRef);
      cursorWhere += ` AND (e.created_at, e.reference) > ($${params.length - 1}, $${params.length})`;
    }
    const r = await ctx.db.query(
      `SELECT e.*, c.name AS customer_name FROM enquiries e LEFT JOIN customers c ON c.id=e.customer_id AND c.desk_id=e.desk_id
       WHERE ${where}${cursorWhere} ${orderBy} LIMIT 26`,
      params
    );
    const rows = r.rows.map((x) => ({ ...x, reference: String(x.reference) }));
    const page = rows.slice(0, 25).map(enquiryListOut);
    let nextCursor: string | null = null;
    let prevCursor: string | null = null;
    if (rows.length === 26) {
      const last = rows[24];
      nextCursor = encodeCursor(String(last.created_at.toISOString()), String(last.reference));
    }
    if (after) {
      const first = rows[0];
      if (first) prevCursor = encodeCursor(String((first.created_at as Date).toISOString()), String(first.reference));
    }
    res.json({ enquiries: page, nextCursor, prevCursor });
  });

  app.get("/api/enquiries/merge", (_req: Request, res: Response) => {
    res.json({ enquiries: [] });
  });

  app.get("/api/enquiries/:id", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    const stops = await stopsForEnquiry(ctx.db, e.id);
    const customer = e.customerId
      ? await ctx.db.query("SELECT name, email, telephone, language FROM customers WHERE desk_id=$1 AND id=$2", [deskId, e.customerId])
      : null;
    res.json({
      id: e.id,
      reference: e.reference,
      customerName: customer?.rows[0]?.name ?? e.name ?? "",
      occasion: e.occasion,
      state: e.state,
      journeyType: e.journeyType,
      stops,
      departAt: { date: e.departDate, time: e.departTime },
      departInstant: isoInstant(e.departInstant),
      returnAt: e.returnDate && e.returnTime ? { date: e.returnDate, time: e.returnTime } : null,
      returnInstant: e.returnInstant ? isoInstant(e.returnInstant) : null,
      party: { people: e.people, large: e.large, medium: e.medium, hand: e.hand, wheelchairs: e.wheelchairs },
      details: e.details,
      email: e.email ?? customer?.rows[0]?.email ?? null,
      telephone: e.telephone ?? customer?.rows[0]?.telephone ?? null,
      language: e.language,
      submittedBody: e.submittedBody,
      mergedReferences: e.mergedReferences,
      duplicates: e.duplicates,
      createdAt: isoInstant(e.createdAt),
    });
  });

  app.patch("/api/enquiries/:id", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    const body = (await readJson(req)) as Record<string, unknown>;
    const state = typeof body.state === "string" ? body.state : "";
    if (!["new", "priced", "quoted", "won", "lost"].includes(state)) throw errors.invalid({ state: "We can't find that." });
    if (state === e.state) {
      res.json(enquiryListOutFrom(e));
      return;
    }
    const legal: Record<string, string[]> = {
      new: ["priced", "lost"],
      priced: ["new", "quoted", "lost"],
      quoted: ["priced", "won", "lost"],
      won: ["lost"],
      lost: ["new"],
    };
    if (!(legal[e.state] ?? []).includes(state)) {
      throw errors.state("illegalChange", "That did not save. Try again.");
    }
    await ctx.db.query("UPDATE enquiries SET state=$1 WHERE desk_id=$2 AND id=$3", [state, deskId, e.id]);
    const hire = await ctx.db.query("SELECT id FROM hires WHERE desk_id=$1 AND reference=$2", [deskId, e.reference]);
    if (hire.rows[0]) await ctx.db.query("UPDATE hires SET enquiry_state=$1 WHERE desk_id=$2 AND reference=$3", [state, deskId, e.reference]);
    const after = await enquiryById(ctx.db, deskId, e.id);
    res.json(enquiryListOutFrom(after ?? e));
  });

  app.post("/api/enquiries/merge", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const body = (await readJson(req)) as Record<string, unknown>;
    const ids = Array.isArray(body.enquiryIds) ? body.enquiryIds.map(String) : [];
    if (ids.length !== 2) throw errors.invalid({ enquiryIds: "We can't find that." });
    const a = await enquiryById(ctx.db, deskId, ids[0]);
    const b = await enquiryById(ctx.db, deskId, ids[1]);
    if (!a || !b || a.id === b.id) throw errors.notFound();
    const sameEmail = !!a.email && foldEmail(a.email) === foldEmail(b.email ?? "");
    const sameTel = !!a.telephone && foldTelephone(a.telephone) === foldTelephone(b.telephone ?? "");
    if (!sameEmail && !sameTel) throw errors.state("notDuplicates", "We can't find that.");
    const earlier = a.createdAt <= b.createdAt ? a : b;
    const later = a.createdAt <= b.createdAt ? b : a;
    await ctx.db.query(
      "UPDATE enquiries SET merged_references = array_append(merged_references, $1) WHERE desk_id=$2 AND id=$3",
      [later.reference, deskId, earlier.id]
    );
    await ctx.db.query("DELETE FROM enquiry_stops WHERE enquiry_id=$1", [later.id]);
    await ctx.db.query("DELETE FROM enquiries WHERE desk_id=$1 AND id=$2", [deskId, later.id]);
    res.json({ kept: earlier.reference, merged: [later.reference] });
  });
}

function enquiryListOut(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(r.id),
    reference: String(r.reference),
    customerName: String(r.customer_name ?? r.name ?? ""),
    occasion: String(r.occasion),
    state: String(r.state),
    departAt: { date: isoDate(r.depart_date), time: String(r.depart_time) },
    departInstant: isoInstant(r.depart_instant as Date),
    createdAt: isoInstant(r.created_at as Date),
  };
}

function enquiryListOutFrom(e: ReturnType<typeof enquiryRow>): Record<string, unknown> {
  return {
    id: e.id,
    reference: e.reference,
    customerName: e.name ?? "",
    occasion: e.occasion,
    state: e.state,
    departAt: { date: e.departDate, time: e.departTime },
    departInstant: isoInstant(e.departInstant),
    createdAt: isoInstant(e.createdAt),
  };
}

function encodeCursor(at: string, reference: string): string {
  return Buffer.from(`${at}|${reference}`).toString("base64url");
}

function decodeCursor(cursor: string): [string, string] {
  const parts = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  if (parts.length !== 2) throw errors.invalid({ cursor: "We can't find that." });
  return [parts[0], parts[1]];
}
