import type { Ctx } from "../app.js";
import type { EnquiryRow } from "../repo.js";
import type { Party } from "../rules.js";
import { wirePost } from "../services.js";
import { vehicleClassFor } from "../rules.js";

export function partyFromEnquiry(e: EnquiryRow): Party {
  return { people: e.people, large: e.large, medium: e.medium, hand: e.hand, wheelchairs: e.wheelchairs };
}

export function legRow(r: Record<string, unknown>): { km: string; minutes: number; miles: string } {
  return { km: String(r.km), minutes: Number(r.minutes), miles: String(r.miles) };
}

/** One route call per read of a trip with no legs yet, per DP-13/14. */
export async function ensureLegs(ctx: Ctx, deskId: string, e: EnquiryRow): Promise<void> {
  const existing = await ctx.db.query("SELECT 1 FROM legs WHERE enquiry_id=$1 LIMIT 1", [e.id]);
  if (existing.rows.length) return;
  const stops = await ctx.db.query("SELECT text FROM enquiry_stops WHERE enquiry_id=$1 ORDER BY position", [e.id]);
  if (stops.rows.length < 2) return;
  const plan = await ctx.db.query<{ sizes: number[] }>("SELECT sizes FROM plan_saves WHERE desk_id=$1 AND enquiry_id=$2", [deskId, e.id]);
  const sizes = plan.rows[0]?.sizes ?? [49];
  const answer = await wirePost<{ legs: { km: string; minutes: number }[] }>(ctx.cfg, "/v1/route", {
    vehicleClass: vehicleClassFor(sizes),
    stops: stops.rows.map((x) => ({ text: String(x.text) })),
  });
  if (!answer) return;
  await ctx.db.query("DELETE FROM legs WHERE enquiry_id=$1", [e.id]);
  for (let i = 0; i < answer.legs.length; i++) {
    const km = answer.legs[i].km;
    const miles = (Number(km) * 0.621371 * 10 + 0.5) / 10;
    await ctx.db.query("INSERT INTO legs (enquiry_id, desk_id, position, km, miles, minutes) VALUES ($1,$2,$3,$4,$5,$6)", [
      e.id,
      deskId,
      i,
      km,
      miles.toFixed(1),
      answer.legs[i].minutes,
    ]);
  }
}
