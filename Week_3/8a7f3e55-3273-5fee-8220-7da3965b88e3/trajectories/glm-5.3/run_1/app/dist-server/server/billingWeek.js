import { weekMondayOf, formatDate, addDaysToDateString } from '../domain/time.js';
export async function assignBillingWeek(client, createdInstant, orgId) {
    let week = weekMondayOf(formatDate(createdInstant.getTime()));
    for (let guard = 0; guard < 260; guard++) {
        const res = await client.query('SELECT status FROM billing_weeks WHERE org_id = $1 AND week_start = $2', [orgId, week]);
        if (res.rowCount === 0 || res.rows[0].status !== 'closed')
            return week;
        week = addDaysToDateString(week, 7);
    }
    return week;
}
