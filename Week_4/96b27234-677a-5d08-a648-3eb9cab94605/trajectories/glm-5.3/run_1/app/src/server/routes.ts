// All REST routes. Refusals follow the one error order: 401, 404, 409, 422, 429.
import { Router, type Request, type Response } from 'express';
import { config, opaqueId, sha256Hex, token } from './config';
import { ApiError, conflict, invalid, notFound, signInFirst } from './errors';
import { query } from './db';
import { createSessionCookie, clearSessionCookie, destroySessionCookie } from './app';
import { s3, valkey } from './providers';
import { isDown, worldClock } from './world';
import {
  allStates,
  clearPresence,
  getPerson,
  getSession,
  isMember,
  meSocketsFor,
  publishEvent,
  requireValkey,
} from './live';
import { projectPeople } from './projection';
import {
  castBallot,
  closeDueVote,
  joinSession,
  leaveSession,
  mayJoinSession,
  openSession,
  sessionCount,
  sit,
  stand,
  startVote,
  step,
  type VoteRow,
} from './sessions';
import { chatRecipients, saveChatMessage, chatLogFor, userPerceivedLength } from './live';
import { queueMail } from './mail';
import { ZONES } from './zones';
import { flushOutbox } from './mail';

const router = Router();

function auth(req: Request): { personId: string; worldId: string } {
  if (!req.auth) throw signInFirst();
  return req.auth;
}

function json(res: Response, status: number, body: unknown): void {
  res.status(status).json(body);
}

// Health: no session, answers within one second, never 503.
router.get('/health', async (_req, res) => {
  let ok = true;
  if (isDown('valkey')) ok = false;
  if (isDown('minio')) ok = false;
  if (ok) {
    try {
      await Promise.race([valkey.command('PING'), new Promise((_, rej) => setTimeout(() => rej(new Error()), 800))]);
    } catch {
      ok = false;
    }
  }
  if (ok) {
    try {
      await s3.request('GET', '', null);
    } catch {
      ok = false;
    }
  }
  json(res, 200, { status: ok ? 'ok' : 'unavailable' });
});

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/signup', async (req, res) => {
  const body = req.body as { email?: unknown; password?: unknown; displayName?: unknown; timeZone?: unknown };
  if (typeof body.email !== 'string' || !EMAIL_RE.test(body.email)) throw invalid('Enter a valid email address.');
  if (typeof body.password !== 'string' || body.password.length < 10) throw invalid('Passwords need at least 10 characters.');
  if (typeof body.displayName !== 'string' || body.displayName.length < 1 || body.displayName.length > 40) {
    throw invalid('Give a display name of 1 to 40 characters.');
  }
  if (typeof body.timeZone !== 'string' || !ZONES.some((z) => z.zone === body.timeZone)) {
    throw invalid('Choose a time zone from the list.');
  }
  const existing = await query('SELECT 1 FROM people WHERE email = $1', [body.email]);
  if (!existing.length) {
    const confirmToken = token();
    await query(
      `INSERT INTO people (id, world_id, email, password_hash, display_name, time_zone, site_role, confirmed, confirm_token)
       VALUES ($1, 'default', $2, $3, $4, $5, 'member', false, $6)
       ON CONFLICT (email) DO NOTHING`,
      [opaqueId(), body.email, sha256Hex(body.password), body.displayName, body.timeZone, confirmToken]
    );
    const link = `${publicUrl(req)}/confirm/${confirmToken}`;
    await queueMail('default', body.email, 'Confirm your Hearthtile account', `Confirm your account: ${link}`);
    void flushOutbox('default');
  }
  json(res, 202, { status: 'check-your-email' });
});

function publicUrl(req: Request): string {
  if (config.publicUrl) return config.publicUrl;
  return `${req.protocol}://${req.headers.host}`;
}

router.post('/confirm/:token', async (req, res) => {
  const rows = await query<{ id: string }>(
    'SELECT id FROM people WHERE confirm_token = $1 AND NOT confirmed',
    [req.params.token]
  );
  if (!rows.length) throw notFound();
  await query('UPDATE people SET confirmed = true, confirm_token = NULL WHERE id = $1', [rows[0].id]);
  json(res, 200, { status: 'confirmed' });
});

router.post('/signin', async (req, res) => {
  const body = req.body as { email?: unknown; password?: unknown };
  if (typeof body.email !== 'string' || typeof body.password !== 'string') {
    throw new ApiError(401, 'Email or password is wrong.');
  }
  const rows = await query<{ id: string; password_hash: string; suspended: boolean; confirmed: boolean }>(
    'SELECT id, password_hash, suspended, confirmed FROM people WHERE email = $1',
    [body.email]
  );
  if (!rows.length || rows[0].password_hash !== sha256Hex(body.password) || !rows[0].confirmed || rows[0].suspended) {
    throw new ApiError(401, 'Email or password is wrong.');
  }
  res.setHeader('Set-Cookie', createSessionCookie(rows[0].id));
  const person = await getPerson(rows[0].id);
  json(res, 200, {
    personId: rows[0].id,
    displayName: person?.display_name,
    siteRole: person?.site_role,
    timeZone: person?.time_zone,
  });
});

router.post('/signout', async (req, res) => {
  destroySessionCookie(req);
  const personId = req.auth?.personId;
  res.setHeader('Set-Cookie', clearSessionCookie());
  if (personId) await clearPresence(personId);
  json(res, 200, { status: 'signed-out' });
});

router.get('/me', async (req, res) => {
  const { personId } = auth(req);
  const rows = await query(
    'SELECT id, display_name, email, time_zone, site_role, avatar_id, hide_above, world_id FROM people WHERE id = $1',
    [personId]
  );
  if (!rows.length) throw notFound();
  const r = rows[0];
  json(res, 200, {
    personId: r.id,
    displayName: r.display_name,
    email: r.email,
    siteRole: r.site_role,
    timeZone: r.time_zone,
    avatarId: r.avatar_id,
    hideAbove: r.hide_above,
    worldId: r.world_id,
  });
});

router.put('/me/avatar', async (req, res) => {
  const { personId } = auth(req);
  const body = req.body as { avatarId?: unknown };
  if (typeof body.avatarId !== 'string') throw invalid('Choose an avatar to wear.');
  const rows = await query<{ world_id: string; current_version: number | null }>(
    'SELECT world_id, current_version FROM assets WHERE id = $1 AND kind = $2',
    [body.avatarId, 'avatar']
  );
  if (!rows.length || rows[0].world_id !== req.auth!.worldId || rows[0].current_version === null) throw notFound();
  await query('UPDATE people SET avatar_id = $1 WHERE id = $2', [body.avatarId, personId]);
  json(res, 200, { avatarId: body.avatarId });
});

router.put('/me/hide-above', async (req, res) => {
  const { personId } = auth(req);
  const body = req.body as { rank?: unknown };
  const rank = body.rank;
  if (rank !== null && (typeof rank !== 'string' || !['Feather', 'Linen', 'Cedar', 'Granite'].includes(rank))) {
    throw invalid('Choose a rank or null.');
  }
  await query('UPDATE people SET hide_above = $1 WHERE id = $2', [rank, personId]);
  json(res, 200, { hideAbove: rank });
});

// ---------------------------------------------------------------------------
// Friends, invites, blocks, mutes
// ---------------------------------------------------------------------------

