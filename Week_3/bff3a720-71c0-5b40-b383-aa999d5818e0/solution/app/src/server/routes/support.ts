import { isOpenRide } from "../domain/rideStates";
import type { Ctx } from "../http/pipeline";
import { apiErrors } from "../http/errors";
import { isRecord } from "../http/guards";
import { isCity } from "../../shared/towns";
import { loadBooking, loadRide, type BookingRow, type MemberRow, type RideRecord } from "../services/views";


export function bodyOf(ctx: Ctx): Record<string, unknown> {
  return isRecord(ctx.body) ? ctx.body : {};
}

export function memberOf(ctx: Ctx): MemberRow {
  if (!ctx.member) throw apiErrors.unauthenticated();
  return ctx.member;
}

export const hasRole = (member: MemberRow, role: "driver" | "passenger" | "founder"): boolean => member.roles.includes(role);

export function requireRole(member: MemberRow, role: "driver" | "passenger" | "founder"): void {
  if (!hasRole(member, role)) throw apiErrors.forbidden();
}

/** published and changed rides are public; others belong to the driver, its passengers and the founder. */
async function canSeeRide(ctx: Ctx, ride: RideRecord): Promise<boolean> {
  if (isOpenRide(ride.row.state)) return true;
  const member = ctx.member;
  if (!member) return false;
  if (member.id === ride.row.driver_id || hasRole(member, "founder")) return true;
  const { rows } = await ctx.db.query("SELECT 1 FROM bookings WHERE ride_id = $1 AND passenger_id = $2 LIMIT 1", [ride.row.id, member.id]);
  return rows.length > 0;
}

export async function visibleRide(ctx: Ctx, lock = false): Promise<RideRecord> {
  const ride = await loadRide(ctx.db, ctx.params.id as string, lock);
  if (!ride || !(await canSeeRide(ctx, ride))) throw apiErrors.notFound();
  return ride;
}

type BookingSide = "passenger" | "driver" | "founder";

export interface BookingContext {
  ride: RideRecord;
  booking: BookingRow;
  side: BookingSide;
}

/** Find a booking the caller may see (its passenger, its driver, the founder), locking the ride first when asked. */
export async function bookingContext(ctx: Ctx, lock: boolean, id: string = ctx.params.id as string): Promise<BookingContext> {
  const member = memberOf(ctx);
  const peek = await loadBooking(ctx.db, id);
  if (!peek) throw apiErrors.notFound();
  const ride = await loadRide(ctx.db, peek.ride_id, lock);
  const booking = lock ? await loadBooking(ctx.db, id, true) : peek;
  if (!ride || !booking) throw apiErrors.notFound();
  const side: BookingSide | null = member.id === booking.passenger_id ? "passenger" : member.id === ride.row.driver_id ? "driver" : hasRole(member, "founder") ? "founder" : null;
  if (!side) throw apiErrors.notFound();
  return { ride, booking, side };
}

/** The passenger and the driver of a booking only; the founder cannot read a thread or a rating. */
export async function participantContext(ctx: Ctx, lock: boolean): Promise<BookingContext> {
  const found = await bookingContext(ctx, lock);
  if (found.side === "founder") throw apiErrors.notFound();
  return found;
}

export function onlySide(found: BookingContext, side: BookingSide): void {
  if (found.side !== side) throw apiErrors.forbidden();
}

export function stopsFromQuery(raw: string | null): string[] {
  return (raw ?? "").split(",").map((part) => part.trim()).filter((part) => part.length > 0);
}

export function validCities(values: unknown): values is import("../../shared/towns").City[] {
  return Array.isArray(values) && values.every(isCity);
}
