import { query } from '../db.js';
import type { SharedPlan } from '../../shared/plan.js';
import type { PlanRitual } from '../../shared/plan.js';
import { newToken } from './links.js';
import { totalMinutes } from './hours.js';

export interface ShareLink {
  url: string;
  created_at: string;
}

/** Creates a new share link, which at once replaces any previous one. */
export async function createShareLink(email: string, at: Date): Promise<ShareLink> {
  const token = newToken();
  await query(
    `insert into share_links (email, token, created_at) values ($1, $2, $3)
     on conflict (email) do update set token = excluded.token, created_at = excluded.created_at`,
    [email, token, at],
  );
  return { url: `/p/${token}`, created_at: at.toISOString() };
}

export async function removeShareLink(email: string): Promise<void> {
  await query('delete from share_links where email = $1', [email]);
}

/** The shared view: bedtime, time zone, rituals and total only. */
export async function findSharedPlan(token: string): Promise<SharedPlan | null> {
  const result = await query<{ bedtime: string; time_zone: string; rituals: PlanRitual[] }>(
    `select hours.bedtime, hours.time_zone, hours.rituals
       from share_links join hours on hours.email = share_links.email
      where share_links.token = $1`,
    [token],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    bedtime: row.bedtime,
    time_zone: row.time_zone,
    rituals: row.rituals,
    total_minutes: totalMinutes(row.rituals),
  };
}