router.get('/friends', async (req, res) => {
  const { personId } = auth(req);
  const friendRows = await query<{ friend_id: string; display_name: string; avatar_id: string | null }>(
    `SELECT f.friend_id, p.display_name, p.avatar_id FROM friendships f
     JOIN people p ON p.id = f.friend_id WHERE f.person_id = $1`,
    [personId]
  );
  const out = [];
  for (const f of friendRows) {
    if (await isBlockedBetweenPerson(personId, f.friend_id)) continue;
    const presence = await presenceOf(f.friend_id);
    out.push({
      personId: f.friend_id,
      displayName: f.display_name,
      presence: presence.state,
      session: presence.sessionId ? await sessionSummaryOf(presence.sessionId, personId) : null,
    });
  }
  json(res, 200, { friends: out });
});

async function isBlockedBetweenPerson(a: string, b: string): Promise<boolean> {
  const rows = await query(
    'SELECT 1 FROM blocks WHERE (person_id = $1 AND blocked_id = $2) OR (person_id = $2 AND blocked_id = $1)',
    [a, b]
  );
  return rows.length > 0;
}

async function presenceOf(personId: string): Promise<{ state: 'online' | 'in-session' | 'offline'; sessionId: string | null }> {
  if (isDown('valkey')) return { state: 'offline', sessionId: null };
  try {
    const inSession = await query<{ session_id: string }>(
      'SELECT session_id FROM session_members WHERE person_id = $1 AND left_at IS NULL LIMIT 1',
      [personId]
    );
    if (inSession.length) return { state: 'in-session', sessionId: inSession[0].session_id };
    const online = await valkey.exists(`presence:${personId}`);
    return { state: online ? 'online' : 'offline', sessionId: null };
  } catch {
    return { state: 'offline', sessionId: null };
  }
}

async function sessionSummaryOf(sessionId: string, viewerId: string): Promise<{ id: string; roomName: string } | null> {
  const session = await getSession(sessionId);
  if (!session || session.status !== 'open') return null;
  if (!(await mayJoinSession(session, viewerId, (await getPerson(viewerId))!.world_id))) return null;
  const name = await roomNameOf(session.room_id);
  return { id: session.id, roomName: name };
}

async function roomNameOf(roomId: string): Promise<string> {
  const rows = await query<{ name: string }>('SELECT name FROM assets WHERE id = $1', [roomId]);
  return rows[0]?.name ?? 'Room';
}

router.delete('/friends/:personId', async (req, res) => {
  const { personId, worldId } = auth(req);
  const target = await getPerson(req.params.personId);
  if (!target || target.world_id !== worldId) throw notFound();
  await query('DELETE FROM friendships WHERE (person_id = $1 AND friend_id = $2) OR (person_id = $2 AND friend_id = $1)', [personId, target.id]);
  json(res, 200, { status: 'removed' });
});

router.post('/friends/invites', async (req, res) => {
  const { personId, worldId } = auth(req);
  const body = req.body as { email?: unknown };
  if (typeof body.email !== 'string' || !EMAIL_RE.test(body.email)) throw invalid('Enter a valid email address.');
  const id = opaqueId();
  const now = await worldClock(worldId);
  const expiresAt = new Date(now.getTime() + config.inviteTtlSeconds * 1000);
  await query(
    'INSERT INTO friend_invites (id, world_id, from_id, email, state, expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, worldId, personId, body.email, 'pending', expiresAt]
  );
  const t = token();
  await query('UPDATE friend_invites SET token = $1 WHERE id = $2', [t, id]);
  const from = await getPerson(personId);
  const link = `${publicUrl(req)}/invites/${t}`;
  await queueMail(worldId, body.email, `${from?.display_name ?? 'Someone'} invited you to Hearthtile`, `Accept your invite: ${link}`);
  void flushOutbox(worldId);
  json(res, 202, { status: 'sent' });
});

router.get('/friends/invites', async (req, res) => {
  const { personId, worldId } = auth(req);
  const rows = await query(
    'SELECT id, email, state, expires_at FROM friend_invites WHERE from_id = $1 AND world_id = $2 ORDER BY created_at DESC',
    [personId, worldId]
  );
  const now = await worldClock(worldId);
  const invites = [];
  for (const r of rows) {
    let state = r.state;
    if (state === 'pending' && new Date(r.expires_at).getTime() <= now.getTime()) {
      state = 'expired';
      await query("UPDATE friend_invites SET state = 'expired' WHERE id = $1", [r.id]);
    }
    invites.push({ id: r.id, email: r.email, state, expiresAt: r.expires_at });
  }
  json(res, 200, { invites });
});

router.delete('/friends/invites/:id', async (req, res) => {
  const { personId, worldId } = auth(req);
  const rows = await query('SELECT id FROM friend_invites WHERE id = $1 AND from_id = $2 AND world_id = $3', [req.params.id, personId, worldId]);
  if (!rows.length) throw notFound();
  await query("UPDATE friend_invites SET state = 'revoked' WHERE id = $1", [req.params.id]);
  json(res, 200, { status: 'revoked' });
});

router.get('/invites/:token', async (req, res) => {
  const rows = await query<{ from_id: string; state: string; expires_at: Date; world_id: string }>(
    'SELECT from_id, state, expires_at, world_id FROM friend_invites WHERE token = $1',
    [req.params.token]
  );
  if (!rows.length) throw notFound();
  const invite = rows[0];
  const now = await worldClock(invite.world_id);
  if (invite.state !== 'pending' || invite.expires_at.getTime() <= now.getTime()) throw notFound();
  const from = await getPerson(invite.from_id);
  json(res, 200, { from: from?.display_name ?? 'Someone' });
});

router.post('/invites/:token/accept', async (req, res) => {
  const authInfo = req.auth ? auth(req) : null;
  if (!authInfo) throw signInFirst();
  const rows = await query<{ id: string; from_id: string; state: string; expires_at: Date; world_id: string }>(
    'SELECT id, from_id, state, expires_at, world_id FROM friend_invites WHERE token = $1',
    [req.params.token]
  );
  if (!rows.length) throw notFound();
  const invite = rows[0];
  const now = await worldClock(invite.world_id);
  if (invite.state !== 'pending' || invite.expires_at.getTime() <= now.getTime()) throw notFound();
  if (invite.world_id !== authInfo.worldId || invite.from_id === authInfo.personId) throw notFound();
  if (await isBlockedBetweenPerson(authInfo.personId, invite.from_id)) throw notFound();
  await query("UPDATE friend_invites SET state = 'used' WHERE id = $1", [invite.id]);
  await query('INSERT INTO friendships (person_id, friend_id) VALUES ($1,$2), ($2,$1) ON CONFLICT DO NOTHING', [authInfo.personId, invite.from_id]);
  json(res, 200, { status: 'friends' });
});

