import { Router } from 'express';
import { one, query, tx } from '../db/pool.js';
import { fail } from '../errors.js';
import { endSession, requireUser, startSession } from '../http/session.js';
import { FIELD_COPY } from '../../shared/copy.js';
import { publishServer } from '../domain/billing.js';
import { appendEvent } from '../domain/events.js';
import { type ServerRow, loadServerById, planOf, serverObject } from '../domain/servers.js';
import { hashPasscode, newId, verifyPasscode } from '../util.js';
import {
  FieldErrors,
  checkDisplayName,
  checkHandle,
  checkPasscode,
  onlyFields,
  trimmed,
} from '../validate.js';
import { body, created, noContent, ok, route } from './helpers.js';

export const sessionRoutes = Router();

sessionRoutes.get(
  '/health',
  route(async (_req, res) => {
    ok(res, { status: 'ok' });
  }),
);

sessionRoutes.post(
  '/session',
  route(async (req, res) => {
    onlyFields(body(req), ['handle', 'passcode']);
    const errors = new FieldErrors();
    const handle = trimmed(body(req).handle);
    if (handle === '') errors.add('handle', FIELD_COPY.handleRequired);
    const passcode = typeof body(req).passcode === 'string' ? String(body(req).passcode) : '';
    if (passcode === '') errors.add('passcode', FIELD_COPY.passcodeRequired);
    errors.throwIfAny();

    const user = await one<{ id: string; handle: string; display_name: string; passcode_hash: string }>(
      'SELECT id, handle, display_name, passcode_hash FROM users WHERE handle = $1',
      [handle],
    );
    if (user === null || !verifyPasscode(passcode, user.passcode_hash)) {
      throw fail('bad_credentials');
    }
    await startSession(res, user.id);
    ok(res, { user: { handle: user.handle, display_name: user.display_name } });
  }),
);

sessionRoutes.delete(
  '/session',
  route(async (req, res) => {
    await endSession(req, res);
    noContent(res);
  }),
);

sessionRoutes.get(
  '/me',
  route(async (req, res) => {
    const user = await requireUser(req);
    const rows = await query<ServerRow>(
      `SELECT s.* FROM servers s JOIN members m ON m.server_id = s.id
        WHERE m.user_id = $1 ORDER BY s.created_at`,
      [user.id],
    );
    const servers = [];
    for (const row of rows) servers.push(await serverObject(row, user.id));
    ok(res, {
      user: { handle: user.handle, display_name: user.displayName },
      servers,
      preferences: { sound: user.sound },
    });
  }),
);

sessionRoutes.post(
  '/me/preferences',
  route(async (req, res) => {
    const user = await requireUser(req);
    onlyFields(body(req), ['sound']);
    const sound = body(req).sound;
    if (typeof sound !== 'boolean') {
      throw fail('validation', { fields: { sound: 'Use true or false.' } });
    }
    await query('UPDATE users SET sound = $2 WHERE id = $1', [user.id, sound]);
    ok(res, { preferences: { sound } });
  }),
);

interface InviteRow {
  id: string;
  server_id: string;
  inviter_id: string;
  email: string;
  token: string;
  state: 'pending' | 'used' | 'expired' | 'superseded';
  expires_at: Date;
}

async function loadInvite(token: string): Promise<InviteRow> {
  const invite = await one<InviteRow>('SELECT * FROM invites WHERE token = $1', [token]);
  if (invite === null) throw fail('not_found');
  if (invite.state === 'used') throw fail('invite_used');
  if (invite.state === 'superseded') throw fail('invite_superseded');
  if (invite.state === 'expired' || invite.expires_at.getTime() <= Date.now()) {
    await query(`UPDATE invites SET state = 'expired' WHERE id = $1 AND state = 'pending'`, [
      invite.id,
    ]);
    throw fail('invite_expired');
  }
  return invite;
}

sessionRoutes.get(
  '/invites/:token',
  route(async (req, res) => {
    const invite = await loadInvite(req.params.token);
    const server = await loadServerById(invite.server_id);
    const inviter = await one<{ display_name: string }>(
      'SELECT display_name FROM users WHERE id = $1',
      [invite.inviter_id],
    );
    ok(res, {
      server_name: server?.name ?? '',
      inviter: inviter?.display_name ?? '',
      email: invite.email,
    });
  }),
);

sessionRoutes.post(
  '/invites/:token/accept',
  route(async (req, res) => {
    onlyFields(body(req), ['handle', 'display_name', 'passcode']);
    const invite = await loadInvite(req.params.token);
    const server = await loadServerById(invite.server_id);
    if (server === null) throw fail('not_found');

    const errors = new FieldErrors();
    const handle = checkHandle(errors, 'handle', body(req).handle);
    const displayName = checkDisplayName(errors, body(req).display_name);
    const passcode = checkPasscode(errors, body(req).passcode, { minimum: true });
    errors.throwIfAny();

    const taken = await one<{ id: string }>('SELECT id FROM users WHERE handle = $1', [handle]);
    if (taken !== null) {
      throw fail('validation', { fields: { handle: FIELD_COPY.handleTaken } });
    }
    const usedEmail = await one<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      invite.email,
    ]);
    if (usedEmail !== null) throw fail('email_in_use');

    const limit = planOf(server).members;
    const count = await one<{ count: string }>(
      'SELECT count(*) AS count FROM members WHERE server_id = $1',
      [server.id],
    );
    if (Number(count?.count ?? 0) >= limit) {
      throw fail('member_limit_reached', {
        message: `This server's plan allows ${limit} members.`,
      });
    }

    const userId = await tx(async (client) => {
      const id = newId();
      await client.query(
        `INSERT INTO users (id, handle, display_name, email, passcode_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, handle, displayName, invite.email, hashPasscode(passcode)],
      );
      await client.query(
        `INSERT INTO members (server_id, user_id, role) VALUES ($1, $2, 'member')`,
        [server.id, id],
      );
      await client.query(`UPDATE invites SET state = 'used' WHERE id = $1`, [invite.id]);
      return id;
    });

    await startSession(res, userId);
    await publishFriends(server.id);
    await publishServer((await loadServerById(server.id)) ?? server);
    created(res, {
      user: { handle, display_name: displayName },
      server: await serverObject((await loadServerById(server.id)) ?? server, userId),
    });
  }),
);

/** A new member appears in every member's friends list through a friends event. */
export async function publishFriends(serverId: string): Promise<void> {
  const friends = await friendsOf(serverId);
  await appendEvent({
    serverId,
    stream: 'server',
    scopeId: serverId,
    kind: 'friends',
    payload: { friends },
  });
}

export async function friendsOf(
  serverId: string,
): Promise<{ handle: string; display_name: string; online: boolean }[]> {
  const rows = await query<{ handle: string; display_name: string; open_count: number | null }>(
    `SELECT u.handle, u.display_name, p.open_count
       FROM members m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN presence p ON p.server_id = m.server_id AND p.user_id = m.user_id
      WHERE m.server_id = $1
      ORDER BY u.display_name`,
    [serverId],
  );
  return rows.map((row) => ({
    handle: row.handle,
    display_name: row.display_name,
    online: (row.open_count ?? 0) > 0,
  }));
}


