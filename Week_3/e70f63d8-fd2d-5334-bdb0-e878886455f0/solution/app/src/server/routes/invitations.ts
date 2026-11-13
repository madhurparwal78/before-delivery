import { copy } from '../../shared/copy.js';
import type { InvitationView } from '../../shared/wire.js';
import { HOUR_MS, now } from '../clock.js';
import { config } from '../config.js';
import type { Db } from '../db/pool.js';
import { direct, transaction } from '../db/pool.js';
import { ApiError, notFound } from '../http/errors.js';
import { authedUser, reply, route } from '../http/router.js';
import { hashToken } from '../http/session.js';

type InvitationRow = { id: string; match_id: string; title: string; sent_at: Date; used_at: Date | null };

const find = async (token: string, lock: boolean, db: Db = direct): Promise<InvitationRow> => {
  const rows = await db.query<InvitationRow>(
    `SELECT i.id, i.match_id, i.sent_at, i.used_at, h.name || ' v ' || a.name AS title
     FROM invitations i JOIN matches m ON m.id = i.match_id JOIN teams h ON h.id = m.home_team_id JOIN teams a ON a.id = m.away_team_id
     WHERE i.token_hash = $1 ${lock ? 'FOR UPDATE OF i' : ''}`, [hashToken(token)]);
  const row = rows[0];
  if (!row) throw notFound();
  return row;
};

/** An invitation is expired once its age reaches `INVITE_TTL_HOURS` hours by the server clock. */
const expired = (row: InvitationRow): boolean => now().getTime() - row.sent_at.getTime() >= config.inviteTtlHours * HOUR_MS;

route('GET', '/api/invitations/:token', {}, async (ctx) => {
  authedUser(ctx);
  const row = await find(ctx.params['token'] ?? '', false);
  const status: InvitationView['status'] = row.used_at !== null ? 'used' : expired(row) ? 'expired' : 'open';
  return reply(200, { match: { id: row.match_id, title: row.title }, status } satisfies InvitationView);
});

route('POST', '/api/invitations/:token/accept', {}, async (ctx) => {
  const user = authedUser(ctx);
  const matchId = await transaction(async (db) => {
    const row = await find(ctx.params['token'] ?? '', true, db);
    if (row.used_at !== null) throw new ApiError(409, 'INVITATION_USED', copy.invitationUsed);
    if (expired(row)) throw new ApiError(409, 'INVITATION_EXPIRED', copy.invitationExpired);
    await db.query('UPDATE invitations SET used_at = $2 WHERE id = $1', [row.id, now()]);
    await db.query('INSERT INTO match_scorers (match_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [row.match_id, user.id]);
    return row.match_id;
  });
  return reply(200, { match_id: matchId });
});