router.post('/blocks/:personId', async (req, res) => {
  const { personId, worldId } = auth(req);
  const target = await getPerson(req.params.personId);
  if (!target || target.world_id !== worldId) throw notFound();
  if (target.id === personId) throw invalid('You cannot do that to yourself.');
  await query('INSERT INTO blocks (person_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [personId, target.id]);
  await notifySafetyChange(target.id);
  json(res, 200, { blocked: true });
});

router.delete('/blocks/:personId', async (req, res) => {
  const { personId, worldId } = auth(req);
  const target = await getPerson(req.params.personId);
  if (!target || target.world_id !== worldId) throw notFound();
  await query('DELETE FROM blocks WHERE person_id = $1 AND blocked_id = $2', [personId, target.id]);
  await notifySafetyChange(target.id);
  json(res, 200, { blocked: false });
});

router.post('/mutes/:personId', async (req, res) => {
  const { personId, worldId } = auth(req);
  const target = await getPerson(req.params.personId);
  if (!target || target.world_id !== worldId) throw notFound();
  if (target.id === personId) throw invalid('You cannot do that to yourself.');
  await query('INSERT INTO mutes (person_id, muted_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [personId, target.id]);
  json(res, 200, { muted: true });
});

router.delete('/mutes/:personId', async (req, res) => {
  const { personId, worldId } = auth(req);
  const target = await getPerson(req.params.personId);
  if (!target || target.world_id !== worldId) throw notFound();
  await query('DELETE FROM mutes WHERE person_id = $1 AND muted_id = $2', [personId, target.id]);
  json(res, 200, { muted: false });
});

async function notifySafetyChange(personId: string): Promise<void> {
  const sockets = meSocketsFor(personId);
  for (const s of sockets) s.send(JSON.stringify({ type: 'safety-changed' }));
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

interface SessionSummary {
  id: string;
  roomName: string;
  hostName: string;
  visibility: string;
  capacity: number;
  count: number;
  status: string;
}

router.get('/sessions', async (req, res) => {
  const { personId, worldId } = auth(req);
  const q = typeof req.query.q === 'string' ? req.query.q.toLowerCase() : '';
  const rows = await query(
    "SELECT s.id, s.world_id, s.room_id, s.host_id, s.visibility, s.capacity, s.community_id, s.status FROM sessions_table s WHERE s.world_id = $1 AND s.status = 'open'",
    [worldId]
  );
  const sessions: SessionSummary[] = [];
  for (const s of rows) {
    if (!(await mayJoinSession(s as never, personId, worldId))) continue;
    const roomName = await roomNameOf(s.room_id);
    const host = await getPerson(s.host_id);
    const hostName = host?.display_name ?? 'Someone';
    if (q && !roomName.toLowerCase().includes(q) && !hostName.toLowerCase().includes(q)) continue;
    sessions.push({
      id: s.id,
      roomName,
      hostName,
      visibility: s.visibility,
      capacity: s.capacity,
      count: await sessionCount(s.id),
      status: s.status,
    });
  }
  json(res, 200, { sessions, total: sessions.length });
});

router.post('/sessions', async (req, res) => {
  const { personId, worldId } = auth(req);
  const body = req.body as { roomId?: unknown; visibility?: unknown; capacity?: unknown; communityId?: unknown };
  if (typeof body.roomId !== 'string') throw notFound();
  const id = await openSession(
    personId,
    worldId,
    body.roomId,
    body.visibility as string,
    body.capacity as number,
    typeof body.communityId === 'string' ? body.communityId : null
  );
  await joinSession(id, personId);
  const detail = await sessionDetail(id, personId);
  json(res, 201, detail);
});

export async function sessionDetail(sessionId: string, viewerId: string): Promise<Record<string, unknown>> {
  const session = await getSession(sessionId);
  if (!session) throw notFound();
  const viewer = await getPerson(viewerId);
  if (!viewer) throw notFound();
  const inside = await isMember(sessionId, viewerId);
  const allowed = inside || (await mayJoinSession(session, viewerId, viewer.world_id));
  if (!allowed) throw notFound();
  const roomName = await roomNameOf(session.room_id);
  const host = await getPerson(session.host_id);
  const base: Record<string, unknown> = {
    id: session.id,
    roomId: session.room_id,
    roomName,
    roomVersion: inside ? await myRoomVersion(sessionId, viewerId) : await currentVersionOf(session.room_id),
    hostId: session.host_id,
    hostName: host?.display_name ?? 'Someone',
    visibility: session.visibility,
    capacity: session.capacity,
    count: await sessionCount(session.id),
    status: session.status,
    communityId: session.community_id,
  };
  if (inside) {
    const states = await allStates(sessionId);
    const members = await query<{ room_version: number; person_id: string }>(
      'SELECT room_version, person_id FROM session_members WHERE session_id = $1 AND person_id = $2 AND left_at IS NULL',
      [sessionId, viewerId]
    );
    const myVersion = members[0]?.room_version ?? 1;
    const layout = await versionLayoutFor(session.room_id, myVersion);
    base.layout = layout;
    base.features = featuresOf(layout, states);
    base.people = await projectPeople(sessionId, session.host_id, states, viewerId, viewer.hide_above);
  }
  return base;
}

async function myRoomVersion(sessionId: string, personId: string): Promise<number> {
  const rows = await query<{ room_version: number }>(
    'SELECT room_version FROM session_members WHERE session_id = $1 AND person_id = $2 AND left_at IS NULL',
    [sessionId, personId]
  );
  return rows[0]?.room_version ?? 1;
}

async function currentVersionOf(roomId: string): Promise<number | null> {
  const rows = await query<{ current_version: number | null }>('SELECT current_version FROM assets WHERE id = $1', [roomId]);
  return rows[0]?.current_version ?? null;
}

async function versionLayoutFor(roomId: string, version: number): Promise<unknown> {
  const rows = await query<{ layout: unknown }>('SELECT layout FROM versions WHERE asset_id = $1 AND version = $2', [roomId, version]);
  return rows[0]?.layout ?? null;
}

function featuresOf(layout: unknown, states: Map<string, { x: number; y: number; seated: boolean }>): unknown {
  if (!layout || typeof layout !== 'object') return [];
  const l = layout as { seats?: { id: string; x: number; y: number }[]; exits?: { id: string; x: number; y: number }[] };
  const seats = (l.seats ?? []).map((s) => {
    let occupiedBy = '';
    states.forEach((st, pid) => {
      if (st.seated && st.x === s.x && st.y === s.y) occupiedBy = pid;
    });
    return { id: s.id, kind: 'seat', x: s.x, y: s.y, occupiedBy };
  });
  const exits = (l.exits ?? []).map((e) => ({ id: e.id, kind: 'exit', x: e.x, y: e.y, occupiedBy: '' }));
  return [...seats, ...exits];
}

router.get('/sessions/:id', async (req, res) => {
  const { personId } = auth(req);
  const detail = await sessionDetail(req.params.id, personId);
  json(res, 200, detail);
});

router.post('/sessions/:id/join', async (req, res) => {
  const { personId, worldId } = auth(req);
  const session = await getSession(req.params.id);
  if (!session || session.status !== 'open') throw notFound();
  const person = await getPerson(personId);
  if (!person) throw notFound();
  const inside = await isMember(session.id, personId);
  if (!inside && !(await mayJoinSession(session, personId, worldId))) throw notFound();
  if (!inside) await joinSession(session.id, personId);
  const detail = await sessionDetail(session.id, personId);
  json(res, 200, detail);
});

router.post('/sessions/:id/leave', async (req, res) => {
  const { personId } = auth(req);
  const session = await getSession(req.params.id);
  if (!session) throw notFound();
  if (!(await isMember(session.id, personId))) throw notFound();
  await leaveSession(session.id, personId);
  json(res, 200, { status: 'left' });
});

router.post('/sessions/:id/invitees', async (req, res) => {
  const { personId } = auth(req);
  const session = await getSession(req.params.id);
  if (!session || session.host_id !== personId) throw notFound();
  const body = req.body as { personId?: unknown };
  if (typeof body.personId !== 'string') throw notFound();
  const target = await getPerson(body.personId);
  if (!target || target.world_id !== session.world_id) throw notFound();
  await query(
    'INSERT INTO invitations (session_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [session.id, target.id]
  );
  json(res, 201, { personId: target.id });
});

router.post('/sessions/:id/step', async (req, res) => {
  const { personId } = auth(req);
  const body = req.body as { direction?: unknown };
  const outcome = await step(req.params.id, personId, body.direction as string);
  json(res, 200, outcome);
});

router.post('/sessions/:id/sit', async (req, res) => {
  const { personId } = auth(req);
  const outcome = await sit(req.params.id, personId);
  json(res, 200, outcome);
});

router.post('/sessions/:id/stand', async (req, res) => {
  const { personId } = auth(req);
  const outcome = await stand(req.params.id, personId);
  json(res, 200, outcome);
});

router.post('/sessions/:id/chat', async (req, res) => {
  const { personId, worldId } = auth(req);
  const session = await getSession(req.params.id);
  if (!session || session.status !== 'open') throw notFound();
  if (!(await isMember(session.id, personId))) throw notFound();
  const body = req.body as { text?: unknown };
  if (typeof body.text !== 'string' || body.text.trim().length === 0) throw invalid('Write something to send.');
  const length = userPerceivedLength(body.text);
  if (length > config.chatMaxChars) {
    throw invalid(`Messages can be at most ${config.chatMaxChars} characters.`);
  }
  await requireValkey();
  const recipients = await chatRecipients(session.id, personId);
  const from = await getPerson(personId);
  const id = opaqueId();
  const sentAt = (await worldClock(worldId)).toISOString();
  await saveChatMessage({ id, sessionId: session.id, fromId: personId, text: body.text, sentAt, toIds: recipients });
  const fromName = from?.display_name ?? 'Someone';
  await publishEvent(session.id, { type: 'chat', id, fromId: personId, fromName, text: body.text, toIds: recipients });
  json(res, 201, { id, heardBy: recipients.length });
});

router.get('/sessions/:id/chat', async (req, res) => {
  const { personId } = auth(req);
  const session = await getSession(req.params.id);
  if (!session) throw notFound();
  if (!(await isMember(session.id, personId))) throw notFound();
  const messages = await chatLogFor(session.id, personId);
  const byId = new Map((await query<{ id: string; display_name: string }>('SELECT id, display_name FROM people WHERE id = ANY($1)', [messages.flatMap((m) => [m.fromId, personId])])).map((p) => [p.id, p.display_name]));
  const projected = [];
  for (const m of messages) {
    const fromName = m.fromId === personId
      ? (byId.get(m.fromId) ?? 'You')
      : await projectedNameFor(personId, m.fromId, byId.get(m.fromId) ?? 'Someone');
    projected.push({ id: m.id, fromId: m.fromId, fromName, text: m.text, sentAt: m.sentAt });
  }
  json(res, 200, { messages: projected });
});

async function projectedNameFor(viewerId: string, targetId: string, realName: string): Promise<string> {
  if (viewerId === targetId) return realName;
  const rows = await query(
    'SELECT 1 FROM blocks WHERE (person_id = $1 AND blocked_id = $2) OR (person_id = $2 AND blocked_id = $1)',
    [viewerId, targetId]
  );
  return rows.length ? 'Someone' : realName;
}

// ---------------------------------------------------------------------------
// Votes
// ---------------------------------------------------------------------------

router.post('/sessions/:id/votes', async (req, res) => {
  const { personId, worldId } = auth(req);
  const body = req.body as { personId?: unknown };
  if (typeof body.personId !== 'string') throw notFound();
  const vote = await startVote(req.params.id, personId, body.personId, worldId);
  json(res, 201, voteBody(vote));
});

router.get('/sessions/:id/votes', async (req, res) => {
  const { personId, worldId } = auth(req);
  const session = await getSession(req.params.id);
  if (!session || !(await isMember(session.id, personId))) throw notFound();
  const now = await worldClock(worldId);
  const rows = await query('SELECT * FROM votes WHERE session_id = $1 ORDER BY closes_at DESC', [session.id]);
  const votes = [];
  for (const v of rows) {
    let status = v.status;
    if (status === 'open' && now.getTime() >= new Date(v.closes_at).getTime()) {
      status = await closeDueVote(v as never) ?? 'failed';
    }
    votes.push(voteBody({ ...v, status } as never));
  }
  json(res, 200, { votes });
});

function voteBody(v: VoteRow): Record<string, unknown> {
  return {
    id: v.id,
    targetId: v.target_id,
    status: v.status,
    eligible: v.eligible?.length ?? 0,
    needed: v.needed,
    yes: v.yes,
    no: v.no,
    closesAt: v.closes_at,
  };
}

router.post('/sessions/:id/votes/:voteId/ballots', async (req, res) => {
  const { personId, worldId } = auth(req);
  const body = req.body as { choice?: unknown };
  const vote = await castBallot(req.params.id, req.params.voteId, personId, body.choice as string, worldId);
  json(res, 201, voteBody(vote));
});

// ---------------------------------------------------------------------------
// Reports and moderation
// ---------------------------------------------------------------------------

const CATEGORIES = ['harassment', 'hateful-content', 'impersonation', 'other'];

router.post('/reports', async (req, res) => {
  const { personId, worldId } = auth(req);
  const body = req.body as { personId?: unknown; sessionId?: unknown; category?: unknown; details?: unknown };
  if (!CATEGORIES.includes(body.category as string)) throw invalid('Choose a category.');
  if (typeof body.details !== 'string' || body.details.length < 1 || body.details.length > 1000) {
    throw invalid('Write 1 to 1000 characters.');
  }
  if (body.personId === personId) throw invalid('You cannot report yourself.');
  const target = await getPerson(body.personId as string);
  if (!target || target.world_id !== worldId) throw notFound();
  const session = await getSession(body.sessionId as string);
  if (!session || session.world_id !== worldId) throw notFound();
  const wasIn = await query(
    'SELECT 1 FROM session_members WHERE session_id = $1 AND person_id = $2',
    [session.id, personId]
  );
  if (!wasIn.length) throw notFound();
  const id = opaqueId();
  await query(
    "INSERT INTO reports (id, world_id, person_id, session_id, category, details, state) VALUES ($1,$2,$3,$4,$5,$6,'open')",
    [id, worldId, target.id, session.id, body.category, body.details]
  );
  json(res, 201, { id, state: 'open' });
});

router.get('/moderation/reports', async (req, res) => {
  const { personId, worldId } = auth(req);
  const me = await getPerson(personId);
  if (!me || me.site_role !== 'moderator') throw notFound();
  const rows = await query(
    `SELECT r.id, r.person_id, r.session_id, r.category, r.details, r.state, r.action, r.created_at,
            p.display_name AS person_name, a.name AS room_name
     FROM reports r
     JOIN people p ON p.id = r.person_id
     JOIN sessions_table s ON s.id = r.session_id
     JOIN assets a ON a.id = s.room_id
     WHERE r.world_id = $1 ORDER BY r.created_at`,
    [worldId]
  );
  json(res, 200, {
    reports: rows.map((r) => ({
      id: r.id,
      personId: r.person_id,
      personName: r.person_name,
      sessionId: r.session_id,
      roomName: r.room_name,
      category: r.category,
      details: r.details,
      state: r.state,
      action: r.action,
      createdAt: r.created_at,
    })),
  });
});

router.post('/moderation/reports/:id/move', async (req, res) => {
  const { personId, worldId } = auth(req);
  const me = await getPerson(personId);
  if (!me || me.site_role !== 'moderator') throw notFound();
  const rows = await query('SELECT * FROM reports WHERE id = $1 AND world_id = $2', [req.params.id, worldId]);
  if (!rows.length) throw notFound();
  const report = rows[0];
  const body = req.body as { state?: unknown; action?: unknown };
  const to = body.state;
  if (to !== 'reviewing' && to !== 'dismissed' && to !== 'upheld') throw invalid('Choose a valid state.');
  if (to === 'upheld' && body.action !== 'warn' && body.action !== 'suspend') throw invalid('Choose warn or suspend.');
  const legal =
    (report.state === 'open' && to === 'reviewing') ||
    (report.state === 'reviewing' && (to === 'upheld' || to === 'dismissed'));
  if (!legal) throw conflict('This report cannot move that way.');
  await query('UPDATE reports SET state = $1, action = $2 WHERE id = $3', [to, body.action ?? null, report.id]);
  if (to === 'upheld' && body.action === 'suspend') {
    await suspendPerson(report.person_id, worldId);
  }
  if (to === 'upheld' && body.action === 'warn') {
    await warnPerson(report.person_id);
  }
  const updated = (await query('SELECT * FROM reports WHERE id = $1', [report.id]))[0];
  json(res, 200, {
    id: updated.id,
    personId: updated.person_id,
    sessionId: updated.session_id,
    category: updated.category,
    details: updated.details,
    state: updated.state,
    action: updated.action,
    createdAt: updated.created_at,
  });
});

async function suspendPerson(personId: string, worldId: string): Promise<void> {
  await query('UPDATE people SET suspended = true WHERE id = $1', [personId]);
  const sessions = await query<{ session_id: string }>(
    'SELECT session_id FROM session_members WHERE person_id = $1 AND left_at IS NULL',
    [personId]
  );
  for (const s of sessions) {
    await leavePersonSafe(s.session_id, personId);
  }
  for (const sock of meSocketsFor(personId)) {
    sock.send(JSON.stringify({ type: 'suspended' }));
  }
  void worldId;
}

async function leavePersonSafe(sessionId: string, personId: string): Promise<void> {
  const { leavePerson } = await import('./live');
  await leavePerson(sessionId, personId);
  await publishEvent(sessionId, { type: 'moderator-removed', personId });
}

async function warnPerson(personId: string): Promise<void> {
  await query('UPDATE people SET warned = true WHERE id = $1', [personId]);
  for (const sock of meSocketsFor(personId)) {
    sock.send(JSON.stringify({ type: 'warned' }));
  }
}

// ---------------------------------------------------------------------------
// Assets: upload, versions, publish, restore, remove
// ---------------------------------------------------------------------------

import Busboy from 'busboy';
import { checkAndMeasure, GlbError, overGraniteMeasure, MEASURE_LABELS, type AssetKind } from '../shared/glb';
import { parseLayout } from '../shared/grid';

function multipart(req: Request): Promise<{ fields: Record<string, string>; file: Buffer | null }> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] ?? '';
    if (!contentType.includes('multipart/form-data')) {
      reject(invalid('Send a JSON body.'));
      return;
    }
    const busboy = Busboy({ headers: { 'content-type': contentType }, limits: { fileSize: config.multipartLimit } });
    const fields: Record<string, string> = {};
    let file: Buffer | null = null;
    busboy.on('field', (name, value) => { fields[name] = value; });
    busboy.on('file', (_name, stream) => {
      const chunks: Buffer[] = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => { file = Buffer.concat(chunks); });
    });
    busboy.on('error', () => reject(invalid('Choose a file to upload.')));
    busboy.on('finish', () => resolve({ fields, file }));
    if (req.rawBody) busboy.write(req.rawBody);
    busboy.end();
  });
}

