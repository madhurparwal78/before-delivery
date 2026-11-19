import type { Express, Request, Response } from "express";
import type { Ctx } from "../app.js";
import { requireAuth } from "./auth.js";
import { errors } from "../errors.js";
import { readJson } from "../http.js";
import { enquiryById, tx } from "../repo.js";
import { sendMail } from "../services.js";
import { parseMoneyToPennies, penniesToString, type Pennies } from "../money.js";
import { isoInstant, ukTimeHM, foldEmail, foldTelephone } from "../domain.js";
import { operatorClearForLastDay, lastDayOfHire } from "./operators.js";
import { quoteVehicleMoney, type Party, suggestPlan, checkPlan, seatsFor } from "../rules.js";
import { partyFromEnquiry } from "./trip-helpers.js";
import { ensureLegs } from "./trip-helpers.js";
import { rateTableFor, quoteEndFor } from "./rate-helpers.js";

/** Typed prices may be 1250, 1,250, 1250.5 or 1,250.50. */
export function parseBidPrice(text: string): Pennies | null {
  const t = String(text ?? "").trim();
  if (!/^\d{1,3}(,\d{3})*(\.\d{1,2})?$/.test(t) && !/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return parseMoneyToPennies(t);
}

export function registerBidApi(app: Express, ctx: Ctx): void {
  app.post("/api/enquiries/:id/bids/ask", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    const plan = await ctx.db.query<{ sizes: number[] }>("SELECT sizes FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id]);
    if (!plan.rows[0] || !plan.rows[0].sizes?.length) throw errors.state("noPlan", "Save a plan before asking operators.");
    const award = await ctx.db.query("SELECT 1 FROM awards WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id]);
    if (award.rows[0]) throw errors.state("alreadyAwarded", "Already awarded.");
    const body = (await readJson(req)) as Record<string, unknown>;
    const operatorIds = Array.isArray(body.operatorIds) ? body.operatorIds.map(String) : [];
    if (operatorIds.length === 0) throw errors.invalid({ operatorIds: "We can't find that." });
    const sizes = plan.rows[0].sizes;
    const asks: { operatorId: string; bidPath: string; sentAt: string; closesAt: string }[] = [];
    const now = new Date();
    const closesAt = new Date(Math.floor(now.getTime() / 1000) * 1000 + ctx.cfg.bidWindowSeconds * 1000);
    for (const opId of operatorIds) {
      const op = await ctx.db.query("SELECT * FROM operators WHERE desk_id=$1 AND id=$2", [deskId, opId]);
      if (!op.rows[0]) throw errors.notFound();
      const existing = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id=$3", [deskId, e.id, opId]);
      if (existing.rows[0]) {
        asks.push({
          operatorId: opId,
          bidPath: String(existing.rows[0].ask_path),
          sentAt: isoInstant(existing.rows[0].asked_at as Date),
          closesAt: isoInstant(existing.rows[0].closes_at as Date),
        });
        continue;
      }
      const token = "b" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      await ctx.db.query(
        `INSERT INTO bids (desk_id, enquiry_id, operator_id, ask_path, asked_at, closes_at) VALUES ($1,$2,$3,$4,$5,$6)`,
        [deskId, e.id, opId, token, now, closesAt]
      );
      await ctx.db.query("INSERT INTO bid_tokens (token, desk_id, enquiry_id, operator_id, created_at) VALUES ($1,$2,$3,$4,$5)", [
        token,
        deskId,
        e.id,
        opId,
        now,
      ]);
      const sent = await sendAskMail(ctx, e, sizes, op.rows[0], token, closesAt);
      if (!sent) throw errors.provider("We couldn't reach the mail service.");
      asks.push({ operatorId: opId, bidPath: token, sentAt: isoInstant(now), closesAt: isoInstant(closesAt) });
    }
    res.status(201).json({ asks });
  });

  app.get("/api/enquiries/:id/bids", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    const sort = req.query.sort === "priceHighest" ? "priceHighest" : "priceLowest";
    const now = new Date();
    const bids = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id]);
    const award = await ctx.db.query("SELECT * FROM awards WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id]);
    const awardedAt = award.rows[0] ? (award.rows[0].awarded_at as Date) : null;
    const plan = await ctx.db.query<{ sizes: number[] }>("SELECT sizes FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id]);
    const vehicleCount = plan.rows[0]?.sizes?.length ?? 0;
    const rows: Record<string, unknown>[] = [];
    for (const b of bids.rows) {
      const op = await ctx.db.query("SELECT * FROM operators WHERE desk_id=$1 AND id=$2", [deskId, b.operator_id]);
      const closes = b.closes_at as Date;
      const live = hasLivePrice(b, closes, now, awardedAt);
      const status = bidStatus(b, closes, now, awardedAt);
      const clear = await operatorClearForLastDay(ctx.db, deskId, String(b.operator_id), e.occasion, await hireLastDay(ctx, deskId, e));
      rows.push({
        operatorId: String(b.operator_id),
        operatorName: op.rows[0] ? String(op.rows[0].name) : String(b.operator_id),
        status,
        clear: clear.clear,
        reason: clear.reason,
        prices: live ? (b.prices as string[]) ?? [] : [],
        total: live ? ((b.prices as string[]) ?? []).reduce((s: number, p: string) => s + Number(p) * 100, 0) / 100 : null,
        receivedAt: b.received_at ? isoInstant(b.received_at as Date) : null,
        closesAt: isoInstant(closes),
      });
    }
    rows.sort((a, b) => {
      const aLive = (a.prices as string[]).length > 0;
      const bLive = (b.prices as string[]).length > 0;
      if (aLive !== bLive) return aLive ? -1 : 1;
      if (aLive) {
        const at = (a.total as number) ?? 0;
        const bt = (b.total as number) ?? 0;
        if (at !== bt) return sort === "priceLowest" ? at - bt : bt - at;
        const ar = (a.receivedAt as string) ?? "";
        const br = (b.receivedAt as string) ?? "";
        if (ar !== br) return ar < br ? -1 : 1;
      }
      return String(a.operatorId).localeCompare(String(b.operatorId));
    });
    res.json({ bids: rows, awarded: award.rows[0] ? { operatorId: String(award.rows[0].operator_id), at: isoInstant(awardedAt as Date) } : null, vehicles: vehicleCount });
  });

  app.post("/api/enquiries/:id/award", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    const body = (await readJson(req)) as Record<string, unknown>;
    const opId = typeof body.operatorId === "string" ? body.operatorId : "";
    const award = await ctx.db.query("SELECT * FROM awards WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id]);
    if (award.rows[0]) {
      const op = await ctx.db.query("SELECT name FROM operators WHERE desk_id=$1 AND id=$2", [deskId, award.rows[0].operator_id]);
      throw errors.state("alreadyAwarded", `Already awarded to ${op.rows[0]?.name ?? opId} at ${ukTimeHM(award.rows[0].awarded_at as Date)}.`);
    }
    const bid = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id=$3", [deskId, e.id, opId]);
    if (!bid.rows[0]) throw errors.state("noBid", `${opId} has no price on this hire.`);
    const b = bid.rows[0];
    const now = new Date();
    const closes = b.closes_at as Date;
    const live = hasLivePrice(b, closes, now, null);
    if (!live) throw errors.state("noBid", `${opId} has no price on this hire.`);
    const clear = await operatorClearForLastDay(ctx.db, deskId, opId, e.occasion, await hireLastDay(ctx, deskId, e));
    if (!clear.clear) throw errors.state("operatorNotClear", clear.reason ?? "We can't find that.");
    const prices = (b.prices as string[]) ?? [];
    const rate = await rateTableFor(ctx, deskId, new Date());
    await createHireFromAward(ctx, deskId, e, opId, prices, rate);
    res.json({ awarded: { operatorId: opId, at: isoInstant(now) } });
  });

  // Private bid page.
  app.get("/api/b/:token", async (req: Request, res: Response) => {
    const token = req.params.token;
    const t = await ctx.db.query("SELECT * FROM bid_tokens WHERE token=$1", [token]);
    if (!t.rows[0]) throw errors.notFound();
    const deskId = String(t.rows[0].desk_id);
    const enquiryId = String(t.rows[0].enquiry_id);
    const bid = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id=$3", [
      deskId,
      enquiryId,
      String(t.rows[0].operator_id),
    ]);
    if (!bid.rows[0]) throw errors.notFound();
    const now = new Date();
    const award = await ctx.db.query("SELECT * FROM awards WHERE desk_id=$1 AND enquiry_id=$2", [deskId, enquiryId]);
    const awardedAt = award.rows[0] ? (award.rows[0].awarded_at as Date) : null;
    const ended = endedAt(bid.rows[0], now, awardedAt);
    if (ended) throw errors.ended();
    const e = await enquiryById(ctx.db, deskId, enquiryId);
    if (!e) throw errors.notFound();
    const plan = await ctx.db.query<{ sizes: number[] }>("SELECT sizes FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2", [deskId, enquiryId]);
    const stops = (await ctx.db.query("SELECT text FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [enquiryId])).rows.map(
      (x) => String(x.text)
    );
    res.json({
      route: { stops },
      dates: {
        departAt: { date: e.departDate, time: e.departTime },
        returnAt: e.returnDate && e.returnTime ? { date: e.returnDate, time: e.returnTime } : null,
        departInstant: isoInstant(e.departInstant),
        returnInstant: e.returnInstant ? isoInstant(e.returnInstant) : null,
      },
      vehicles: (plan.rows[0]?.sizes ?? []).map((seats, i) => ({ index: i + 1, seats })),
      partySize: e.people,
      closesAt: isoInstant(bid.rows[0].closes_at as Date),
      bid: liveBidPrices(bid.rows[0]),
    });
  });

  app.put("/api/b/:token/bid", async (req: Request, res: Response) => {
    const token = req.params.token;
    const t = await ctx.db.query("SELECT * FROM bid_tokens WHERE token=$1", [token]);
    if (!t.rows[0]) throw errors.notFound();
    const deskId = String(t.rows[0].desk_id);
    const enquiryId = String(t.rows[0].enquiry_id);
    const bid = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id=$3", [
      deskId,
      enquiryId,
      String(t.rows[0].operator_id),
    ]);
    if (!bid.rows[0]) throw errors.notFound();
    const now = new Date();
    const award = await ctx.db.query("SELECT * FROM awards WHERE desk_id=$1 AND enquiry_id=$2", [deskId, enquiryId]);
    const awardedAt = award.rows[0] ? (award.rows[0].awarded_at as Date) : null;
    if (endedAt(bid.rows[0], now, awardedAt)) {
      const closes = bid.rows[0].closes_at as Date;
      const at = awardedAt ?? closes;
      throw errors.state("bidsClosed", `Bids closed at ${ukTimeHM(at)}. Your price was not sent.`);
    }
    const body = (await readJson(req)) as Record<string, unknown>;
    const prices = Array.isArray(body.prices) ? body.prices.map(String) : [];
    const plan = await ctx.db.query<{ sizes: number[] }>("SELECT sizes FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2", [deskId, enquiryId]);
    const sizes = plan.rows[0]?.sizes ?? [];
    if (prices.length !== sizes.length) throw errors.invalid({ prices: "Enter the price in pounds and pence." }, "Enter the price in pounds and pence.");
    const pennies: number[] = [];
    for (const p of prices) {
      const v = parseBidPrice(p);
      if (v === null) throw errors.invalid({ prices: "Enter the price in pounds and pence." }, "Enter the price in pounds and pence.");
      pennies.push(v);
    }
    await ctx.db.query("UPDATE bids SET prices=$1, received_at=NOW(), withdrawn_at=NULL WHERE desk_id=$2 AND enquiry_id=$3 AND operator_id=$4", [
      pennies.map(penniesToString),
      deskId,
      enquiryId,
      String(t.rows[0].operator_id),
    ]);
    const state = await ctx.db.query("SELECT state FROM enquiries WHERE desk_id=$1 AND id=$2", [deskId, enquiryId]);
    if (state.rows[0] && state.rows[0].state === "new") {
      await ctx.db.query("UPDATE enquiries SET state='priced' WHERE desk_id=$1 AND id=$2", [deskId, enquiryId]);
    }
    const after = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id=$3", [
      deskId,
      enquiryId,
      String(t.rows[0].operator_id),
    ]);
    res.json({ bid: { prices: (after.rows[0].prices as string[]) ?? [], receivedAt: isoInstant(after.rows[0].received_at as Date) } });
  });

  app.delete("/api/b/:token/bid", async (req: Request, res: Response) => {
    const token = req.params.token;
    const t = await ctx.db.query("SELECT * FROM bid_tokens WHERE token=$1", [token]);
    if (!t.rows[0]) throw errors.notFound();
    const deskId = String(t.rows[0].desk_id);
    const enquiryId = String(t.rows[0].enquiry_id);
    const bid = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id=$3", [
      deskId,
      enquiryId,
      String(t.rows[0].operator_id),
    ]);
    if (!bid.rows[0]) throw errors.notFound();
    const now = new Date();
    const award = await ctx.db.query("SELECT * FROM awards WHERE desk_id=$1 AND enquiry_id=$2", [deskId, enquiryId]);
    const awardedAt = award.rows[0] ? (award.rows[0].awarded_at as Date) : null;
    if (endedAt(bid.rows[0], now, awardedAt)) {
      const closes = bid.rows[0].closes_at as Date;
      const at = awardedAt ?? closes;
      throw errors.state("bidsClosed", `Bids closed at ${ukTimeHM(at)}. Your price was not sent.`);
    }
    if (!hasLivePrice(bid.rows[0], bid.rows[0].closes_at as Date, now, awardedAt)) {
      throw errors.state("noBid", "We can't find that.");
    }
    await ctx.db.query("UPDATE bids SET withdrawn_at=NOW(), prices='{}' WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id=$3", [
      deskId,
      enquiryId,
      String(t.rows[0].operator_id),
    ]);
    res.status(204).end();
  });
}

