import type { CoverageLanguage, CoverageResponse } from '../../shared/contract.js';
import { agencyDateString, instantOf, parseDateString, partsOf, toAgencyIso } from '../../shared/zone.js';
import { listLanguages, queryAssignments } from '../db/assignments.js';
import { pool } from '../db/pool.js';
import { uncoveredMinutesOf } from '../domain/coverage.js';
import { endInstantOf } from '../domain/records.js';
import { seatViewsFor } from '../domain/visibility.js';
import { ApiError } from '../http/errors.js';
import type { Reply, Route } from '../http/router.js';
import { requireRole } from './support.js';

const coverageBoard: Route = {
  method: 'GET',
  pattern: '/api/coverage',
  body: 'none',
  auth: true,
  handler: async (ctx): Promise<Reply> => {
    requireRole(ctx, ['dispatcher']);
    const raw = ctx.query.get('week') ?? '';
    const date = parseDateString(raw);
    if (date === null) {
      throw new ApiError('validation', { week: 'Give a Monday as YYYY-MM-DD.' });
    }
    const weekStart = instantOf(date.year, date.month, date.day, 0, 0);
    if (partsOf(weekStart).weekday !== 1) {
      throw new ApiError('validation', { week: 'Give a Monday as YYYY-MM-DD.' });
    }
    const weekEnd = instantOf(date.year, date.month, date.day + 7, 0, 0);

    const records = await queryAssignments(pool, { startsBetween: { from: weekStart, to: weekEnd } });
    const languages: CoverageLanguage[] = (await listLanguages()).map((language) => {
      const forLanguage = records.filter((record) => record.language_code === language.code);
      return {
        code: language.code,
        name: language.name,
        uncovered_minutes: uncoveredMinutesOf(forLanguage),
        assignments: forLanguage
          .filter((record) => record.status !== 'cancelled')
          .map((record) => ({
            number: record.number,
            status: record.status,
            org_code: record.org_code,
            setting: record.setting,
            start_at: toAgencyIso(record.start_at),
            end_at: toAgencyIso(endInstantOf(record)),
            duration_minutes: record.duration_minutes,
            seats: seatViewsFor(record, 'holder'),
          })),
      };
    });

    const body: CoverageResponse = { week_start: agencyDateString(weekStart), languages };
    return { status: 200, body };
  },
};

export const coverageRoutes = [coverageBoard];
