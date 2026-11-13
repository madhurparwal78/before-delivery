// The billing-week rule, decided once: a line's week is the Monday of the agency-local week
// in which it was created, or the next week that is not closed.
import type { DbClient } from './db.js';
import { weekMondayOf, formatDate, addDaysToDateString } from '../domain/time.js';

export async function assignBillingWeek(client: DbClient, createdInstant: Date, orgId: string): Promise<string> {
  let week = weekMondayOf(formatDate(createdInstant.getTime()));
  for (let guard = 0; guard < 260; guard++) {
    const res = await client.query<{ status: string }>(
      'SELECT status FROM billing_weeks WHERE org_id = $1 AND week_start = $2',
      [orgId, week],
    );
    if (res.rowCount === 0 || res.rows[0].status !== 'closed') return week;
    week = addDaysToDateString(week, 7);
  }
  return week;
}
