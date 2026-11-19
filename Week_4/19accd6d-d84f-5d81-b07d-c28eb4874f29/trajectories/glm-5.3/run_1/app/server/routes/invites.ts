import { Router } from 'express';
import { pool } from '../db.js';
import { config } from '../config.js';
import { ApiError, notFound, handle } from '../errors.js';
import { hashToken } from '../ids.js';
import { requireUser } from '../auth.js';
import { broadcastMembership } from '../live.js';

export const invitesRouter = Router();

async function pendingInvite(token: string) {
  const r = await pool.query<{ id: string; team_id: string; email: string; expires_at: Date; team_name: string; owner_name: string }>(
    `SELECT i.id, i.team_id, i.email, i.expires_at, t.name AS team_name, u.display_name AS owner_name
     FROM invites i JOIN teams t ON t.id = i.team_id JOIN users u ON u.id = t.owner_id
     WHERE i.token_hash = $1 AND NOT i.accepted AND i.expires_at > now()`,
    [hashToken(token)],
  );
  return r.rows[0] ?? null;
}

invitesRouter.get('/:token', handle(async (req, res) => {
  const invite = await pendingInvite(req.params.token);
  if (!invite) throw notFound();
  res.json({ invite: { teamName: invite.team_name, inviterName: invite.owner_name, email: invite.email } });
}));

invitesRouter.post('/:token/accept', handle(async (req, res) => {
  const user = requireUser(req);
  const invite = await pendingInvite(req.params.token);
  if (!invite) throw notFound();
  if (user.email !== invite.email) {
    throw new ApiError(403, 'invite_wrong_account', `This invite was sent to ${invite.email}.`);
  }
  const count = await pool.query<{ count: string }>('SELECT count(*) AS count FROM team_members WHERE team_id = $1', [invite.team_id]);
  if (Number(count.rows[0].count) >= config().teamMax) {
    throw new ApiError(409, 'team_full', `This team is full (${config().teamMax} of ${config().teamMax}).`);
  }
  await pool.query('UPDATE invites SET accepted = true WHERE id = $1', [invite.id]);
  await pool.query('INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, \'member\') ON CONFLICT DO NOTHING', [invite.team_id, user.id]);
  broadcastMembership(invite.team_id);
  const t = await pool.query<{ id: string; name: string; owner_id: string }>('SELECT id, name, owner_id FROM teams WHERE id = $1', [invite.team_id]);
  const members = await pool.query<{ id: string; display_name: string; email: string; role: string }>(
    `SELECT u.id, u.display_name, u.email, tm.role FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = $1 ORDER BY u.display_name`,
    [invite.team_id],
  );
  const owner = members.rows.find((m) => m.id === t.rows[0].owner_id);
  res.json({
    team: {
      id: t.rows[0].id,
      name: t.rows[0].name,
      owner: { id: t.rows[0].owner_id, displayName: owner?.display_name ?? '' },
      members: members.rows.map((m) => ({ id: m.id, displayName: m.display_name, email: m.email, role: m.role })),
    },
  });
}));
