import type { AgencySettings } from '../../../shared/api.js';
import { queryOne } from '../../db/pool.js';
import {
  ACCEPTED_TYPES,
  AGENCY,
  MAX_FILES_PER_BOOKING,
  UPLOAD_LIMIT_BYTES,
  openCallLeadMinutes,
  prepAccessGraceMinutes,
  prepLinkTtlSeconds,
} from '../../domain/agency.js';
import { agencyDate, agencyIso } from '../../domain/time.js';
import { toSessionUser, type UserRow } from '../../store/people.js';
import { apiError } from '../errors.js';
import { verifyPassword } from '../passwords.js';
import { actor, route } from '../router.js';
import { createSession, deleteSession, readCookie, SESSION_COOKIE } from '../sessions.js';

route(
  'GET',
  '/api/health',
  async () => ({ status: 200, body: { status: 'ok' } }),
  { anonymous: true },
);

route(
  'POST',
  '/api/session',
  async (ctx) => {
    const email = ctx.body['email'];
    const password = ctx.body['password'];
    if (typeof email !== 'string' || typeof password !== 'string') {
      throw apiError('invalid_credentials');
    }
    const row = await queryOne<UserRow & { password_hash: string }>(
      `SELECT id, name, email, role, org_id, initials, phone, home_city, pay_rate_cents, password_hash
       FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw apiError('invalid_credentials');
    }
    const token = await createSession(row.id);
    ctx.setSessionCookie(token);
    return { status: 200, body: { user: toSessionUser(row) } };
  },
  { anonymous: true },
);

route('DELETE', '/api/session', async (ctx) => {
  const token = readCookie(ctx.req, SESSION_COOKIE);
  if (token !== null) await deleteSession(token);
  ctx.setSessionCookie(null);
  return { status: 204 };
});

route('GET', '/api/me', async (ctx) => ({ status: 200, body: actor(ctx) }));

route('GET', '/api/agency', async (ctx) => {
  const settings: AgencySettings = {
    name: AGENCY.name,
    time_zone: AGENCY.timeZone,
    now: agencyIso(ctx.now),
    today: agencyDate(ctx.now),
    solo_threshold_minutes: AGENCY.soloThresholdMinutes,
    open_call_lead_minutes: openCallLeadMinutes(),
    prep_access_grace_minutes: prepAccessGraceMinutes(),
    prep_link_ttl_seconds: prepLinkTtlSeconds(),
    upload_limit_bytes: UPLOAD_LIMIT_BYTES,
    max_files_per_booking: MAX_FILES_PER_BOOKING,
    accepted_types: [...ACCEPTED_TYPES],
  };
  return { status: 200, body: settings };
});
