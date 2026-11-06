import express, { type Request, type Response } from "express";
import type { Db } from "../db/schema.js";
import { Errors } from "../errors.js";
import { newId } from "../identity.js";
import { utcIso } from "../times.js";
import * as money from "../money.js";
import { EventLog } from "../events.js";
import { costsAt } from "../domain.js";
import { withJob } from "./shared.js";

export function createCostsRouter(db: Db): express.Router {
  const router = express.Router();

  router.get("/jobs/:jobId/costs", async (req: Request, res: Response) => {
    const costs = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner" && ctx.membership.role !== "lead") throw Errors.forbidden();
      let asOf: Date;
      const raw = req.query.as_of;
      if (raw === undefined || raw === "") {
        asOf = new Date();
      } else {
        const parsed = new Date(String(raw));
        if (Number.isNaN(parsed.getTime())) throw Errors.validation({ as_of: "Give the moment as a UTC time." });
        asOf = parsed;
      }
      return costsAt(ctx.client, ctx.jobId, asOf);
    });
    res.json(costs);
  });

  router.put("/jobs/:jobId/contingency", async (req: Request, res: Response) => {
    const body = req.body as { percent?: unknown };
    const percent = typeof body.percent === "string" ? money.parseDecimal(body.percent) : null;
    if (percent === null || percent.int < 0n || percent.int > 2500n) {
      throw Errors.validation({ percent: "Contingency is 0.00 to 25.00 percent." });
    }
    const result = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner") throw Errors.forbidden();
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const now = new Date();
      await ctx.client.query(
        `INSERT INTO contingency_settings (job_id, effective_at, percent) VALUES ($1, $2, $3)
         ON CONFLICT (job_id, effective_at) DO UPDATE SET percent = $3`,
        [ctx.jobId, now.toISOString(), money.fmtFixed(percent, 2)],
      );
      await new EventLog(ctx.client).emit(ctx.jobId, "costs", {});
      return { percent: money.fmtFixed(percent, 2), effective_at: utcIso(now) };
    });
    res.json(result);
  });

  router.get("/jobs/:jobId/change-orders", async (req: Request, res: Response) => {
    const changeOrders = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner" && ctx.membership.role !== "lead") throw Errors.forbidden();
      const rows = await ctx.client.query(
        `SELECT id, description, amount::text AS amount, status, created_at, approved_at FROM change_orders
         WHERE job_id = $1 ORDER BY created_at, id`,
        [ctx.jobId],
      );
      return rows.rows.map((r) => ({
        id: r.id,
        description: r.description,
        amount: r.amount,
        status: r.status,
        created_at: utcIso(r.created_at),
        approved_at: r.approved_at === null ? null : utcIso(r.approved_at),
      }));
    });
    res.json({ change_orders: changeOrders });
  });

  router.post("/jobs/:jobId/change-orders", async (req: Request, res: Response) => {
    const body = req.body as { description?: unknown; amount?: unknown };
    const fields: Record<string, string> = {};
    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (description.length < 1 || description.length > 200) fields.description = "Give the change order a description.";
    const amount = typeof body.amount === "string" ? money.parseAmountField(body.amount) : null;
    if (amount === null) fields.amount = "Amounts run from -99999.99 to 99999.99, never zero.";
    if (Object.keys(fields).length > 0) throw Errors.validation(fields);

    const id = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner" && ctx.membership.role !== "lead") throw Errors.forbidden();
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const changeOrderId = newId("co");
      await ctx.client.query(
        `INSERT INTO change_orders (id, job_id, description, amount) VALUES ($1, $2, $3, $4)`,
        [changeOrderId, ctx.jobId, description, amount!.display],
      );
      await new EventLog(ctx.client).emit(ctx.jobId, "costs", {});
      return changeOrderId;
    });
    const row = await db.query(`SELECT id, description, amount::text AS amount, status, created_at, approved_at FROM change_orders WHERE id = $1`, [id]);
    const r = row.rows[0]!;
    res.status(201).json({
      id: r.id,
      description: r.description,
      amount: r.amount,
      status: r.status,
      created_at: utcIso(r.created_at),
      approved_at: null,
    });
  });

  router.post("/jobs/:jobId/change-orders/:id/approve", async (req: Request, res: Response) => {
    const result = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner") throw Errors.forbidden();
      if (ctx.jobStatus === "closed_out") throw Errors.jobClosed();
      const row = await ctx.client.query<{ id: string; status: string }>(
        `SELECT id, status FROM change_orders WHERE job_id = $1 AND id = $2`,
        [ctx.jobId, req.params.id],
      );
      const order = row.rows[0];
      if (order === undefined) throw Errors.notFound();
      if (order.status !== "pending") throw Errors.invalidTransition();
      const now = new Date();
      await ctx.client.query(`UPDATE change_orders SET status = 'approved', approved_at = $2 WHERE id = $1`, [order.id, now.toISOString()]);
      await new EventLog(ctx.client).emit(ctx.jobId, "costs", {});
      return order.id;
    });
    const row = await db.query(`SELECT id, description, amount::text AS amount, status, created_at, approved_at FROM change_orders WHERE id = $1`, [result]);
    const r = row.rows[0]!;
    res.json({
      id: r.id,
      description: r.description,
      amount: r.amount,
      status: r.status,
      created_at: utcIso(r.created_at),
      approved_at: r.approved_at === null ? null : utcIso(r.approved_at),
    });
  });

  router.get("/jobs/:jobId/outbox", async (req: Request, res: Response) => {
    const entries = await withJob(req, db, req.params.jobId, async (ctx) => {
      if (ctx.membership.role !== "owner") throw Errors.forbidden();
      const rows = await ctx.client.query(
        `SELECT id, kind, to_email, subject, status, created_at, sent_at FROM outbox WHERE job_id = $1 ORDER BY created_at DESC, id`,
        [ctx.jobId],
      );
      return rows.rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        to: r.to_email,
        subject: r.subject,
        status: r.status,
        created_at: utcIso(r.created_at),
        sent_at: r.sent_at === null ? null : utcIso(r.sent_at),
      }));
    });
    res.json({ entries });
  });

  return router;
}
