// Tenant, site and owner scope. Every id lookup goes through here: outside the caller's scope is
// exactly as unknown as an id that does not exist (404).
import { one, pool, type Db } from "./db.ts";
import { ApiError } from "./http.ts";
import { isUuid } from "./validate.ts";
import type { SessionUser } from "./auth.ts";
import type { StationKind } from "../shared/rules.ts";
import type { BookingStatus } from "../shared/api.ts";

type Queryable = Db | typeof pool;

function found<T>(row: T | undefined): T {
  if (row === undefined) throw new ApiError("not_found");
  return row;
}

function requireId(id: unknown): string {
  if (!isUuid(id)) throw new ApiError("not_found");
  return id;
}

interface SiteRow {
  id: string;
  tenant_id: string;
  name: string;
  time_zone: string;
  address: string;
}

/** A site of the caller's tenant; a kitchen manager sees only their own site. */
export async function siteFor(db: Queryable, user: SessionUser, id: unknown): Promise<SiteRow> {
  const siteId = requireId(id);
  if (user.role === "kitchen_manager" && user.siteId !== siteId) throw new ApiError("not_found");
  return found(
    await one<SiteRow>(db, "SELECT id, tenant_id, name, time_zone, address FROM sites WHERE id = $1 AND tenant_id = $2", [
      siteId,
      user.tenantId,
    ]),
  );
}

export interface StationRow {
  id: string;
  site_id: string;
  name: string;
  kind: StationKind;
  time_zone: string;
}

export async function stationFor(db: Queryable, user: SessionUser, id: unknown): Promise<StationRow> {
  return found(
    await one<StationRow>(
      db,
      `SELECT st.id, st.site_id, st.name, st.kind, s.time_zone FROM stations st JOIN sites s ON s.id = st.site_id
        WHERE st.id = $1 AND s.tenant_id = $2`,
      [requireId(id), user.tenantId],
    ),
  );
}

interface BookingScopeRow {
  id: string;
  member_id: string;
  site_id: string;
  status: BookingStatus;
}

/** A booking the member owns, or one at the kitchen manager's site. */
export async function bookingFor(db: Queryable, user: SessionUser, id: unknown): Promise<BookingScopeRow> {
  const row = found(
    await one<BookingScopeRow>(db, "SELECT id, member_id, site_id, status FROM bookings WHERE id = $1 AND tenant_id = $2", [
      requireId(id),
      user.tenantId,
    ]),
  );
  if (user.role === "member" && row.member_id !== user.memberId) throw new ApiError("not_found");
  if (user.role === "kitchen_manager" && row.site_id !== user.siteId) throw new ApiError("not_found");
  return row;
}

interface MemberScopeRow {
  id: string;
  business_name: string;
  home_site_id: string;
}

/** A member of the caller's tenant; a kitchen manager sees only members homed at their site. */
export async function memberFor(db: Queryable, user: SessionUser, id: unknown): Promise<MemberScopeRow> {
  const row = found(
    await one<MemberScopeRow>(db, "SELECT id, business_name, home_site_id FROM members WHERE id = $1 AND tenant_id = $2", [
      requireId(id),
      user.tenantId,
    ]),
  );
  if (user.role === "kitchen_manager" && row.home_site_id !== user.siteId) throw new ApiError("not_found");
  if (user.role === "member" && row.id !== user.memberId) throw new ApiError("not_found");
  return row;
}

interface DocumentScopeRow {
  id: string;
  member_id: string;
}

export async function documentFor(db: Queryable, user: SessionUser, id: unknown): Promise<DocumentScopeRow> {
  const row = found(
    await one<DocumentScopeRow>(
      db,
      "SELECT d.id, d.member_id FROM documents d JOIN members m ON m.id = d.member_id WHERE d.id = $1 AND m.tenant_id = $2",
      [requireId(id), user.tenantId],
    ),
  );
  await memberFor(db, user, row.member_id);
  return row;
}

export interface TruckRow {
  id: string;
  member_id: string;
  name: string;
  permit_number: string;
  business_name: string;
  tenant_id: string;
  site_id: string;
  site_name: string;
  address: string;
  time_zone: string;
}

const TRUCK_SELECT = `
  SELECT t.id, t.member_id, t.name, t.permit_number, m.business_name, m.tenant_id,
         s.id AS site_id, s.name AS site_name, s.address, s.time_zone
    FROM trucks t JOIN members m ON m.id = t.member_id JOIN sites s ON s.id = m.home_site_id`;

export async function truckById(db: Queryable, id: string): Promise<TruckRow | undefined> {
  return one<TruckRow>(db, `${TRUCK_SELECT} WHERE t.id = $1`, [id]);
}

/** The member's own truck, or a truck homed at the kitchen manager's site. */
export async function truckFor(db: Queryable, user: SessionUser, id: unknown): Promise<TruckRow> {
  const row = found(await one<TruckRow>(db, `${TRUCK_SELECT} WHERE t.id = $1 AND m.tenant_id = $2`, [requireId(id), user.tenantId]));
  await memberFor(db, user, row.member_id);
  return row;
}

export async function visitFor(db: Queryable, user: SessionUser, id: unknown): Promise<{ id: string; truck_id: string }> {
  const row = found(await one<{ id: string; truck_id: string }>(db, "SELECT id, truck_id FROM visits WHERE id = $1", [requireId(id)]));
  await truckFor(db, user, row.truck_id);
  return row;
}

export async function linkFor(db: Queryable, user: SessionUser, id: unknown): Promise<{ id: string; truck_id: string }> {
  const row = found(await one<{ id: string; truck_id: string }>(db, "SELECT id, truck_id FROM inspector_links WHERE id = $1", [requireId(id)]));
  await truckFor(db, user, row.truck_id);
  return row;
}

interface PackRow {
  id: string;
  name: string;
  quarters: number;
  price_cents: number;
}

export async function packFor(db: Queryable, user: SessionUser, id: unknown): Promise<PackRow> {
  return found(
    await one<PackRow>(db, "SELECT id, name, quarters, price_cents FROM packs WHERE id = $1 AND tenant_id = $2", [requireId(id), user.tenantId]),
  );
}

/** The signed-in member's id; member-only routes guarantee it. */
export function ownMemberId(user: SessionUser): string {
  return user.memberId ?? found<string>(undefined);
}