async function requireMinio(): Promise<void> {
  if (isDown('minio')) throw new ApiError(503, 'File storage is unavailable. Nothing was saved.');
  try {
    await s3.request('GET', '', null);
  } catch {
    throw new ApiError(503, 'File storage is unavailable. Nothing was saved.');
  }
}

function assetKey(assetId: string, version: number): string {
  return `assets/${assetId}/v${version}.glb`;
}

async function nextVersion(assetId: string): Promise<number> {
  const rows = await query<{ max: number | null }>('SELECT MAX(version) as max FROM versions WHERE asset_id = $1', [assetId]);
  return (rows[0]?.max ?? 0) + 1;
}

async function createVersion(assetId: string, kind: AssetKind, data: Buffer, layout: unknown): Promise<Record<string, unknown>> {
  const checked = checkAndMeasure(kind, data);
  const over = overGraniteMeasure(kind, checked.measures);
  if (over) {
    const label = MEASURE_LABELS[over];
    const status = over === 'fileSize' ? 413 : 422;
    throw new ApiError(status, `This model is over the Granite limit for ${label}.`);
  }
  await requireMinio();
  const version = await nextVersion(assetId);
  await s3.put(assetKey(assetId, version), data);
  await query(
    "INSERT INTO versions (asset_id, version, status, rank, worst_measure, measures, layout) VALUES ($1,$2,'checked',$3,$4,$5,$6)",
    [assetId, version, checked.rank, checked.worstMeasure, JSON.stringify(checked.measures), kind === 'room' ? JSON.stringify(layout) : null]
  );
  return {
    assetId,
    version,
    rank: checked.rank,
    worstMeasure: checked.worstMeasure,
    measures: checked.measures,
  };
}

