import type { Router, Request, Response } from "express";
import type { Services } from "../services.js";
import { errors } from "../errors.js";
import { requirePerson, role, AppRequest, handleRouteError } from "../web.js";
import { runStatement, getStatement } from "../domain/statements.js";
import { coopMidnight, formatCoopDate } from "../../shared/time.js";

// The co-op treasurer: effective-dated commission rates, monthly royalty
// statements and payouts recorded in billing.
export function registerTreasurerRoutes(router: Router, services: Services): void {
  const { sql, clock } = services;

  router.get("/api/commission-rates", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "treasurer");
      const rows = await sql`SELECT effective_from::text AS effective_from, rate_bp FROM commission_rates ORDER BY effective_from ASC`;
      const nowMs = clock.now();
      const todayMidnight = midnightToday(nowMs);
      const rates = rows.map((r) => {
        const effectiveFrom = String(r.effective_from);
        const midnight = coopMidnight(effectiveFrom) ?? 0;
        return {
          effective_from: effectiveFrom,
          rate_bp: Number(r.rate_bp),
          status: midnight > nowMs ? "scheduled" : "past",
        };
      });
      // The current rate is the latest started one.
      const started = rates.filter((r) => r.status !== "scheduled");
      let current: { effective_from: string; rate_bp: number; status: string } | null = null;
      for (const r of started) {
        if (!current || r.effective_from > current.effective_from) current = r;
      }
      if (current) current.status = "current";
      res.status(200).json({
        current: current ? { effective_from: current.effective_from, rate_bp: current.rate_bp } : null,
        rates,
      });
      void todayMidnight;
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  router.post("/api/commission-rates", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "treasurer");
      const raw = (req as AppRequest).rawBody as Record<string, unknown>;
      if (Object.keys(raw).some((k) => k !== "effective_from" && k !== "rate_bp")) {
        const problems: Record<string, string> = {};
        for (const k of Object.keys(raw)) if (k !== "effective_from" && k !== "rate_bp") problems[k] = "Unknown field";
        res.status(422).json(errors.validationFailed(problems).body());
        return;
      }
      const effectiveFrom = raw.effective_from;
      if (typeof effectiveFrom !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || coopMidnight(effectiveFrom) === null) {
        res.status(422).json(errors.validationFailed({ effective_from: "Use YYYY-MM-DD" }).body());
        return;
      }
      const rateBp = raw.rate_bp;
      if (typeof rateBp !== "number" || !Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10000) {
        res.status(422).json(errors.validationFailed({ rate_bp: "Rate must be 0 to 10000 basis points" }).body());
        return;
      }
      // A rate's effective date must be strictly after today's co-op date.
      const nowMs = clock.now();
      const todayMidnight = midnightToday(nowMs);
      const rateMidnight = coopMidnight(effectiveFrom)!;
      if (rateMidnight <= todayMidnight) {
        res.status(422).json(errors.validationFailed({ effective_from: "Effective date must be after today in co-op time" }).body());
        return;
      }
      const clash = await sql`SELECT 1 FROM commission_rates WHERE effective_from::text = ${effectiveFrom}`;
      if (clash.length > 0) {
        res.status(409).json(errors.rateDateTaken().body());
        return;
      }
      await sql`INSERT INTO commission_rates (effective_from, rate_bp) VALUES (${effectiveFrom}, ${rateBp})`;
      res.status(201).json({ effective_from: effectiveFrom, rate_bp: rateBp, status: "scheduled" });
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  router.post("/api/royalty-statements", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "treasurer");
      const raw = (req as AppRequest).rawBody as Record<string, unknown>;
      if (Object.keys(raw).some((k) => k !== "month")) {
        const problems: Record<string, string> = {};
        for (const k of Object.keys(raw)) if (k !== "month") problems[k] = "Unknown field";
        res.status(422).json(errors.validationFailed(problems).body());
        return;
      }
      const month = raw.month;
      if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) {
        res.status(422).json(errors.validationFailed({ month: "Use YYYY-MM" }).body());
        return;
      }
      const result = await runStatement(sql, month, clock.now());
      if (result.status === "invalid") {
        res.status(422).json(errors.validationFailed({ month: "Use YYYY-MM" }).body());
        return;
      }
      if (result.status === "notClosed") {
        res.status(422).json(errors.validationFailed({ month: "That month hasn't closed in co-op time" }).body());
        return;
      }
      if (result.status === "pending") {
        res.status(409).json(errors.invoicesPending().body());
        return;
      }
      res.status(result.status === "created" ? 201 : 200).json(result.statement);
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  router.get("/api/royalty-statements/:month", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "treasurer");
      const statement = await getStatement(sql, req.params.month);
      if (!statement) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      res.status(200).json(statement);
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  router.post("/api/royalty-statements/:month/payouts", async (req: Request, res: Response) => {
    const person = requirePerson(req as AppRequest);
    try {
      role(person, "treasurer");
      const strict = { invalid: false };
      void strict;
      const statement = await getStatement(sql, req.params.month);
      if (!statement) {
        res.status(404).json(errors.notFound().body());
        return;
      }
      const existing = await sql`
        SELECT count(*) AS c FROM payouts WHERE month = ${req.params.month} AND state = 'recorded'`;
      const allRecorded = Number((await sql`
        SELECT count(*) AS total FROM payouts WHERE month = ${req.params.month}`)[0].total) === Number(existing[0].c);
      const payouts = await sql`
        SELECT handle, amount_minor, state FROM payouts WHERE month = ${req.params.month} ORDER BY handle`;
      const body = {
        ...statement,
        payouts: payouts.map((p) => ({ handle: p.handle, amount_minor: Number(p.amount_minor), state: p.state })),
      };
      // Payouts record in billing through the scheduler; the response says
      // queued or recorded honestly from the database.
      res.status(allRecorded ? 200 : 202).json(body);
    } catch (err) {
      handleRouteError(res, err);
      }
  });

  void formatCoopDate;
}

function midnightToday(nowMs: number): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(new Date(nowMs));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return coopMidnight(`${get("year")}-${get("month")}-${get("day")}`)!;
}
