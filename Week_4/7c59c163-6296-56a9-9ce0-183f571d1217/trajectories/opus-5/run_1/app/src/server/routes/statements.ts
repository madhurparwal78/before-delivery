import { pool } from '../db/pool.js';
import { ValidationError } from '../http/errors.js';
import { json, memberRoute } from '../http/router.js';
import { iso } from '../domain/views.js';
import { isMonth, asObject, onlyFields, readString } from '../domain/validate.js';
import { monthHasEnded } from '../domain/time.js';
import { presignGet, up as storageUp } from '../providers/s3.js';
import { ProviderUnreachable } from '../providers/http.js';
import { clearFailedRun, generateStatements, statementsUnavailable } from '../statements.js';
import { ownStatement } from './common.js';
import type { Venue } from '../domain/types.js';
import type { Route } from '../http/router.js';

export const statementRoutes: Route[] = [
  memberRoute('GET', '/api/statements', { venue: true }, async ({ actor }) => {
    const result = await pool.query<{ id: string; month: string; created_at: Date }>(
      'select id, month, created_at from statements where member_id = $1 order by month desc',
      [actor.member.id],
    );
    return json(200, {
      statements: result.rows.map((row) => ({
        id: row.id,
        month: row.month,
        created_at: iso(row.created_at),
      })),
    });
  }),

  memberRoute('GET', '/api/statements/:id/link', { resource: ownStatement }, async ({ resource }) => {
    if (!(await storageUp())) throw statementsUnavailable();
    const link = presignGet(resource.object_key);
    return json(200, { url: link.url, expires_at: iso(link.expiresAt) });
  }),

  memberRoute(
    'POST',
    '/api/venue/statements',
    { venue: true, roles: ['org_owner'] },
    async ({ actor, body }) => {
      const venue = actor.venue as Venue;
      const fields = asObject(body);
      onlyFields(fields, ['month']);
      const month = readString(fields, 'month');
      if (!isMonth(month)) throw new ValidationError({ month: 'invalid' });
      if (!monthHasEnded(venue.time_zone, month)) throw new ValidationError({ month: 'not_closed' });

      try {
        const run = await generateStatements(venue, month);
        return json(run.started ? 202 : 200, { month, members: run.members });
      } catch (error) {
        if (error instanceof ProviderUnreachable) {
          await clearFailedRun(venue.id, month);
          throw statementsUnavailable();
        }
        throw error;
      }
    },
  ),
];