router.post('/assets', async (req, res) => {
  const { personId, worldId } = auth(req);
  const { fields, file } = await multipart(req);
  const kind = fields.kind as AssetKind | undefined;
  if (kind !== 'room' && kind !== 'avatar') throw invalid('Choose room or avatar.');
  if (typeof fields.name !== 'string' || fields.name.length < 1 || fields.name.length > 80) {
    throw invalid('Give the model a name of 1 to 80 characters.');
  }
  if (!file) throw invalid('Choose a file to upload.');
  let layout: unknown = null;
  if (kind === 'room') {
    try {
      layout = fields.layout ? JSON.parse(fields.layout) : null;
    } catch {
      throw invalid('This room layout is not valid.');
    }
    if (!parseLayout(layout)) throw invalid('This room layout is not valid.');
  }
  try {
    const checked = checkAndMeasure(kind, file);
    void checked;
  } catch (e) {
    if (e instanceof GlbError) throw invalid(e.message);
    throw e;
  }
  const id = opaqueId();
  await query('INSERT INTO assets (id, world_id, kind, name, owner_id, current_version) VALUES ($1,$2,$3,$4,$5,NULL)', [
    id, worldId, kind, fields.name, personId,
  ]);
  const body = await createVersion(id, kind, file, layout).catch(async (e) => {
    await query('DELETE FROM assets WHERE id = $1', [id]);
    throw e;
  });
  json(res, 201, body);
});

router.post('/assets/:id/versions', async (req, res) => {
  const { personId, worldId } = auth(req);
  const rows = await query<{ id: string; kind: string; owner_id: string; world_id: string }>(
    'SELECT id, kind, owner_id, world_id FROM assets WHERE id = $1',
    [req.params.id]
  );
  if (!rows.length || rows[0].world_id !== worldId || rows[0].owner_id !== personId) throw notFound();
  const { fields, file } = await multipart(req);
  if (!file) throw invalid('Choose a file to upload.');
  const kind = rows[0].kind as AssetKind;
  let layout: unknown = null;
  if (kind === 'room') {
    try {
      layout = fields.layout ? JSON.parse(fields.layout) : null;
    } catch {
      throw invalid('This room layout is not valid.');
    }
    if (!parseLayout(layout)) throw invalid('This room layout is not valid.');
  }
  try {
    checkAndMeasure(kind, file);
  } catch (e) {
    if (e instanceof GlbError) throw invalid(e.message);
    throw e;
  }
  const body = await createVersion(rows[0].id, kind, file, layout);
  json(res, 201, body);
});

router.get('/assets', async (req, res) => {
  const { personId, worldId } = auth(req);
  const kind = typeof req.query.kind === 'string' ? req.query.kind : null;
  const mine = req.query.mine === 'true';
  let rows: { id: string; kind: string; name: string; owner_id: string; current_version: number | null }[];
  if (mine) {
    rows = await query(
      `SELECT id, kind, name, owner_id, current_version FROM assets WHERE world_id = $1 AND owner_id = $2
       ${kind ? 'AND kind = $3' : ''}`,
      kind ? [worldId, personId, kind] : [worldId, personId]
    );
  } else {
    rows = await query(
      `SELECT id, kind, name, owner_id, current_version FROM assets WHERE world_id = $1 AND current_version IS NOT NULL
       ${kind ? 'AND kind = $2' : ''}`,
      kind ? [worldId, kind] : [worldId]
    );
  }
  const assets = [];
  for (const a of rows) {
    if (!mine && a.current_version === null) continue;
    const owner = await getPerson(a.owner_id);
    let rank: string | null = null;
    if (a.current_version !== null) {
      const v = await query<{ rank: string }>('SELECT rank FROM versions WHERE asset_id = $1 AND version = $2', [a.id, a.current_version]);
      rank = v[0]?.rank ?? null;
    }
    assets.push({
      id: a.id,
      kind: a.kind,
      name: a.name,
      ownerName: owner?.display_name ?? 'Someone',
      currentVersion: a.current_version,
      rank,
    });
  }
  json(res, 200, { assets, total: assets.length });
});

