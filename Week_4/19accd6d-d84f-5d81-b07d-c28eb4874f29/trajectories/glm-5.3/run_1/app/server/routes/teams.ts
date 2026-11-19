import { Router } from 'express';
import { pool } from '../db.js';
import { config } from '../config.js';
import { ApiError, notFound, validation, handle } from '../errors.js';
import { hashToken, newId, newToken } from '../ids.js';
import { requireUser } from '../auth.js';
import { sendMail } from '../mail.js';
import { broadcastMembership } from '../live.js';

export const teamsRouter = Router();

teamsRouter.post('/', handle(async (req, res) => {
  const user = requireUser(req);
  const name = (req.body ?? {}).name;
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 60) {
    throw validation({ name: 'Team name needs 1 to 60 characters.' });
  }
  const id = newId('t');
  await pool.query('INSERT INTO teams (id, name, owner_id) VALUES ($1, $2, $3)', [id, name.trim(), user.id]);
  await pool.query('INSERT INTO team_members (team_id, user_id, role) VALUES ($1, $2, \'owner\')', [id, user.id]);
  const team = await teamBody(id, user.id);
  res.status(201).json({ team });
}));

async function teamBody(teamId: string, viewerId: string): Promise<unknown> {
  const t = await pool.query<{ id: string; name: string; owner_id: string }>('SELECT id, name, owner_id FROM teams WHERE id = $1', [teamId]);
  if (!t.rows[0]) throw notFound();
  const members = await pool.query<{ id: string; display_name: string; email: string; role: string }>(
    `SELECT u.id, u.display_name, u.email, tm.role FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = $1 ORDER BY u.display_name`,
    [teamId],
  );
  const invites = await pool.query<{ email: string; expires_at: Date }>(
    'SELECT email, expires_at FROM invites WHERE team_id = $1 AND NOT accepted AND expires_at > now() ORDER BY created_at',
    [teamId],
  );
  const owner = members.rows.find((m) => m.id === t.rows[0].owner_id);
  return {
    id: t.rows[0].id,
    name: t.rows[0].name,
    owner: { id: t.rows[0].owner_id, displayName: owner?.display_name ?? '' },
    members: members.rows.map((m) => ({ id: m.id, displayName: m.display_name, email: m.email, role: m.role })),
    invites: invites.rows.map((i) => ({ email: i.email, expiresAt: i.expires_at.toISOString() })),
  };
}

/** The one team-cap check (Engineering standards). */
async function teamFull(teamId: string): Promise<boolean> {
  const c = await pool.query<{ count: string }>('SELECT count(*) AS count FROM team_members WHERE team_id = $1', [teamId]);
  return Number(c.rows[0].count) >= config().teamMax;
}

teamsRouter.get('/:id', handle(async (req, res) => {
  const user = requireUser(req);
  const member = await pool.query('SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2', [req.params.id, user.id]);
  if (!member.rows[0]) throw notFound();
  res.json({ team: await teamBody(req.params.id, user.id) });
}));

teamsRouter.post('/:id/invites', handle(async (req, res) => {
  const user = requireUser(req);
  const teamId = req.params.id;
  const member = await pool.query<{ role: string }>('SELECT role FROM team_members WHERE team_id = $1 AND user_id = $2', [teamId, user.id]);
  if (!member.rows[0]) throw notFound();
  if (member.rows[0].role !== 'owner') throw new ApiError(403, 'forbidden', 'Only the team owner can do this.');
  const email = (req.body ?? {}).email;
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw validation({ email: 'Enter a valid email address.' });
  const normalized = email.trim().toLowerCase();

  const existingMember = await pool.query('SELECT 1 FROM team_members tm JOIN users u ON u.id = tm.user_id WHERE tm.team_id = $1 AND u.email_ci = $2', [teamId, normalized]);
  if (existingMember.rows[0]) throw new ApiError(409, 'already_member', `${normalized} is already in this team.`);
  if (await teamFull(teamId)) {
    throw new ApiError(409, 'team_full', `This team is full (${config().teamMax} of ${config().teamMax}).`);
  }

  const team = await pool.query<{ name: string }>('SELECT name FROM teams WHERE id = $1', [teamId]);
  const token = newToken(24);
  await pool.query(
    'INSERT INTO invites (id, team_id, email, token_hash, expires_at) VALUES ($1, $2, $3, $4, now() + ($5 || \' seconds\')::interval)',
    [newId('iv'), teamId, normalized, hashToken(token), config().inviteTtlSeconds],
  );
  await sendMail(normalized, `Join ${team.rows[0].name} on Wringbench`, `${user.displayName} invites you to join ${team.rows[0].name} on Wringbench.\nAccept here: ${config().publicUrl}/invite/${token}`);
  const expiresAt = new Date(Date.now() + config().inviteTtlSeconds * 1000).toISOString();
  res.status(201).json({ invite: { email: normalized, expiresAt } });
}));

teamsRouter.delete('/:id/members/:userId', handle(async (req, res) => {
  const user = requireUser(req);
  const teamId = req.params.id;
  const role = await pool.query<{ role: string; owner_id: string }>(
    'SELECT tm.role, t.owner_id FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.team_id = $1 AND tm.user_id = $2',
    [teamId, user.id],
  );
  if (!role.rows[0]) throw notFound();
  if (role.rows[0].role !== 'owner') throw new ApiError(403, 'forbidden', 'Only the team owner can do this.');
  if (req.params.userId === role.rows[0].owner_id) throw new ApiError(409, 'cannot_remove_owner', 'The owner cannot be removed.');
  const removed = await pool.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2 RETURNING user_id', [teamId, req.params.userId]);
  if (!removed.rows[0]) throw notFound();
  broadcastMembership(teamId);
  res.status(204).end();
}));