function liveBidPrices(b: Record<string, unknown>): { prices: string[]; receivedAt: string } | null {
  if (!b.received_at || b.withdrawn_at) return null;
  return { prices: (b.prices as string[]) ?? [], receivedAt: isoInstant(b.received_at as Date) };
}

function hasLivePrice(b: Record<string, unknown>, _closes: Date, _now: Date, _awardedAt: Date | null): boolean {
  if (!b.received_at || b.withdrawn_at) return false;
  return true;
}

function endedAt(b: Record<string, unknown>, now: Date, awardedAt: Date | null): Date | null {
  if (awardedAt && now.getTime() >= awardedAt.getTime() + 1000) return awardedAt;
  const closes = b.closes_at as Date;
  if (now.getTime() >= closes.getTime() + 1000) return closes;
  return null;
}

function bidStatus(b: Record<string, unknown>, _closes: Date, now: Date, awardedAt: Date | null): string {
  if (endedAt(b, now, awardedAt)) return "closed";
  if (b.withdrawn_at) return "withdrawn";
  if (b.received_at) return "open";
  return "asked";
}

async function sendAskMail(
  ctx: Ctx,
  e: NonNullable<Awaited<ReturnType<typeof enquiryById>>>,
  sizes: number[],
  op: Record<string, unknown>,
  token: string,
  closesAt: Date
): Promise<boolean> {
  const stops = (await ctx.db.query("SELECT text FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [e.id])).rows.map((x) => String(x.text));
  const text = [
    `Price request ${e.reference}`,
    "",
    "Route:",
    ...stops.map((s) => `- ${s}`),
    "",
    `Departure: ${e.departDate} ${e.departTime} UK time`,
    e.returnDate ? `Return: ${e.returnDate} ${e.returnTime} UK time` : null,
    "",
    "Vehicles:",
    ...sizes.map((s, i) => `- Vehicle ${i + 1}: ${s} seats`),
    "",
    `Party size: ${e.people}`,
    "",
    `Price this hire: ${ctx.cfg.appPublicUrl}/b/${token}`,
    "",
    `Prices close at ${ukTimeHM(closesAt)} UK time.`,
    "",
  ]
    .filter((x) => x !== null)
    .join("\n");
  try {
    await sendMail(ctx.cfg, { to: String(op.email), subject: `Price request ${e.reference}`, text });
    return true;
  } catch {
    return false;
  }
}

async function hireLastDay(ctx: Ctx, deskId: string, e: NonNullable<Awaited<ReturnType<typeof enquiryById>>>): Promise<string> {
  void deskId;
  const hire = await ctx.db.query("SELECT * FROM hires WHERE desk_id=$1 AND reference=$2", [deskId, e.reference]);
  if (hire.rows[0]) return lastDayOfHire(ctx, deskId, hire.rows[0]);
  // No hire yet: the enquiry's own last day is its return or departure date.
  return e.returnDate ?? e.departDate;
}

/** The award creates the hire, vehicles, run per vehicle and quote token, per DP-22. */
async function createHireFromAward(
  ctx: Ctx,
  deskId: string,
  e: NonNullable<Awaited<ReturnType<typeof enquiryById>>>,
  opId: string,
  prices: string[],
  rate: Awaited<ReturnType<typeof rateTableFor>>
): Promise<void> {
  const party: Party = partyFromEnquiry(e);
  const suggested = suggestPlan(party);
  void suggested;
  void checkPlan;
  void seatsFor;
  void quoteVehicleMoney;
  void ensureLegs;
  void quoteEndFor;
  const hireId = "HR-" + e.reference;
  const now = new Date();
  const closesAt = null;
  void closesAt;
  await tx(ctx.db, async (client) => {
    await client.query("INSERT INTO awards (desk_id, enquiry_id, operator_id, awarded_at, mailed) VALUES ($1,$2,$3,$4,0)", [
      deskId,
      e.id,
      opId,
      now,
    ]);
    const customer = await client.query("SELECT * FROM customers WHERE desk_id=$1 AND id=$2", [deskId, e.customerId]);
    const customerId = customer.rows[0]?.id ?? (await ensureCustomer(client, deskId, e));
    await client.query(
      `INSERT INTO hires (id, desk_id, reference, customer_id, occasion, stage, enquiry_state, depart_date, depart_time, depart_instant, return_date, return_time, return_instant, quote_version, rate_table_id, created_at)
       VALUES ($1,$2,$3,$4,$5,'accepted','won',$6,$7,$8,$9,$10,$11,1,$12,$13)
       ON CONFLICT (desk_id, reference) DO NOTHING`,
      [
        hireId,
        deskId,
        e.reference,
        customerId,
        e.occasion,
        e.departDate,
        e.departTime,
        e.departInstant,
        e.returnDate,
        e.returnTime,
        e.returnInstant,
        rate.id,
        now,
      ]
    );
    let position = 0;
    for (const p of prices) {
      position++;
      const seats = (await client.query<{ sizes: number[] }>("SELECT sizes FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id]))
        .rows[0]?.sizes?.[position - 1] ?? 49;
      const bought = parseMoneyToPennies(p) ?? 0;
      const money = quoteVehicleMoney(bought, rate.defaultMarginPercent, seats, rate.deposits);
      const vid = "VH-" + e.reference + "-" + position;
      await client.query(
        `INSERT INTO vehicles (id, desk_id, hire_id, seats, position, operator_id, bought_pennies, margin_percent, selling_pennies, vat_pennies, total_pennies, deposit_pennies, deposit_fixed, depart_date, depart_time, depart_instant)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,FALSE,$13,$14,$15)`,
        [vid, deskId, hireId, seats, position, opId, bought, rate.defaultMarginPercent, money.selling, money.vat, money.total, money.deposit, e.departDate, e.departTime, e.departInstant]
      );
      const num = await client.query<{ next: number }>("SELECT COALESCE(MAX(number),0)+1 AS next FROM runs WHERE desk_id=$1", [deskId]);
      const runId = "RN-" + num.rows[0].next;
      const sheetToken = "r" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
      await client.query(
        `INSERT INTO runs (id, desk_id, number, hire_id, vehicle_id, depart_date, depart_time, depart_instant, sheet_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [runId, deskId, num.rows[0].next, hireId, vid, e.departDate, e.departTime, e.departInstant, sheetToken]
      );
      await client.query("INSERT INTO run_tokens (token, desk_id, run_id, created_at) VALUES ($1,$2,$3,$4)", [sheetToken, deskId, runId, now]);
      const stops = await client.query("SELECT id FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [e.id]);
      for (const s of stops.rows) {
        void s;
      }
    }
    await client.query("UPDATE enquiries SET state='won' WHERE desk_id=$1 AND id=$2", [deskId, e.id]);
  });
  // closing mails to the losers
  const others = await ctx.db.query("SELECT * FROM bids WHERE desk_id=$1 AND enquiry_id=$2 AND operator_id<>$3", [deskId, e.id, opId]);
  for (const b of others.rows) {
    const op = await ctx.db.query("SELECT email FROM operators WHERE desk_id=$1 AND id=$2", [deskId, b.operator_id]);
    if (!op.rows[0]?.email) continue;
    try {
      await sendMail(ctx.cfg, { to: String(op.rows[0].email), subject: `Hire ${e.reference} has closed`, text: `Hire ${e.reference} has closed` });
    } catch {
      // award mails are best effort for losers; the award itself stands
    }
  }
}

async function ensureCustomer(client: { query: Function }, deskId: string, e: NonNullable<Awaited<ReturnType<typeof enquiryById>>>): Promise<string> {
  if (!e.email) {
    const byTel = await client.query("SELECT id FROM customers WHERE desk_id=$1 AND telephone_folded=$2", [deskId, e.telephone ?? ""]);
    if (byTel.rows[0]) return String(byTel.rows[0].id);
  } else {
    const r = await client.query("SELECT id FROM customers WHERE desk_id=$1 AND email_folded=$2", [deskId, foldEmail(e.email)]);
    if (r.rows[0]) return String(r.rows[0].id);
  }
  const id = "CU-" + Date.now().toString(36).toUpperCase();
  await client.query(
    "INSERT INTO customers (id, desk_id, name, email, telephone, language, state, email_folded, telephone_folded) VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)",
    [id, deskId, e.name ?? "", e.email, e.telephone, e.language, e.email ? foldEmail(e.email) : null, e.telephone ? foldTelephone(e.telephone) : null]
  );
  return id;
}