interface AssetRow { id: string; kind: string; name: string; owner_id: string; current_version: number | null }

async function assetVisible(id: string, worldId: string): Promise<AssetRow | null> {
  const rows = await query<AssetRow>(
    'SELECT id, kind, name, owner_id, current_version FROM assets WHERE id = $1 AND world_id = $2',
    [id, worldId]
  );
  return rows[0] ?? null;
}

router.get('/assets/:id', async (req, res) => {
  const { personId, worldId } = auth(req);
  const asset = await assetVisible(req.params.id, worldId);
  if (!asset) throw notFound();
  const owner = await getPerson(asset.owner_id);
  const isOwner = asset.owner_id === personId;
  const versionRows = await query(
    'SELECT version, status, rank, worst_measure, measures, layout, created_at FROM versions WHERE asset_id = $1 ORDER BY version DESC',
    [asset.id]
  );
  const versions = versionRows
    .filter((v) => isOwner || v.status === 'published')
    .map((v) => ({
      version: v.version,
      status: v.status,
      rank: v.rank,
      worstMeasure: v.worst_measure,
      measures: v.measures,
      ...(asset.kind === 'room' ? { layout: v.layout } : {}),
      createdAt: v.created_at,
    }));
  json(res, 200, {
    id: asset.id,
    kind: asset.kind,
    name: asset.name,
    ownerName: owner?.display_name ?? 'Someone',
    currentVersion: asset.current_version,
    rank: versions.find((v) => v.version === asset.current_version)?.rank ?? null,
    versions,
  });
});

router.get('/assets/:id/versions/:n/file', async (req, res) => {
  const { personId, worldId } = auth(req);
  const asset = await assetVisible(req.params.id, worldId);
  if (!asset) throw notFound();
  const n = Number(req.params.n);
  const rows = await query<{ status: string }>('SELECT status FROM versions WHERE asset_id = $1 AND version = $2', [asset.id, n]);
  if (!rows.length) throw notFound();
  const isOwner = asset.owner_id === personId;
  if (rows[0].status !== 'published' && !isOwner) throw notFound();
  if (isDown('minio')) throw new ApiError(503, 'File storage is unavailable.');
  let data: Buffer;
  try {
    data = await s3.get(assetKey(asset.id, n));
  } catch {
    throw new ApiError(503, 'File storage is unavailable.');
  }
  res.setHeader('Content-Type', 'model/gltf-binary');
  res.status(200).end(data);
});

router.post('/assets/:id/versions/:n/publish', async (req, res) => {
  const { personId, worldId } = auth(req);
  const asset = await assetVisible(req.params.id, worldId);
  if (!asset || asset.owner_id !== personId) throw notFound();
  const n = Number(req.params.n);
  const rows = await query<{ status: string }>('SELECT status FROM versions WHERE asset_id = $1 AND version = $2', [asset.id, n]);
  if (!rows.length) throw notFound();
  if (rows[0].status === 'published') throw conflict('This version is already published.');
  if (rows[0].status === 'removed') throw notFound();
  await query('UPDATE versions SET status = $1 WHERE asset_id = $2 AND version = $3', ['published', asset.id, n]);
  await query('UPDATE assets SET current_version = $1 WHERE id = $2', [n, asset.id]);
  json(res, 200, { assetId: asset.id, version: n, status: 'published' });
});

router.post('/assets/:id/versions/:n/restore', async (req, res) => {
  const { personId, worldId } = auth(req);
  const asset = await assetVisible(req.params.id, worldId);
  if (!asset || asset.owner_id !== personId) throw notFound();
  const n = Number(req.params.n);
  const rows = await query<{ status: string; rank: string; worst_measure: string; measures: unknown; layout: unknown }>(
    'SELECT status, rank, worst_measure, measures, layout FROM versions WHERE asset_id = $1 AND version = $2',
    [asset.id, n]
  );
  if (!rows.length || rows[0].status === 'removed') throw notFound();
  if (isDown('minio')) throw new ApiError(503, 'File storage is unavailable. Nothing was saved.');
  let data: Buffer;
  try {
    data = await s3.get(assetKey(asset.id, n));
  } catch {
    throw new ApiError(503, 'File storage is unavailable. Nothing was saved.');
  }
  const version = await nextVersion(asset.id);
  try {
    await s3.put(assetKey(asset.id, version), data);
  } catch {
    throw new ApiError(503, 'File storage is unavailable. Nothing was saved.');
  }
  await query(
    "INSERT INTO versions (asset_id, version, status, rank, worst_measure, measures, layout) VALUES ($1,$2,'published',$3,$4,$5,$6)",
    [asset.id, version, rows[0].rank, rows[0].worst_measure, JSON.stringify(rows[0].measures), asset.kind === 'room' ? JSON.stringify(rows[0].layout) : null]
  );
  await query('UPDATE assets SET current_version = $1 WHERE id = $2', [version, asset.id]);
  json(res, 201, { assetId: asset.id, version, rank: rows[0].rank, worstMeasure: rows[0].worst_measure, measures: rows[0].measures });
});

router.delete('/assets/:id/versions/:n', async (req, res) => {
  const { personId, worldId } = auth(req);
  const asset = await assetVisible(req.params.id, worldId);
  if (!asset || asset.owner_id !== personId) throw notFound();
  const n = Number(req.params.n);
  const rows = await query<{ status: string }>('SELECT status FROM versions WHERE asset_id = $1 AND version = $2', [asset.id, n]);
  if (!rows.length || rows[0].status === 'removed') throw notFound();
  const inUse = await query<{ session_id: string }>(
    `SELECT sm.session_id FROM session_members sm JOIN sessions_table s ON s.id = sm.session_id
     WHERE s.room_id = $1 AND sm.room_version = $2 AND sm.left_at IS NULL AND s.status = 'open'`,
    [asset.id, n]
  );
  if (inUse.length) throw conflict('This version is in use by an open session.');
  if (isDown('minio')) throw new ApiError(503, 'File storage is unavailable. Nothing was saved.');
  try {
    await s3.delete(assetKey(asset.id, n));
  } catch {
    throw new ApiError(503, 'File storage is unavailable. Nothing was saved.');
  }
  await query("DELETE FROM versions WHERE asset_id = $1 AND version = $2", [asset.id, n]);
  if (asset.current_version === n) {
    const highest = await query<{ max: number | null }>(
      "SELECT MAX(version) as max FROM versions WHERE asset_id = $1 AND status = 'published'",
      [asset.id]
    );
    await query('UPDATE assets SET current_version = $1 WHERE id = $2', [highest[0]?.max ?? null, asset.id]);
  }
  const remaining = await query('SELECT 1 FROM versions WHERE asset_id = $1', [asset.id]);
  if (!remaining.length) {
    await query('DELETE FROM assets WHERE id = $1', [asset.id]);
  }
  json(res, 200, { status: 'removed' });
});

