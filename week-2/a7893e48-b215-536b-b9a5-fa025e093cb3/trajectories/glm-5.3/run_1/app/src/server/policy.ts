import { q } from "./db.js";
import { localDate, resolveWallTime, wallParts } from "../shared/time.js";

export interface PolicyRow {
  id: string;
  notice_hours: number;
  effective_from: string;
  effective_at: Date;
  created_by_name: string;
  created_at: Date;
}

export async function policiesForSite(siteId: string): Promise<PolicyRow[]> {
  const r = await q(
    `SELECT pv.id, pv.notice_hours, to_char(pv.effective_from,'YYYY-MM-DD') AS effective_from,
            pv.effective_at, pv.created_at, u.name AS created_by_name
     FROM policy_versions pv JOIN app_users u ON u.id = pv.created_by
     WHERE pv.site_id = $1 ORDER BY pv.effective_at ASC`,
    [siteId],
  );
  return r.rows as unknown as PolicyRow[];
}

/** The version whose effective_at is latest and not after the booking's confirmed_at. */
export function versionInForce(versions: PolicyRow[], confirmedAt: Date): PolicyRow | null {
  let best: PolicyRow | null = null;
  for (const v of versions) {
    if (v.effective_at.getTime() <= confirmedAt.getTime() && (!best || v.effective_at.getTime() > best.effective_at.getTime())) best = v;
  }
  return best;
}

/** The unpaid cutoff: local start wall time on the local date two days earlier. */
export function cutoffFor(tz: string, startAt: Date): Date {
  const p = wallParts(tz, startAt.getTime());
  const twoDays = new Date(Date.UTC(p.y, p.m - 1, p.d) - 2 * 86400000);
  const t = resolveWallTime(tz, {
    y: twoDays.getUTCFullYear(), m: twoDays.getUTCMonth() + 1, d: twoDays.getUTCDate(), hh: p.hh, mm: p.mm,
  });
  return new Date(t);
}

/** The refund tier, decided in one place: full when now <= start - notice, else none. */
export function refundTier(now: Date, startAt: Date, noticeHours: number): "full" | "none" {
  return now.getTime() <= startAt.getTime() - noticeHours * 3600000 ? "full" : "none";
}

export async function todayInZone(tz: string): Promise<string> {
  return localDate(tz, Date.now());
}
