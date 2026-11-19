import type { Express, Request, Response } from "express";
import type { Ctx } from "../app.js";
import { requireAuth } from "./auth.js";
import { errors } from "../errors.js";
import { readJson } from "../http.js";
import { vehiclesFor, tx, isoDate } from "../repo.js";
import { isoInstant, foldEmail, foldTelephone, ukTimeHM } from "../domain.js";
import { parseMoneyToPennies, penniesToString, type Pennies } from "../money.js";
import { quoteVehicleMoney, suggestPlan, type Party } from "../rules.js";
import { rateTableFor, rateTableForDate, quoteEndFor } from "./rate-helpers.js";
import { parseLocalDate } from "../validation.js";
import { sendMail } from "../services.js";
import { ukDateString } from "../uktime.js";
import { parseBidPrice } from "./bids.js";

function rateOut(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(row.id),
    effectiveFrom: isoDate(row.effective_from),
    defaultMarginPercent: String(row.default_margin_percent),
    waitingRatePerHour: penniesToString(Number(row.waiting_rate_pennies)),
    secondDriverCharge: penniesToString(Number(row.second_driver_pennies)),
    depositMinibus: penniesToString(Number(row.deposit_minibus)),
    depositMinibusHigher: penniesToString(Number(row.deposit_minibus_higher)),
    depositCoach: penniesToString(Number(row.deposit_coach)),
    depositCoachHigher: penniesToString(Number(row.deposit_coach_higher)),
  };
}

