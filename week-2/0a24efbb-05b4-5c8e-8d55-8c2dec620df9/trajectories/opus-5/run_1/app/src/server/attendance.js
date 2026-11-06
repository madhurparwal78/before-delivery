import { addDays, businessInstant } from '../shared/businessTime.js';

/** The business day a claimed sign-out falls on: the following day for a night shift. */
export function claimedOutDay(correctionType, day) {
  return correctionType === 'night_shift' ? addDays(day, 1) : day;
}

export function claimedInstants(request) {
  return {
    in: request.claimed_in ? businessInstant(request.day, request.claimed_in) : null,
    out: request.claimed_out ? businessInstant(claimedOutDay(request.correction_type, request.day), request.claimed_out) : null,
  };
}

/**
 * The attendance write an approval makes: the claimed business times become the day's
 * record with source regularisation, keeping any punch the request carries no claim for.
 */
export async function writeApprovedAttendance(client, request) {
  const claimed = claimedInstants(request);
  await client.query(
    `INSERT INTO attendance_day (person_id, day, recorded_in, recorded_out, source)
     VALUES ($1, $2, $3, $4, 'regularisation')
     ON CONFLICT (person_id, day) DO UPDATE
       SET recorded_in = coalesce($3, attendance_day.recorded_in),
           recorded_out = coalesce($4, attendance_day.recorded_out),
           source = 'regularisation'`,
    [request.person_id, request.day, claimed.in, claimed.out],
  );
}

export async function attendanceFor(client, personId, days) {
  const result = await client.query(
    'SELECT day, recorded_in, recorded_out, source FROM attendance_day WHERE person_id = $1 AND day = ANY ($2::date[])',
    [personId, days],
  );
  const byDay = new Map();
  for (const row of result.rows) byDay.set(row.day, row);
  return byDay;
}