router.delete('/assets/:id', async (req, res) => {
  const { personId, worldId } = auth(req);
  const asset = await assetVisible(req.params.id, worldId);
  if (!asset || asset.owner_id !== personId) throw notFound();
  if (isDown('minio')) throw new ApiError(503, 'File storage is unavailable. Nothing was saved.');
  const versions = await query<{ version: number }>('SELECT version FROM versions WHERE asset_id = $1', [asset.id]);
  try {
    for (const v of versions) await s3.delete(assetKey(asset.id, v.version));
  } catch {
    throw new ApiError(503, 'File storage is unavailable. Nothing was saved.');
  }
  await query('DELETE FROM versions WHERE asset_id = $1', [asset.id]);
  await query('DELETE FROM assets WHERE id = $1', [asset.id]);
  json(res, 200, { status: 'removed' });
});

// ---------------------------------------------------------------------------
// Communities and gatherings
// ---------------------------------------------------------------------------

router.get('/communities', async (req, res) => {
  const { personId } = auth(req);
  const rows = await query(
    `SELECT c.id, c.name, c.time_zone, m.role FROM communities c
     JOIN community_members m ON m.community_id = c.id AND m.person_id = $1
     WHERE c.world_id = $2`,
    [personId, req.auth!.worldId]
  );
  json(res, 200, { communities: rows.map((r) => ({ id: r.id, name: r.name, timeZone: r.time_zone, role: r.role })) });
});

router.post('/communities', async (req, res) => {
  const { personId, worldId } = auth(req);
  const body = req.body as { name?: unknown; timeZone?: unknown };
  if (typeof body.name !== 'string' || body.name.length < 1 || body.name.length > 80) {
    throw invalid('Give the community a name of 1 to 80 characters.');
  }
  if (typeof body.timeZone !== 'string' || !ZONE_NAMES.includes(body.timeZone)) {
    throw invalid('Choose a time zone from the list.');
  }
  const id = opaqueId();
  await query('INSERT INTO communities (id, world_id, name, time_zone) VALUES ($1,$2,$3,$4)', [id, worldId, body.name, body.timeZone]);
  await query("INSERT INTO community_members (community_id, person_id, role) VALUES ($1,$2,'owner')", [id, personId]);
  json(res, 201, { id, name: body.name, timeZone: body.timeZone, role: 'owner' });
});

async function communityOf(id: string, worldId: string): Promise<{ id: string; name: string; time_zone: string; world_id: string } | null> {
  const rows = await query<{ id: string; name: string; time_zone: string; world_id: string }>(
    'SELECT id, name, time_zone, world_id FROM communities WHERE id = $1 AND world_id = $2', [id, worldId]
  );
  return rows[0] ?? null;
}

async function requireRole(personId: string, communityId: string, roles: string[]): Promise<void> {
  const rows = await query<{ role: string }>('SELECT role FROM community_members WHERE person_id = $1 AND community_id = $2', [personId, communityId]);
  if (!rows.length || !roles.includes(rows[0].role)) throw notFound();
}

router.get('/communities/:id/members', async (req, res) => {
  const { personId, worldId } = auth(req);
  const community = await communityOf(req.params.id, worldId);
  if (!community) throw notFound();
  const meRole = (await query<{ role: string }>('SELECT role FROM community_members WHERE person_id = $1 AND community_id = $2', [personId, community.id]))[0]?.role;
  if (!meRole) throw notFound();
  const rows = await query(
    'SELECT m.person_id, m.role, m.joined_at, p.display_name, p.email FROM community_members m JOIN people p ON p.id = m.person_id WHERE m.community_id = $1 ORDER BY m.joined_at',
    [community.id]
  );
  const keysByRole: Record<string, string[]> = {
    member: ['personId', 'displayName', 'role'],
    steward: ['personId', 'displayName', 'role', 'joinedAt'],
    owner: ['personId', 'displayName', 'role', 'joinedAt', 'email'],
  };
  const keys = keysByRole[meRole];
  const members = rows.map((r) => {
    const all: Record<string, unknown> = {
      personId: r.person_id,
      displayName: r.display_name,
      role: r.role,
      joinedAt: r.joined_at,
      email: r.email,
    };
    const filtered: Record<string, unknown> = {};
    for (const k of keys) filtered[k] = all[k];
    return filtered;
  });
  json(res, 200, { members, total: members.length });
});

router.post('/communities/:id/members', async (req, res) => {
  const { personId, worldId } = auth(req);
  const community = await communityOf(req.params.id, worldId);
  if (!community) throw notFound();
  await requireRole(personId, community.id, ['owner', 'steward']);
  const body = req.body as { personId?: unknown };
  const target = await getPerson(body.personId as string);
  if (!target || target.world_id !== worldId) throw notFound();
  await query("INSERT INTO community_members (community_id, person_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING", [community.id, target.id]);
  json(res, 201, { personId: target.id, role: 'member' });
});

router.put('/communities/:id/members/:personId', async (req, res) => {
  const { personId, worldId } = auth(req);
  const community = await communityOf(req.params.id, worldId);
  if (!community) throw notFound();
  await requireRole(personId, community.id, ['owner']);
  const body = req.body as { role?: unknown };
  if (body.role !== 'owner' && body.role !== 'steward' && body.role !== 'member') {
    throw invalid('Choose owner, steward or member.');
  }
  const target = await getPerson(req.params.personId);
  if (!target || target.world_id !== worldId) throw notFound();
  const rows = await query<{ role: string }>('SELECT role FROM community_members WHERE community_id = $1 AND person_id = $2', [community.id, target.id]);
  if (!rows.length) throw notFound();
  if (rows[0].role === 'owner' && body.role !== 'owner') {
    const owners = await query("SELECT 1 FROM community_members WHERE community_id = $1 AND role = 'owner'", [community.id]);
    if (owners.length <= 1) throw conflict('A community needs an owner.');
  }
  await query('UPDATE community_members SET role = $1 WHERE community_id = $2 AND person_id = $3', [body.role, community.id, target.id]);
  for (const sock of meSocketsFor(target.id)) {
    sock.send(JSON.stringify({ type: 'role-changed', communityId: community.id, role: body.role }));
  }
  json(res, 200, { personId: target.id, role: body.role });
});

router.delete('/communities/:id/members/:personId', async (req, res) => {
  const { personId, worldId } = auth(req);
  const community = await communityOf(req.params.id, worldId);
  if (!community) throw notFound();
  const meRole = (await query<{ role: string }>('SELECT role FROM community_members WHERE person_id = $1 AND community_id = $2', [personId, community.id]))[0]?.role;
  if (!meRole || (meRole !== 'owner' && meRole !== 'steward')) throw notFound();
  const target = await getPerson(req.params.personId);
  if (!target || target.world_id !== worldId) throw notFound();
  const targetRole = (await query<{ role: string }>('SELECT role FROM community_members WHERE community_id = $1 AND person_id = $2', [community.id, target.id]))[0]?.role;
  if (!targetRole) throw notFound();
  if (target.id === personId) throw notFound();
  if (meRole === 'steward' && targetRole !== 'member') throw notFound();
  if (meRole === 'owner' && targetRole === 'owner') {
    const owners = await query("SELECT 1 FROM community_members WHERE community_id = $1 AND role = 'owner'", [community.id]);
    if (owners.length <= 1) throw conflict('A community needs an owner.');
  }
  await query('DELETE FROM community_members WHERE community_id = $1 AND person_id = $2', [community.id, target.id]);
  // A person removed from a community leaves its community sessions at once.
  const sessions = await query<{ id: string }>(
    "SELECT id FROM sessions_table WHERE community_id = $1 AND status = 'open'",
    [community.id]
  );
  for (const s of sessions) {
    const member = await query('SELECT 1 FROM session_members WHERE session_id = $1 AND person_id = $2 AND left_at IS NULL', [s.id, target.id]);
    if (member.length) {
      const { leavePerson } = await import('./live');
      await leavePerson(s.id, target.id);
      await publishEvent(s.id, { type: 'moderator-removed', personId: target.id });
    }
  }
  for (const sock of meSocketsFor(target.id)) {
    sock.send(JSON.stringify({ type: 'removed-from-community', communityId: community.id }));
  }
  json(res, 200, { status: 'removed' });
});

