import type { Express, Request, Response } from "express";
import type { Ctx } from "../app.js";
import { requireAuth } from "./auth.js";
import { errors } from "../errors.js";
import { readJson, readText } from "../http.js";
import { foldEmail, foldTelephone } from "../domain.js";
import { parseCsv } from "../csv.js";
import { tx } from "../repo.js";
import { addDays } from "../uktime.js";

export function registerCustomerApi(app: Express, ctx: Ctx): void {
  app.get("/api/customers", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const state = typeof req.query.state === "string" ? req.query.state : "active";
    const params: unknown[] = [deskId];
    let where = "desk_id=$1 AND state=$2";
    params.push(state);
    if (q.length > 200) throw errors.invalid({ q: "Search text can be up to 200 characters." });
    if (q) {
      where += " AND (LOWER(name) LIKE $3 OR LOWER(COALESCE(email,'')) LIKE $3)";
      params.push("%" + q.toLowerCase() + "%");
    }
    const r = await ctx.db.query(`SELECT * FROM customers WHERE ${where} ORDER BY name LIMIT 200`, params);
    res.json({ customers: r.rows.map(customerOut) });
  });

  app.post("/api/customers", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const body = (await readJson(req)) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const telephone = typeof body.telephone === "string" ? body.telephone.trim() : "";
    const language = body.language === "pl" || body.language === "ur" ? body.language : "en";
    const f: Record<string, string> = {};
    if (!name) f.name = "Enter your name.";
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) f.email = "Enter a real email address.";
    if (telephone && telephone.replace(/\D/g, "").length < 10) f.telephone = "Enter a UK telephone number.";
    if (Object.keys(f).length) throw errors.invalid(f);
    const id = "CU-" + Date.now().toString(36).toUpperCase();
    await ctx.db.query(
      "INSERT INTO customers (id, desk_id, name, email, telephone, language, state, email_folded, telephone_folded) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)",
      [id, deskId, name, email || null, telephone || null, language, email ? foldEmail(email) : null, telephone ? foldTelephone(telephone) : null]
    );
    res.status(201).json(customerOut({ id, name, email, telephone, language, state: "active" }));
  });

  app.get("/api/customers/review", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const r = await ctx.db.query("SELECT row_number AS row, message FROM sheet_review WHERE desk_id=$1 ORDER BY created_at DESC LIMIT 100", [deskId]);
    res.json({ reviewList: r.rows.map((x) => ({ row: Number(x.row), message: String(x.message) })) });
  });

  app.get("/api/customers/:id", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const r = await ctx.db.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    if (!r.rows[0] || r.rows[0].state === "erased") throw errors.notFound();
    res.json(customerOut(r.rows[0]));
  });

  app.patch("/api/customers/:id", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const body = (await readJson(req)) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) throw errors.invalid({ name: "Enter your name." });
    const r = await ctx.db.query("UPDATE customers SET name=$3 WHERE desk_id=$1 AND id=$2 RETURNING *", [deskId, req.params.id, name]);
    if (!r.rows[0]) throw errors.notFound();
    res.json(customerOut(r.rows[0]));
  });

  app.delete("/api/customers/:id", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const id = req.params.id;
    const r = await ctx.db.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2", [deskId, id]);
    if (!r.rows[0]) throw errors.notFound();
    const hire = await ctx.db.query("SELECT 1 FROM hires WHERE desk_id=$1 AND customer_id=$2", [deskId, id]);
    if (hire.rows.length) throw errors.state("customerHasHire", "This customer has a hire, so it can't be removed.");
    await ctx.db.query("DELETE FROM customers WHERE desk_id=$1 AND id=$2", [deskId, id]);
    res.status(204).end();
  });

  app.post("/api/customers/:id/close", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    void req.body;
    const r = await ctx.db.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    if (!r.rows[0]) throw errors.notFound();
    if (r.rows[0].state !== "active") throw errors.state("alreadyClosed", "Customer closed.");
    const waitSeconds = ctx.cfg.closureWaitSeconds;
    await ctx.db.query("UPDATE customers SET state='closed', closed_at=NOW(), erase_at=NOW() + ($1 || ' seconds')::interval WHERE desk_id=$2 AND id=$3", [
      String(waitSeconds),
      deskId,
      req.params.id,
    ]);
    const after = await ctx.db.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    res.json(customerOut(after.rows[0]));
  });

  app.post("/api/customers/:id/bring-back", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    void req.body;
    const r = await ctx.db.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    if (!r.rows[0]) throw errors.notFound();
    if (r.rows[0].state === "active") throw errors.state("alreadyActive", "Customer brought back.");
    if (r.rows[0].state !== "closed") throw errors.state("waitOver", "The wait is over. This customer can't be brought back.");
    await ctx.db.query("UPDATE customers SET state='active', closed_at=NULL, erase_at=NULL WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    const after = await ctx.db.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2", [deskId, req.params.id]);
    res.json(customerOut(after.rows[0]));
  });

  app.post("/api/customers/import", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
    if (type !== "text/csv") throw errors.unsupportedType();
    const text = await readText(req, 2_000_000);
    const parsed = parseCsv(text, ["Name", "Email", "Telephone", "Notes"]);
    if (!parsed) throw errors.invalid({ file: "The first line has to read Name,Email,Telephone,Notes." }, "The first line has to read Name,Email,Telephone,Notes.");
    let added = 0;
    let filled = 0;
    const reviewList: { row: number; message: string }[] = [];
    await tx(ctx.db, async (client) => {
      for (let i = 0; i < parsed.rows.length; i++) {
        const cells = parsed.rows[i];
        const name = (cells[0] ?? "").trim();
        const email = (cells[1] ?? "").trim();
        const telephone = (cells[2] ?? "").trim();
        const notes = (cells[3] ?? "").trim();
        if (!name && !email && !telephone) continue;
        const matches = await client.query(
          "SELECT * FROM customers WHERE desk_id=$1 AND ((email_folded IS NOT NULL AND email_folded=$2) OR (telephone_folded IS NOT NULL AND telephone_folded=$3)) AND state<>'erased'",
          [deskId, email ? foldEmail(email) : "", telephone ? foldTelephone(telephone) : ""]
        );
        if (matches.rows.length === 0) {
          const id = "CU-" + Date.now().toString(36).toUpperCase() + i;
          await client.query(
            "INSERT INTO customers (id, desk_id, name, email, telephone, notes, state, email_folded, telephone_folded) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)",
            [id, deskId, name, email || null, telephone || null, notes || null, email ? foldEmail(email) : null, telephone ? foldTelephone(telephone) : null]
          );
          added++;
        } else if (matches.rows.length === 1) {
          const row = matches.rows[0];
          const updates: string[] = [];
          const params: unknown[] = [];
          if (!row.email && email) {
            updates.push("email=$" + (params.push(email) + 2));
            updates.push("email_folded=$" + (params.push(foldEmail(email)) + 1));
          }
          if (!row.telephone && telephone) {
            updates.push("telephone=$" + (params.push(telephone) + 2));
            updates.push("telephone_folded=$" + (params.push(foldTelephone(telephone)) + 1));
          }
          if (updates.length) {
            await client.query(`UPDATE customers SET ${updates.join(", ")} WHERE id=$1`, [row.id, ...params]);
            filled++;
          }
        } else {
          reviewList.push({ row: parsed.rowNumbers[i], message: "Matches two customers" });
          await client.query("INSERT INTO sheet_review (desk_id, row_number, message) VALUES ($1,$2,'Matches two customers') ON CONFLICT DO NOTHING", [
            deskId,
            parsed.rowNumbers[i],
          ]);
        }
      }
    });
    res.json({ added, filled, reviewList });
  });

  void addDays;
}

function customerOut(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    email: (r.email as string | null) ?? null,
    telephone: (r.telephone as string | null) ?? null,
    language: String(r.language ?? "en"),
    notes: (r.notes as string | null) ?? null,
    state: String(r.state ?? "active"),
    closedAt: r.closed_at ? (r.closed_at as Date).toISOString().replace(/\.\d{3}Z$/, "Z") : null,
    eraseAt: r.erase_at ? (r.erase_at as Date).toISOString().replace(/\.\d{3}Z$/, "Z") : null,
  };
}
