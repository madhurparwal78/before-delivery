import type { Express, Request, Response } from "express";
import type { Ctx } from "../app.js";
import { requireAuth } from "./auth.js";
import { errors } from "../errors.js";
import { readJson } from "../http.js";
import { enquiryById, stopsForEnquiry } from "../repo.js";
import { wirePost } from "../services.js";
import { checkPlan, largerThanNeeded, suggestPlan, vehicleClassFor, type Party } from "../rules.js";
import { partyFromEnquiry, legRow, ensureLegs } from "./trip-helpers.js";

export function registerTripApi(app: Express, ctx: Ctx): void {
  app.get("/api/enquiries/:id/trip", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    await ensureLegs(ctx, deskId, e);
    res.json(await tripAnswer(ctx, deskId, e));
  });

  app.put("/api/enquiries/:id/trip/stops", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    const body = (await readJson(req)) as Record<string, unknown>;
    const order = Array.isArray(body.order) ? body.order.map(String) : [];
    const stops = await stopsForEnquiry(ctx.db, e.id);
    if (order.length !== stops.length || new Set(order).size !== order.length) throw errors.invalid({ order: "We can't find that." });
    for (const id of order) if (!stops.some((s) => s.id === id)) throw errors.invalid({ order: "We can't find that." });
    for (let i = 0; i < order.length; i++) {
      await ctx.db.query("UPDATE enquiry_stops SET position=$1 WHERE enquiry_id=$2 AND id=$3", [i, e.id, order[i]]);
    }
    const route = await routeCall(ctx, deskId, e, order);
    if (!route) throw errors.provider("Route not updated. Showing the last good route.");
    await writeLegs(ctx, deskId, e.id, route);
    res.json(await tripAnswer(ctx, deskId, e, true));
  });

  app.post("/api/enquiries/:id/trip/route", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    void req.body;
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    const stops = await stopsForEnquiry(ctx.db, e.id);
    const route = await routeCall(ctx, deskId, e, stops.map((s) => s.id));
    if (!route) throw errors.provider("Route not updated. Showing the last good route.");
    await writeLegs(ctx, deskId, e.id, route);
    res.json(await tripAnswer(ctx, deskId, e, true));
  });

  app.put("/api/enquiries/:id/trip/plan", async (req: Request, res: Response) => {
    const deskId = requireAuth(req);
    const e = await enquiryById(ctx.db, deskId, req.params.id);
    if (!e) throw errors.notFound();
    const body = (await readJson(req)) as Record<string, unknown>;
    const sizes = Array.isArray(body.sizes) ? body.sizes.map(Number) : [];
    const party: Party = partyFromEnquiry(e);
    const check = checkPlan(sizes, party);
    if (!check.ok) {
      let message = "We can't find that.";
      if (check.badSize) {
        message = "Choose sizes from 8, 12, 16, 31, 49, 56 and 70.";
      } else if (check.seatsShort !== undefined) {
        message = check.seatsShort === 1 ? "This plan leaves 1 person without a seat." : `This plan leaves ${check.seatsShort} people without a seat.`;
      } else if (check.bagsShort !== undefined) {
        message = check.bagsShort === 1 ? "Bags need 1 more unit of space." : `Bags need ${check.bagsShort} more units of space.`;
      } else if (check.wheelchairsShort !== undefined) {
        message =
          check.wheelchairsShort === 1
            ? "This plan has no lift for 1 wheelchair user."
            : `This plan has no lift for ${check.wheelchairsShort} wheelchair users.`;
      }
      throw errors.invalid({ sizes: message }, message);
    }
    const suggested = suggestPlan(party);
    const larger = largerThanNeeded(sizes, suggested);
    await ctx.db.query(
      `INSERT INTO plan_saves (desk_id, enquiry_id, sizes, suggested, larger_than_needed) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (desk_id, enquiry_id) DO UPDATE SET sizes=$3, suggested=$4, larger_than_needed=$5`,
      [deskId, e.id, sizes, suggested, larger]
    );
    res.json(await tripAnswer(ctx, deskId, e));
  });
}

async function routeCall(
  ctx: Ctx,
  deskId: string,
  e: NonNullable<Awaited<ReturnType<typeof enquiryById>>>,
  order: string[]
): Promise<{ legs: { km: string; minutes: number }[] } | null> {
  const stops = await stopsForEnquiry(ctx.db, e.id);
  const byId = new Map(stops.map((s) => [s.id, s]));
  const texts = order.map((id) => byId.get(id)?.text ?? "").filter(Boolean);
  if (texts.length < 2) return null;
  const plan = await ctx.db.query<{ sizes: number[] }>("SELECT sizes FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id]);
  const sizes = plan.rows[0]?.sizes ?? [49];
  return wirePost<{ legs: { km: string; minutes: number }[] }>(ctx.cfg, "/v1/route", {
    vehicleClass: vehicleClassFor(sizes),
    stops: texts.map((text) => ({ text })),
  });
}

async function writeLegs(ctx: Ctx, deskId: string, enquiryId: string, route: { legs: { km: string; minutes: number }[] }): Promise<void> {
  await ctx.db.query("DELETE FROM legs WHERE enquiry_id=$1", [enquiryId]);
  for (let i = 0; i < route.legs.length; i++) {
    const km = route.legs[i].km;
    const miles = (Number(km) * 0.621371 * 10 + 0.5) / 10;
    await ctx.db.query("INSERT INTO legs (enquiry_id, desk_id, position, km, miles, minutes) VALUES ($1,$2,$3,$4,$5,$6)", [
      enquiryId,
      deskId,
      i,
      km,
      miles.toFixed(1),
      route.legs[i].minutes,
    ]);
  }
}

async function tripAnswer(ctx: Ctx, deskId: string, e: NonNullable<Awaited<ReturnType<typeof enquiryById>>>, markOutOfDate = false) {
  const stops = await stopsForEnquiry(ctx.db, e.id);
  const legRows = (await ctx.db.query("SELECT * FROM legs WHERE enquiry_id=$1 ORDER BY position", [e.id])).rows.map(legRow);
  const plan = await ctx.db.query<{ sizes: number[]; suggested: number[]; larger_than_needed: boolean }>(
    "SELECT sizes, suggested, larger_than_needed FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2",
    [deskId, e.id]
  );
  const party: Party = partyFromEnquiry(e);
  const suggested = suggestPlan(party);
  const hasPlan = plan.rows.length > 0;
  const outOfDate = legRows.length === 0;
  return {
    stops,
    legs: legRows,
    planOutOfDate: markOutOfDate ? false : outOfDate,
    plan: {
      sizes: hasPlan ? plan.rows[0].sizes : null,
      suggested,
      largerThanNeeded: hasPlan ? plan.rows[0].larger_than_needed : false,
    },
  };
}