async function gatheringVisible(id: string, worldId: string): Promise<{ g: GatheringRow; community: { id: string; time_zone: string } } | null> {
  const rows = await query(
    `SELECT g.id, g.community_id, g.title, g.starts_local, g.duration_minutes, g.recurrence, g.limit_count, c.time_zone, c.world_id
     FROM gatherings g JOIN communities c ON c.id = g.community_id WHERE g.id = $1`,
    [id]
  );
  if (!rows.length || rows[0].world_id !== worldId) return null;
  const r = rows[0];
  return {
    g: {
      id: r.id,
      community_id: r.community_id,
      title: r.title,
      starts_local: r.starts_local,
      duration_minutes: r.duration_minutes,
      recurrence: r.recurrence,
      limit_count: r.limit_count,
    },
    community: { id: r.community_id, time_zone: r.time_zone },
  };
}

import { ZONE_NAMES } from './zones';
import { occurrencesOf, type GatheringRow } from './occurrences';

router.get('/communities/:id/gatherings', async (req, res) => {
  const { personId, worldId } = auth(req);
  const community = await communityOf(req.params.id, worldId);
  if (!community) throw notFound();
  await requireRole(personId, community.id, ['owner', 'steward', 'member']);
  const rows = await query<GatheringRow>('SELECT id, community_id, title, starts_local, duration_minutes, recurrence, limit_count FROM gatherings WHERE community_id = $1', [community.id]);
  const now = await worldClock(worldId);
  const me = await getPerson(personId);
  const gatherings = [];
  for (const g of rows) {
    const occs = await occurrencesOf(g, community.time_zone, me?.time_zone ?? 'Europe/London', now);
    gatherings.push(await gatheringBody(g, community, personId, now, me?.time_zone ?? 'Europe/London'));
    void occs;
  }
  json(res, 200, { gatherings, total: gatherings.length });
});

router.post('/communities/:id/gatherings', async (req, res) => {
  const { personId, worldId } = auth(req);
  const community = await communityOf(req.params.id, worldId);
  if (!community) throw notFound();
  await requireRole(personId, community.id, ['owner', 'steward']);
  const body = req.body as { title?: unknown; startsLocal?: unknown; durationMinutes?: unknown; recurrence?: unknown; limit?: unknown };
  if (typeof body.title !== 'string' || body.title.length < 1 || body.title.length > 120) {
    throw invalid('Give the gathering a title of 1 to 120 characters.');
  }
  if (typeof body.startsLocal !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(body.startsLocal)) {
    throw invalid('Enter the start as a local date and time.');
  }
  if (typeof body.durationMinutes !== 'number' || body.durationMinutes < 15 || body.durationMinutes > 480) {
    throw invalid('Duration must be 15 to 480 minutes.');
  }
  if (body.recurrence !== 'none' && body.recurrence !== 'weekly') throw invalid('Choose none or weekly.');
  if (typeof body.limit !== 'number' || body.limit < 1 || body.limit > 500) throw invalid('Limit must be 1 to 500.');
  const id = opaqueId();
  await query(
    'INSERT INTO gatherings (id, community_id, title, starts_local, duration_minutes, recurrence, limit_count) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, community.id, body.title, body.startsLocal, body.durationMinutes, body.recurrence, body.limit]
  );
  const g: GatheringRow = { id, community_id: community.id, title: body.title, starts_local: body.startsLocal, duration_minutes: body.durationMinutes, recurrence: body.recurrence, limit_count: body.limit };
  const now = await worldClock(worldId);
  const me = await getPerson(personId);
  json(res, 201, await gatheringBody(g, community, personId, now, me?.time_zone ?? 'Europe/London'));
});

async function gatheringBody(g: GatheringRow, community: { id: string; time_zone: string }, viewerId: string, now: Date, viewerZone: string): Promise<Record<string, unknown>> {
  const occs = await occurrencesOf(g, community.time_zone, viewerZone, now);
  const attending = await query<{ person_id: string }>('SELECT person_id FROM gathering_attendees WHERE gathering_id = $1', [g.id]);
  const count = attending.length;
  const amI = attending.some((a) => a.person_id === viewerId);
  return {
    id: g.id,
    communityId: g.community_id,
    title: g.title,
    durationMinutes: g.duration_minutes,
    recurrence: g.recurrence,
    limit: g.limit_count,
    attendingCount: count,
    attending: amI,
    status: occs[0]?.status ?? 'ended',
    display: occs[0]?.display ?? '',
    occurrences: occs,
  };
}

router.get('/gatherings/:id', async (req, res) => {
  const { personId, worldId } = auth(req);
  const found = await gatheringVisible(req.params.id, worldId);
  if (!found) throw notFound();
  await requireRole(personId, found.community.id, ['owner', 'steward', 'member']);
  const now = await worldClock(worldId);
  const me = await getPerson(personId);
  json(res, 200, await gatheringBody(found.g, { id: found.community.id, time_zone: found.community.time_zone }, personId, now, me?.time_zone ?? 'Europe/London'));
});

router.post('/communities/:id/gatherings/:gatheringId/attend', async (req, res) => {
  const { personId, worldId } = auth(req);
  const community = await communityOf(req.params.id, worldId);
  if (!community) throw notFound();
  await requireRole(personId, community.id, ['owner', 'steward', 'member']);
  const found = await gatheringVisible(req.params.gatheringId, worldId);
  if (!found || found.g.community_id !== community.id) throw notFound();
  const now = await worldClock(worldId);
  if (found.g.recurrence === 'none') {
    const first = await occurrencesOf(found.g, community.time_zone, community.time_zone, now);
    if (first[0]?.status === 'ended') throw conflict('This gathering has ended.');
  }
  const lockKey = `gathering:${found.g.id}:attend-lock`;
  const { valkeyLock, valkeyUnlock } = await import('./sessions');
  const lock = await valkeyLock(lockKey).catch(() => null);
  try {
    const attending = await query<{ person_id: string }>('SELECT person_id FROM gathering_attendees WHERE gathering_id = $1', [found.g.id]);
    if (attending.some((a) => a.person_id === personId)) {
      json(res, 200, { attending: true, count: attending.length });
      return;
    }
    if (attending.length >= found.g.limit_count) throw conflict('This gathering is full.');
    await query('INSERT INTO gathering_attendees (gathering_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [found.g.id, personId]);
    json(res, 200, { attending: true, count: attending.length + 1 });
  } finally {
    if (lock) await valkeyUnlock(lockKey, lock);
  }
});

router.delete('/communities/:id/gatherings/:gatheringId/attend', async (req, res) => {
  const { personId, worldId } = auth(req);
  const community = await communityOf(req.params.id, worldId);
  if (!community) throw notFound();
  await requireRole(personId, community.id, ['owner', 'steward', 'member']);
  const found = await gatheringVisible(req.params.gatheringId, worldId);
  if (!found || found.g.community_id !== community.id) throw notFound();
  await query('DELETE FROM gathering_attendees WHERE gathering_id = $1 AND person_id = $2', [found.g.id, personId]);
  const attending = await query<{ person_id: string }>('SELECT person_id FROM gathering_attendees WHERE gathering_id = $1', [found.g.id]);
  json(res, 200, { attending: false, count: attending.length });
});

export { router as routes, sessionCount };
export { gradingRoutes } from './grading';