export function registerHireApi(app: Express, ctx: Ctx): void {
  app.get("/api/rates", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const tables = await ctx.db.query("SELECT * FROM rate_tables WHERE desk_id=$1 ORDER BY effective_from", [deskId]);
    const inForce = await rateTableFor(ctx, deskId, new Date());
    res.json({ tables: tables.rows.map(rateOut), inForce: inForce.id || null });
  });

  app.post("/api/rates", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const body = (await readJson(req)) as Record<string, unknown>;
    const f: Record<string, string> = {};
    const effectiveFrom = typeof body.effectiveFrom === "string" ? body.effectiveFrom : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) f.effectiveFrom = "Enter a date as DD/MM/YYYY.";
    const margin = typeof body.defaultMarginPercent === "string" ? body.defaultMarginPercent : "";
    const wait = typeof body.waitingRatePerHour === "string" ? body.waitingRatePerHour : "";
    const second = typeof body.secondDriverCharge === "string" ? body.secondDriverCharge : "";
    const dep = ["depositMinibus", "depositMinibusHigher", "depositCoach", "depositCoachHigher"].map((k) => [
      k,
      typeof body[k] === "string" ? (body[k] as string) : "",
    ]) as [string, string][];
    if (Object.keys(f).length === 0) {
      const today = ukDateString(new Date());
      if (effectiveFrom < today) throw errors.invalid({ effectiveFrom: "A rate table can't start before today." }, "A rate table can't start before today.");
      const same = await ctx.db.query("SELECT 1 FROM rate_tables WHERE desk_id=$1 AND effective_from=$2", [deskId, effectiveFrom]);
      if (same.rows[0]) throw errors.state("sameDate", `A rate table already starts on ${effectiveFrom}.`);
    }
    const money = (v: string): number | null => parseMoneyToPennies(v);
    const waitP = money(wait);
    const secondP = money(second);
    const depP = dep.map(([, v]) => money(v));
    if (waitP === null || secondP === null || depP.some((x) => x === null)) {
      throw errors.invalid({ waitingRatePerHour: "Enter the amount in pounds and pence." }, "Enter the amount in pounds and pence.");
    }
    if (Object.keys(f).length) throw errors.invalid(f);
    const id = "RT-" + Math.random().toString(36).slice(2, 10).toUpperCase();
    await ctx.db.query(
      `INSERT INTO rate_tables (id, desk_id, effective_from, default_margin_percent, waiting_rate_pennies, second_driver_pennies, deposit_minibus, deposit_minibus_higher, deposit_coach, deposit_coach_higher)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, deskId, effectiveFrom, margin || "15", waitP, secondP, depP[0], depP[1], depP[2], depP[3]]
    );
    const after = await ctx.db.query("SELECT * FROM rate_tables WHERE id=$1", [id]);
    res.status(201).json(rateOut(after.rows[0]));
  });

  app.post("/api/hires", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const body = (await readJson(req)) as Record<string, unknown>;
    const stage = body.stage === "enquiry" || body.stage === "quoted" || body.stage === "accepted" ? body.stage : null;
    if (!stage) throw errors.invalid({ stage: "We can't find that." });
    const occasion = typeof body.occasion === "string" ? body.occasion : "";
    if (!["school", "weddings", "company", "festivals"].includes(occasion)) throw errors.invalid({ occasion: "Choose an occasion." });
    const stops = Array.isArray(body.stops) ? body.stops.map(String) : [];
    if (stops.length < 2) throw errors.invalid({ stops: "Enter the pick-up address." });
    const departAt = parseLocalDate(body.departAt ?? {}, "departAt");
    const returnAt = body.returnAt ? parseLocalDate(body.returnAt, "returnAt") : null;
    const party = partyFromBody(body.party);
    const vehiclesIn = Array.isArray(body.vehicles) ? body.vehicles : [];
    let operatorId: string | null = null;
    const vehicles: { seats: number; bought: Pennies | null; margin: string }[] = [];
    for (const v of vehiclesIn) {
      const o = (v ?? {}) as Record<string, unknown>;
      const seats = Number(o.seats);
      if (!Number.isInteger(seats) || ![8, 12, 16, 31, 49, 56, 70].includes(seats)) {
        throw errors.invalid({ vehicles: "Choose sizes from 8, 12, 16, 31, 49, 56 and 70." });
      }
      const opId = typeof o.operatorId === "string" ? o.operatorId : null;
      const bought = typeof o.boughtPrice === "string" ? parseBidPrice(o.boughtPrice) : null;
      if (o.boughtPrice !== undefined && bought === null) throw errors.invalid({ vehicles: "Enter the price in pounds and pence." });
      const margin = typeof o.marginPercent === "string" ? o.marginPercent : null;
      vehicles.push({ seats, bought, margin: margin ?? "15" });
      if (opId) operatorId = opId;
    }
    if (operatorId) {
      const op = await ctx.db.query("SELECT 1 FROM operators WHERE desk_id=$1 AND id=$2", [deskId, operatorId]);
      if (!op.rows[0]) throw errors.notFound();
    }
    if (stage !== "enquiry" && vehicles.length === 0) throw errors.invalid({ vehicles: "Choose sizes from 8, 12, 16, 31, 49, 56 and 70." });
    const customerBody = (body.customer ?? {}) as Record<string, unknown>;
    const customerId = await findOrCreateCustomer(ctx, deskId, customerBody);
    const reference = await nextReference(ctx, deskId);
    const now = new Date();
    const rate = await rateTableFor(ctx, deskId, now);
    const quoteSentAt = body.quoteSentAt ? parseLocalDate(body.quoteSentAt, "quoteSentAt").instant : now;
    const endsAt = stage === "enquiry" ? null : quoteEndFor(quoteSentAt, ctx.cfg.quoteValidSeconds);
    const token = stage === "enquiry" ? null : "q" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    const hireId = "HR-" + reference;
    const enquiryState = stage === "accepted" ? "won" : stage === "quoted" ? "quoted" : "new";
    await tx(ctx.db, async (client) => {
      await client.query(
        `INSERT INTO hires (id, desk_id, reference, customer_id, occasion, stage, enquiry_state, depart_date, depart_time, depart_instant, return_date, return_time, return_instant, quote_version, quote_sent_at, quote_ends_at, quote_path, quote_mailed, rate_table_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14,$15,$16,$17,$18,$19)`,
        [
          hireId, deskId, reference, customerId, occasion, stage, enquiryState,
          departAt.date, departAt.time, departAt.instant,
          returnAt?.date ?? null, returnAt?.time ?? null, returnAt?.instant ?? null,
          stage === "enquiry" ? null : quoteSentAt, endsAt, token, stage === "quoted", rate.id, now,
        ]
      );
      await client.query(
        `INSERT INTO enquiries (id, desk_id, customer_id, reference, occasion, state, journey_type, depart_date, depart_time, depart_instant, return_date, return_time, return_instant, people, large, medium, hand, wheelchairs, name, email, telephone, language, created_at, merged_references)
         VALUES ($1,$2,$3,$4,$5,$6,'oneWay',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,(SELECT name FROM customers WHERE id=$3),(SELECT email FROM customers WHERE id=$3),(SELECT telephone FROM customers WHERE id=$3),(SELECT language FROM customers WHERE id=$3),$18,'{}')
         ON CONFLICT (desk_id, reference) DO NOTHING`,
        [reference, deskId, customerId, reference, occasion, enquiryState, departAt.date, departAt.time, departAt.instant, returnAt?.date ?? null, returnAt?.time ?? null, returnAt?.instant ?? null, party.people, party.large, party.medium, party.hand, party.wheelchairs, now]
      );
      for (let i = 0; i < stops.length; i++) {
        await client.query("INSERT INTO enquiry_stops (id, enquiry_id, desk_id, position, text, checked) VALUES ($1,$2,$3,$4,$5,FALSE)", [
          "ST-" + reference + "-" + i, reference, deskId, i, stops[i],
        ]);
      }
      await client.query(
        `INSERT INTO plan_saves (desk_id, enquiry_id, sizes, suggested, larger_than_needed) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (desk_id, enquiry_id) DO UPDATE SET sizes=$3, suggested=$4, larger_than_needed=$5`,
        [deskId, reference, vehicles.map((v) => v.seats), suggestPlan(party), vehicles.length > 0 ? false : false]
      );
      let position = 0;
      for (const v of vehicles) {
        position++;
        const money = v.bought !== null ? quoteVehicleMoney(v.bought, v.margin, v.seats, rate.deposits) : null;
        const vid = "VH-" + reference + "-" + position;
        await client.query(
          `INSERT INTO vehicles (id, desk_id, hire_id, seats, position, operator_id, bought_pennies, margin_percent, selling_pennies, vat_pennies, total_pennies, deposit_pennies, deposit_fixed, depart_date, depart_time, depart_instant)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [
            vid, deskId, hireId, v.seats, position, operatorId, v.bought, v.margin,
            money?.selling ?? 0, money?.vat ?? 0, money?.total ?? 0, money?.deposit ?? 0,
            stage !== "enquiry", departAt.date, departAt.time, departAt.instant,
          ]
        );
        if (stage === "accepted") {
          const num = (await client.query<{ next: number }>("SELECT COALESCE(MAX(number),0)+1 AS next FROM runs WHERE desk_id=$1", [deskId])).rows[0].next;
          const runId = "RN-" + num;
          const sheetToken = "r" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
          await client.query(
            `INSERT INTO runs (id, desk_id, number, hire_id, vehicle_id, depart_date, depart_time, depart_instant, sheet_path) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [runId, deskId, num, hireId, vid, departAt.date, departAt.time, departAt.instant, sheetToken]
          );
          await client.query("INSERT INTO run_tokens (token, desk_id, run_id, created_at) VALUES ($1,$2,$3,$4)", [sheetToken, deskId, runId, now]);
        }
      }
      if (token) {
        await client.query("INSERT INTO quote_tokens (token, desk_id, hire_id, version, created_at) VALUES ($1,$2,$3,1,$4)", [token, deskId, hireId, quoteSentAt]);
      }
    });
    const hire = await hireAnswer(ctx, deskId, hireId);
    res.status(201).json(hire);
  });

  app.get("/api/hires/:id", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    res.json(await hireAnswer(ctx, deskId, String(hire.rows[0].id)));
  });

  app.get("/api/hires/:id/quote", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    res.json(await quoteAnswer(ctx, deskId, hire.rows[0]));
  });

  app.post("/api/hires/:id/quote/preview", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = (await readJson(req)) as Record<string, unknown>;
    const list = Array.isArray(body.vehicles) ? body.vehicles : [];
    const rate = await rateTableForDate(ctx, deskId, isoDate(hire.rows[0].quote_sent_at ? (hire.rows[0].quote_sent_at as Date) : new Date()));
    const out: Record<string, unknown>[] = [];
    let total = 0;
    let depositTotal = 0;
    for (const v of list) {
      const o = (v ?? {}) as Record<string, unknown>;
      const seats = Number(o.seats);
      if (!Number.isInteger(seats) || ![8, 12, 16, 31, 49, 56, 70].includes(seats)) {
        throw errors.invalid({ vehicles: "Choose sizes from 8, 12, 16, 31, 49, 56 and 70." });
      }
      const bought = typeof o.boughtPrice === "string" ? parseBidPrice(o.boughtPrice) : null;
      if (bought === null) throw errors.invalid({ vehicles: "Enter the price in pounds and pence." });
      const margin = typeof o.marginPercent === "string" ? o.marginPercent : rate.defaultMarginPercent;
      if (!validMargin(margin)) throw errors.invalid({ marginPercent: "Margin is 0 to 60 in steps of 0.5." }, "Margin is 0 to 60 in steps of 0.5.");
      const m = quoteVehicleMoney(bought, margin, seats, rate.deposits);
      out.push({ seats, sellingPrice: penniesToString(m.selling), vat: penniesToString(m.vat), total: penniesToString(m.total), deposit: penniesToString(m.deposit) });
      total += m.total;
      depositTotal += m.deposit;
    }
    res.json({ vehicles: out, total: penniesToString(total), depositTotal: penniesToString(depositTotal) });
  });

  app.put("/api/hires/:id/quote", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    const body = (await readJson(req)) as Record<string, unknown>;
    const version = Number(body.version);
    if (!Number.isInteger(version)) throw errors.staleEdit("Someone changed this quote. Your edit is still here. Reload to see theirs.");
    if (hire.rows[0].stage === "accepted") throw errors.state("quoteLocked", "This quote is accepted. Use Changes instead.");
    if (version < Number(hire.rows[0].quote_version)) {
      throw errors.staleEdit(`Someone changed this quote at ${ukTimeHM((hire.rows[0].quote_version_changed_at as Date) ?? new Date())}. Your edit is still here. Reload to see theirs.`);
    }
    const list = Array.isArray(body.vehicles) ? body.vehicles : [];
    const vehicles = await vehiclesFor(ctx.db, deskId, String(hire.rows[0].id));
    const byId = new Map(vehicles.map((v) => [v.id, v]));
    const updated = new Map<string, string>();
    for (const v of list) {
      const o = (v ?? {}) as Record<string, unknown>;
      const id = typeof o.id === "string" ? o.id : "";
      const target = byId.get(id);
      if (!target) throw errors.notFound();
      const margin = typeof o.marginPercent === "string" ? o.marginPercent : target.margin ?? "15";
      if (!validMargin(margin)) throw errors.invalid({ marginPercent: "Margin is 0 to 60 in steps of 0.5." }, "Margin is 0 to 60 in steps of 0.5.");
      updated.set(id, margin);
    }
    const rate = await rateTableForDate(ctx, deskId, isoDate(hire.rows[0].quote_sent_at ? (hire.rows[0].quote_sent_at as Date) : new Date()));
    await tx(ctx.db, async (client) => {
      for (const [id, margin] of updated) {
        const v = byId.get(id)!;
        const m = quoteVehicleMoney(v.bought ?? 0, margin, v.seats, rate.deposits);
        await client.query(
          "UPDATE vehicles SET margin_percent=$1, selling_pennies=$2, vat_pennies=$3, total_pennies=$4 WHERE id=$5",
          [margin, m.selling, m.vat, m.total, id]
        );
      }
      await client.query(
        "UPDATE hires SET quote_version = $1 + 1, quote_version_changed_at = NOW() WHERE desk_id=$2 AND id=$3",
        [version, deskId, hire.rows[0].id]
      );
    });
    const after = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [hire.rows[0].id]);
    res.json(await quoteAnswer(ctx, deskId, after.rows[0]));
  });

  app.post("/api/hires/:id/quote/send", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    void req.body;
    const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND (id=$2 OR reference=$2)", [deskId, req.params.id]);
    if (!hire.rows[0]) throw errors.notFound();
    if (hire.rows[0].stage === "enquiry") throw errors.state("notAwarded", "We can't find that.");
    const customer = await ctx.db.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2", [deskId, hire.rows[0].customer_id]);
    if (!customer.rows[0]) throw errors.notFound();
    const now = new Date();
    let sentAt = hire.rows[0].quote_sent_at ? (hire.rows[0].quote_sent_at as Date) : null;
    let endsAt = hire.rows[0].quote_ends_at ? (hire.rows[0].quote_ends_at as Date) : null;
    let path = hire.rows[0].quote_path ? String(hire.rows[0].quote_path) : null;
    const rateAtSend = await rateTableFor(ctx, deskId, sentAt ?? now);
    if (!sentAt || !hire.rows[0].quote_mailed) {
      // first send keeps an existing carried-over sentAt
      sentAt = sentAt ?? now;
      endsAt = quoteEndFor(sentAt, ctx.cfg.quoteValidSeconds);
      path = path ?? "q" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      await ctx.db.query(
        "UPDATE hires SET quote_sent_at=$1, quote_ends_at=$2, quote_path=$3, quote_mailed=TRUE, stage=CASE WHEN stage='quoted' THEN 'quoted' ELSE stage END, enquiry_state=CASE WHEN enquiry_state IN ('new','priced') THEN 'quoted' ELSE enquiry_state END WHERE id=$4",
        [sentAt, endsAt, path, hire.rows[0].id]
      );
      await ctx.db.query(
        `INSERT INTO quote_tokens (token, desk_id, hire_id, version, created_at) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (token) DO NOTHING`,
        [path, deskId, hire.rows[0].id, Number(hire.rows[0].quote_version), sentAt]
      );
      const vehicles = await vehiclesFor(ctx.db, deskId, String(hire.rows[0].id));
      let total = 0;
      for (const v of vehicles) total += v.total;
      const lang = String(customer.rows[0].language ?? "en");
      const ok = await sendQuoteMail(ctx, String(customer.rows[0].email), String(hire.rows[0].reference), lang, total, endsAt, path);
      if (!ok) throw errors.provider("The mail service is unavailable right now. Nothing was sent.");
    } else {
      // a repeat with nothing changed sends nothing
      void rateAtSend;
    }
    const after = await ctx.db.query("SELECT * FROM hires WHERE id=$1", [hire.rows[0].id]);
    res.json(await quoteAnswer(ctx, deskId, after.rows[0]));
  });
}

export function validMargin(m: string): boolean {
  const v = Number(m);
  return Number.isFinite(v) && v >= 0 && v <= 60 && Math.abs(v * 2 - Math.round(v * 2)) < 1e-9;
}

function partyFromBody(v: unknown): Party {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    people: Number(o.people ?? 1),
    large: Number(o.large ?? 0),
    medium: Number(o.medium ?? 0),
    hand: Number(o.hand ?? 0),
    wheelchairs: Number(o.wheelchairs ?? 0),
  };
}

async function nextReference(ctx: Ctx, deskId: string): Promise<string> {
  const { newReference } = await import("../repo.js");
  return newReference(ctx.db, deskId);
}

async function findOrCreateCustomer(ctx: Ctx, deskId: string, body: Record<string, unknown>): Promise<string> {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const telephone = typeof body.telephone === "string" ? body.telephone.trim() : "";
  const language = body.language === "pl" || body.language === "ur" ? body.language : "en";
  const existing = email
    ? await ctx.db.query("SELECT id FROM customers WHERE desk_id=$1 AND email_folded=$2", [deskId, foldEmail(email)])
    : await ctx.db.query("SELECT id FROM customers WHERE desk_id=$1 AND telephone_folded=$2", [deskId, foldTelephone(telephone)]);
  if (existing.rows[0]) return String(existing.rows[0].id);
  const id = "CU-" + Date.now().toString(36).toUpperCase();
  await ctx.db.query(
    "INSERT INTO customers (id, desk_id, name, email, telephone, language, state, email_folded, telephone_folded) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)",
    [id, deskId, name, email || null, telephone || null, language, email ? foldEmail(email) : null, telephone ? foldTelephone(telephone) : null]
  );
  return id;
}

export async function hireAnswer(ctx: Ctx, deskId: string, hireId: string): Promise<Record<string, unknown>> {
  const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND id=$2", [deskId, hireId]);
  const h = hire.rows[0];
  const vehicles = await vehiclesFor(ctx.db, deskId, hireId);
  const runs = await ctx.db.query("SELECT * FROM runs WHERE desk_id=$1 AND hire_id=$2 ORDER BY number", [deskId, hireId]);
  const money = await vehicleMoney(ctx, deskId, vehicles);
  const award = await ctx.db.query("SELECT * FROM awards WHERE desk_id=$1 AND enquiry_id=$2", [deskId, h.reference]);
  return {
    id: String(h.id),
    reference: String(h.reference),
    customerId: String(h.customer_id),
    stage: String(h.stage),
    enquiryState: String(h.enquiry_state),
    quotePath: h.quote_path ? String(h.quote_path) : null,
    sentAt: h.quote_sent_at ? isoInstant(h.quote_sent_at as Date) : null,
    validUntil: h.quote_ends_at ? validUntilFrom(h.quote_ends_at as Date) : null,
    endsAt: h.quote_ends_at ? isoInstant(h.quote_ends_at as Date) : null,
    vehicles: vehicles.map((v) => ({
      id: v.id,
      seats: v.seats,
      operatorId: v.operatorId,
      boughtPrice: v.bought === null ? null : penniesToString(v.bought),
      marginPercent: v.margin,
      sellingPrice: penniesToString(v.selling),
      vat: penniesToString(v.vat),
      total: penniesToString(v.total),
      deposit: penniesToString(v.deposit),
      departAt: v.departDate ? { date: v.departDate, time: v.departTime } : null,
      departInstant: v.departInstant ? isoInstant(v.departInstant) : null,
      runId: runs.rows.find((r) => r.vehicle_id === v.id)?.id ?? null,
    })),
    runs: runs.rows.map((r) => ({ id: String(r.id), number: Number(r.number), sheetPath: String(r.sheet_path) })),
    paymentState: money.paymentState,
    paid: penniesToString(money.paid),
    owed: penniesToString(money.owed),
    credit: penniesToString(money.credit),
    balanceDueOn: null,
    awarded: award.rows[0] ? { operatorId: String(award.rows[0].operator_id), at: isoInstant(award.rows[0].awarded_at as Date) } : null,
  };
}

export async function vehicleMoney(
  ctx: Ctx,
  deskId: string,
  vehicles: { id: string; total: Pennies; deposit: Pennies }[]
): Promise<{ paid: Pennies; owed: Pennies; credit: Pennies; paymentState: string }> {
  const states: { total: Pennies; deposit: Pennies; depositPaid: Pennies; balancePaid: Pennies }[] = [];
  let paid = 0;
  let totalDue = 0;
  let depositsDue = 0;
  for (const v of vehicles) {
    const r = await ctx.db.query(
      `SELECT
        COALESCE(SUM(amount_pennies) FILTER (WHERE account='clientMoney' AND movement_kind='deposit'),0) AS deposit,
        COALESCE(SUM(amount_pennies) FILTER (WHERE account='clientMoney' AND movement_kind='balance'),0) AS balance,
        COALESCE(SUM(amount_pennies) FILTER (WHERE account='clientMoney' AND movement_kind='credit'),0) AS credit
       FROM ledger_lines WHERE desk_id=$1 AND vehicle_id=$2`,
      [deskId, v.id]
    );
    const depositPaid = Number(r.rows[0].deposit);
    const balancePaid = Number(r.rows[0].balance);
    const creditPaid = Number(r.rows[0].credit);
    states.push({ total: v.total, deposit: v.deposit, depositPaid: depositPaid + creditPaid, balancePaid });
    paid += depositPaid + balancePaid + creditPaid;
    totalDue += v.total;
    depositsDue += v.deposit;
  }
  const owed = Math.max(0, totalDue - paid);
  const credit = Math.max(0, paid - totalDue);
  const allDeposits = vehicles.length > 0 && states.every((s) => s.depositPaid >= s.deposit);
  const allPaid = vehicles.length > 0 && states.every((s) => s.depositPaid + s.balancePaid >= s.total);
  let paymentState = "nothingPaid";
  if (allPaid) paymentState = "paidInFull";
  else if (allDeposits) paymentState = "depositPaid";
  else if (states.some((s) => s.depositPaid > 0)) paymentState = paid < depositsDue ? "depositPartPaid" : "depositPaid";
  return { paid, owed, credit, paymentState };
}

export function validUntilFrom(endsAt: Date): string {
  const day = new Date(endsAt.getTime() - 1000);
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(day);
  const [dd, mm, yyyy] = f.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

export async function quoteAnswer(ctx: Ctx, deskId: string, h: Record<string, unknown>): Promise<Record<string, unknown>> {
  const vehicles = await vehiclesFor(ctx.db, deskId, String(h.id));
  let total = 0;
  let depositTotal = 0;
  for (const v of vehicles) {
    total += v.total;
    depositTotal += v.deposit;
  }
  return {
    version: Number(h.quote_version),
    sentAt: h.quote_sent_at ? isoInstant(h.quote_sent_at as Date) : null,
    validUntil: h.quote_ends_at ? validUntilFrom(h.quote_ends_at as Date) : null,
    endsAt: h.quote_ends_at ? isoInstant(h.quote_ends_at as Date) : null,
    quotePath: h.quote_path ? String(h.quote_path) : null,
    rateTableId: h.rate_table_id ? String(h.rate_table_id) : null,
    vehicles: vehicles.map((v) => ({
      id: v.id,
      seats: v.seats,
      boughtPrice: v.bought === null ? null : penniesToString(v.bought),
      marginPercent: v.margin,
      sellingPrice: penniesToString(v.selling),
      vat: penniesToString(v.vat),
      total: penniesToString(v.total),
      deposit: penniesToString(v.deposit),
    })),
    total: penniesToString(total),
    depositTotal: penniesToString(depositTotal),
  };
}

export async function sendQuoteMail(
  ctx: Ctx,
  to: string,
  reference: string,
  language: string,
  total: Pennies,
  endsAt: Date,
  token: string
): Promise<boolean> {
  const t = quoteStringsFor(language);
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(endsAt.getTime() - 1000));
  const [dd, mm, yyyy] = day.split("/");
  const validUntil = language === "pl" ? `${dd}.${mm}.${yyyy}` : language === "ur" ? `${dd}/${mm}/${yyyy}` : longUkDate(new Date(endsAt.getTime() - 1000));
  const text = [
    `${t.yourQuote} ${reference}`,
    "",
    `${t.total} £${(total / 100).toFixed(2)}`,
    `${t.validUntil} ${validUntil}`,
    "",
    `${ctx.cfg.appPublicUrl}/q/${token}`,
    "",
  ].join("\n");
  try {
    await sendMail(ctx.cfg, { to, subject: `${t.yourQuote} ${reference}`, text });
    return true;
  } catch {
    return false;
  }
}

function longUkDate(d: Date): string {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "2-digit", month: "short", year: "numeric" }).formatToParts(d);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")} ${Number(get("day"))} ${get("month")} ${get("year")}`;
}

export function quoteStringsFor(language: string): { yourQuote: string; total: string; validUntil: string } {
  if (language === "pl") return { yourQuote: "Twoja wycena", total: "Razem", validUntil: "Ważna do" };
  if (language === "ur") return { yourQuote: "آپ کا کوٹیشن", total: "کل رقم", validUntil: "تک کارآمد" };
  return { yourQuote: "Your quote", total: "Total", validUntil: "Valid until" };
}
