import { q } from "./db.js";
import type { SessionUser } from "../shared/types.js";
import { notFound, forbidden } from "./errors.js";

export interface SiteRow {
  id: string;
  operator_id: string;
  name: string;
  time_zone: string;
  deposit_cents: number;
  cleaning_fee_cents: number;
}

export async function getSite(id: string): Promise<SiteRow | null> {
  const r = await q(`SELECT * FROM sites WHERE id = $1`, [id]);
  return (r.rows[0] as SiteRow | undefined) ?? null;
}

/** Sites the caller may see, enforcing operator / front-desk scope. */
export async function visibleSites(user: SessionUser): Promise<SiteRow[]> {
  if (user.role === "front_desk") {
    const r = await q(`SELECT * FROM sites WHERE id = ANY($1::text[]) ORDER BY id`, [user.site_ids]);
    return r.rows as unknown as SiteRow[];
  }
  const r = await q(`SELECT * FROM sites WHERE operator_id = $1 ORDER BY id`, [user.operator_id]);
  return r.rows as unknown as SiteRow[];
}

/** A site the caller may act on, or not_found. */
export async function siteInScope(user: SessionUser, siteId: string): Promise<SiteRow> {
  const site = await getSite(siteId);
  if (!site) throw notFound();
  if (user.role === "manager" || user.role === "renter") {
    if (site.operator_id !== user.operator_id) throw notFound();
    return site;
  }
  if (!user.site_ids.includes(siteId)) throw notFound();
  return site;
}

export interface StationRow {
  id: string;
  site_id: string;
  name: string;
  rate_cents: number;
  ordinal: number;
}

export async function stationInScope(user: SessionUser, stationId: string): Promise<StationRow> {
  const r = await q(`SELECT * FROM stations WHERE id = $1`, [stationId]);
  const st = r.rows[0] as StationRow | undefined;
  if (!st) throw notFound();
  await siteInScope(user, st.site_id);
  return st;
}

export interface RenterRow {
  id: string;
  operator_id: string;
  home_site_id: string;
  user_id: string;
  name: string;
  business: string;
  email: string;
  phone: string;
}

export async function getRenter(id: string): Promise<RenterRow | null> {
  const r = await q(`SELECT * FROM renters WHERE id = $1`, [id]);
  return (r.rows[0] as RenterRow | undefined) ?? null;
}

/** A renter in the caller's scope (staff of the operator, or the renter themself). */
export async function renterInScope(user: SessionUser, renterId: string): Promise<RenterRow> {
  const renter = await getRenter(renterId);
  if (!renter) throw notFound();
  if (user.role === "renter") {
    if (user.renter_id !== renter.id) throw notFound();
    return renter;
  }
  if (renter.operator_id !== user.operator_id) throw notFound();
  return renter;
}

/** A renter the caller may act on behalf of (staff only, any site of the operator). */
export async function renterForStaff(user: SessionUser, renterId: string): Promise<RenterRow> {
  if (user.role === "renter") throw forbidden();
  const renter = await getRenter(renterId);
  if (!renter || renter.operator_id !== user.operator_id) throw notFound();
  return renter;
}

export function requireRole(user: SessionUser, roles: SessionUser["role"][]): void {
  if (!roles.includes(user.role)) throw forbidden();
}
