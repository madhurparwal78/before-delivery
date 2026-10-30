import { findAssignments } from '../../db/assignments.js';
import { query } from '../../db/pool.js';
import { endOf, uncoveredMinutes } from '../../domain/assignment.js';
import { addCentralDays, centralDateKey, centralWeekStart, centralWeekday, parseCentralDateKey } from '../../../shared/centralTime.js';
import { isoWithCentralOffset } from '../../domain/time.js';
import { fail } from '../errors.js';
import type { Route } from '../router.js';

export const coverageRoutes: Route[] = [
  {
    kind: 'session',
    method: 'GET',
    path: '/api/coverage',
    body: 'none',
    roles: ['dispatcher'],
    async handler(ctx) {
      const requested = ctx.url.searchParams.get('week');
      let weekStart = centralWeekStart(new Date());
      if (requested !== null) {
        const parsed = parseCentralDateKey(requested);
        if (parsed === null || centralWeekday(parsed) !== 1) {
          fail('validation', { week: 'Choose a Monday written as YYYY-MM-DD.' });
        }
        weekStart = parsed;
      }
      const weekEnd = addCentralDays(weekStart, 7);
      const records = await findAssignments(
        `a.status <> 'cancelled' and a.start_at >= $1 and a.start_at < $2`,
        [weekStart, weekEnd],
      );
      const languages = await query<{ code: string; name: string }>(
        'select code, name from languages order by seed_order',
      );

      return {
        status: 200,
        json: {
          week_start: centralDateKey(weekStart),
          languages: languages.map((language) => {
            const mine = records.filter((record) => record.languageCode === language.code);
            return {
              code: language.code,
              name: language.name,
              uncovered_minutes: uncoveredMinutes(mine),
              assignments: mine.map((record) => ({
                number: record.number,
                status: record.status,
                org_code: record.orgCode,
                setting: record.setting,
                start_at: isoWithCentralOffset(record.startAt),
                end_at: isoWithCentralOffset(endOf(record)),
                duration_minutes: record.durationMinutes,
                seats: record.seats.map((seat) => ({
                  seat: seat.seat,
                  status: seat.status,
                  interpreter_initials: seat.holderInitials,
                })),
              })),
            };
          }),
        },
      };
    },
  },
];
