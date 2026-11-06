import type { Actor } from "./auth.js";
import { one, type Db } from "./db.js";
import { ApiError } from "./http.js";
import type { BookingStatus, HoldStatus } from "./rules.js";

export interface SiteRow { id: string; operator_id: string; name: string; time_zone: string; deposit_cents: number; cleaning_fee_cents: number; position: number }
export interface StationRow { id: string; site_id: string; name: string; rate_cents: number; position: number }
export interface RenterRow { id: string; operator_id: string; home_site_id: string; name: string; business: string; email: string; phone: string }
export interface HoldRow { id: string; site_id: string; station_id: string; renter_id: string; status: HoldStatus; created_at: Date; expires_at: Date; quoted_pack_minutes: number }
export interface BookingRow {
  id: string; hold_id: string | null; site_id: string; station_id: string; renter_id: string; status: BookingStatus;
  start_at: Date; end_at: Date; minutes: number; pack_minutes: number; card_minutes: number; card_cents: number; deposit_cents: number;
  cutoff_at: Date | null; deposit_payment_id: string | null; time_payment_id: string | null; policy_version_id: string;
  confirmed_at: Date; checked_in_at: Date | null; checked_out_at: Date | null; overrun_minutes: number | null; overrun_cents: number | null;
  overrun_payment_id: string | null; cleaning_fee_cents: number | null; cleaning_payment_id: string | null;
  card_refund_cents: number; deposit_refund_cents: number; pack_returned_minutes: number; cancelled_at: Date | null;
}

const notFound = (): ApiError => new ApiError(404, "not_found");

/** Sites the actor may see: front desk its own site, everyone else the operator's sites. */
export function siteVisible(actor: Actor, site: { id: string; operator_id: string }): boolean {
  return site.operator_id === actor.operatorId && (actor.role !== "front_desk" || site.id === actor.siteId);
}

export async function siteInScope(db: Db, actor: Actor, siteId: string): Promise<SiteRow> {
  const site = await one<SiteRow>(db, "SELECT * FROM sites WHERE id = $1", [siteId]);
  if (!site || !siteVisible(actor, site)) throw notFound();
  return site;
}

export async function stationInScope(db: Db, actor: Actor, stationId: string): Promise<{ station: StationRow; site: SiteRow }> {
  const station = await one<StationRow>(db, "SELECT * FROM stations WHERE id = $1", [stationId]);
  if (!station) throw notFound();
  return { station, site: await siteInScope(db, actor, station.site_id) };
}

/** Renters of the actor's operator; a renter may only name themself. */
export async function renterInScope(db: Db, actor: Actor, renterId: string): Promise<RenterRow> {
  const renter = await one<RenterRow>(db, "SELECT * FROM renters WHERE id = $1", [renterId]);
  if (!renter || renter.operator_id !== actor.operatorId || (actor.role === "renter" && renter.id !== actor.renterId)) throw notFound();
  return renter;
}

/** A hold or booking: its renter sees it, staff see it at a site in their scope. */
async function recordVisible(db: Db, actor: Actor, record: { renter_id: string; site_id: string }): Promise<boolean> {
  if (actor.role === "renter") return record.renter_id === actor.renterId;
  const site = await one<SiteRow>(db, "SELECT * FROM sites WHERE id = $1", [record.site_id]);
  return site !== null && siteVisible(actor, site);
}

export async function holdInScope(db: Db, actor: Actor, holdId: string, lock = false): Promise<HoldRow> {
  const hold = await one<HoldRow>(db, `SELECT * FROM holds WHERE id = $1${lock ? " FOR NO KEY UPDATE" : ""}`, [holdId]);
  if (!hold || !(await recordVisible(db, actor, hold))) throw notFound();
  return hold;
}

export async function bookingInScope(db: Db, actor: Actor, bookingId: string, lock = false): Promise<BookingRow> {
  const booking = await one<BookingRow>(db, `SELECT * FROM bookings WHERE id = $1${lock ? " FOR NO KEY UPDATE" : ""}`, [bookingId]);
  if (!booking || !(await recordVisible(db, actor, booking))) throw notFound();
  return booking;
}

export async function siteById(db: Db, siteId: string): Promise<SiteRow> {
  const site = await one<SiteRow>(db, "SELECT * FROM sites WHERE id = $1", [siteId]);
  if (!site) throw notFound();
  return site;
}

export async function stationById(db: Db, stationId: string): Promise<StationRow> {
  const station = await one<StationRow>(db, "SELECT * FROM stations WHERE id = $1", [stationId]);
  if (!station) throw notFound();
  return station;
}

export async function renterById(db: Db, renterId: string): Promise<RenterRow> {
  const renter = await one<RenterRow>(db, "SELECT * FROM renters WHERE id = $1", [renterId]);
  if (!renter) throw notFound();
  return renter;
}
