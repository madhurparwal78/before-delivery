// Session lifecycle and every live command: open, join, leave, step, sit,
// stand, chat, votes.
import { config, opaqueId } from './config';
import { query } from './db';
import { ApiError, conflict, invalid, notFound } from './errors';
import {
  activeMembers,
  allStates,
  clearPendingDrop,
  currentRoomVersion,
  decodeState,
  encodeState,
  getPerson,
  getSession,
  isBlockedBetween,
  isMember,
  leavePerson,
  publishEvent,
  removeState,
  requireValkey,
  setState,
  versionLayout,
  type PersonState,
  type SessionRow,
} from './live';
import { worldClock } from './world';
import {
  PERSON_TEXT,
  SEAT_TEXT,
  SEATED_TEXT,
  WALL_TEXT,
  layoutAt,
  seatAhead,
  stepFrom,
  type Facing,
  type Layout,
  type Tile,
} from '../shared/grid';
import { tooMany } from './errors';
import { valkey } from './providers';

export type Visibility = 'public' | 'friends' | 'community' | 'invite';

export interface SessionDetail {
  id: string;
  roomId: string;
  roomName: string;
  roomVersion: number | null;
  hostId: string;
  hostName: string;
  visibility: Visibility;
  capacity: number;
  count: number;
  status: string;
  communityId: string | null;
}

export async function roomNameOf(roomId: string): Promise<string> {
  const rows = await query<{ name: string }>('SELECT name FROM assets WHERE id = $1', [roomId]);
  return rows[0]?.name ?? 'Room';
}

// The single place session visibility is decided.
export async function mayJoinSession(session: SessionRow, personId: string, worldId: string): Promise<boolean> {
  if (session.world_id !== worldId) return false;
  if (session.status !== 'open') return false;
  const removedRows = await query<{ person_id: string }>(
    'SELECT person_id FROM session_members WHERE session_id = $1 AND removed = true AND person_id = $2',
    [session.id, personId]
  );
  if (removedRows.length > 0) return false;
  if (session.host_id === personId) return true;
  if (await isBlockedBetween(personId, session.host_id)) return false;
  if (session.visibility === 'public') return true;
  if (session.visibility === 'friends') {
    return isFriendOf(personId, session.host_id);
  }
  if (session.visibility === 'community') {
    if (!session.community_id) return false;
    const role = await query<{ role: string }>(
      'SELECT role FROM community_members WHERE community_id = $1 AND person_id = $2',
      [session.community_id, personId]
    );
    return role.length > 0;
  }
  if (session.visibility === 'invite') {
    const rows = await query('SELECT 1 FROM invitations WHERE session_id = $1 AND person_id = $2', [session.id, personId]);
    return rows.length > 0;
  }
  return false;
}

async function isFriendOf(a: string, b: string): Promise<boolean> {
  const rows = await query('SELECT 1 FROM friendships WHERE person_id = $1 AND friend_id = $2', [a, b]);
  return rows.length > 0;
}

export async function sessionCount(sessionId: string): Promise<number> {
  const states = await allStates(sessionId).catch(() => new Map<string, PersonState>());
  return states.size;
}

export async function openSession(personId: string, worldId: string, roomId: string, visibility: string, capacity: number, communityId: string | null): Promise<string> {
  if (typeof visibility !== 'string' || !['public', 'friends', 'community', 'invite'].includes(visibility)) {
    throw invalid('Choose public, friends, community or invite.');
  }
  if (typeof capacity !== 'number' || !Number.isInteger(capacity) || capacity < 1 || capacity > config.sessionCapacityMax) {
    throw invalid(`Capacity must be between 1 and ${config.sessionCapacityMax}.`);
  }
  if (visibility === 'community') {
    if (typeof communityId !== 'string' || !communityId) throw invalid('Choose a community for this session.');
  } else {
    communityId = null;
  }
  const room = await query<{ world_id: string; current_version: number | null }>(
    'SELECT world_id, current_version FROM assets WHERE id = $1',
    [roomId]
  );
  if (!room.length || room[0].world_id !== worldId || room[0].current_version === null) throw notFound();
  if (communityId) {
    const role = await query<{ role: string }>(
      'SELECT role FROM community_members WHERE community_id = $1 AND person_id = $2',
      [communityId, personId]
    );
    if (!role.length || (role[0].role !== 'owner' && role[0].role !== 'steward')) throw notFound();
  }
  await requireValkey();
  const id = opaqueId();
  await query(
    'INSERT INTO sessions_table (id, world_id, room_id, host_id, visibility, capacity, community_id, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, worldId, roomId, personId, visibility, capacity, communityId, 'open']
  );
  return id;
}

// Joining is atomic across instances: exactly one of any number of concurrent
// joiners takes the last place.
export async function joinSession(sessionId: string, personId: string): Promise<void> {
  const session = await getSession(sessionId);
  if (!session) throw notFound();
  const person = await getPerson(personId);
  if (!person) throw notFound();
  await requireValkey();
  const lockKey = `session:${sessionId}:join-lock`;
  const lock = await valkeyLock(lockKey);
  try {
    const states = await allStates(sessionId);
    if (states.has(personId)) return; // a replay that changes nothing
    if (states.size >= session.capacity) throw conflict('This session is full.');
    const layout = await versionLayout(session.room_id, (await currentRoomVersion(session.room_id)) ?? 1);
    if (!layout) throw notFound();
    const spot = await placeOnLayout(sessionId, layout);
    const state: PersonState = {
      x: spot.x,
      y: spot.y,
      facing: 'south',
      seated: false,
      name: person.display_name,
      avatarId: person.avatar_id ?? undefined,
      joinedAt: Date.now(),
      worldId: session.world_id,
    };
    await setState(sessionId, personId, state);
    const version = await currentRoomVersion(session.room_id);
    await query(
      `INSERT INTO session_members (session_id, person_id, room_version, joined_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (session_id, person_id) DO UPDATE SET left_at = NULL, removed = false, room_version = $3`,
      [sessionId, personId, version]
    );
    clearPendingDrop(sessionId, personId);
    await publishEvent(sessionId, { type: 'arrived', personId, name: person.display_name, x: state.x, y: state.y, facing: state.facing });
  } finally {
    await valkeyUnlock(lockKey, lock);
  }
}

async function placeOnLayout(sessionId: string, layout: Layout): Promise<Tile> {
  const states = await allStates(sessionId);
  const occupied = new Set<string>();
  states.forEach((st) => occupied.add(`${st.x},${st.y}`));
  for (const s of layout.spawn) {
    if (!occupied.has(`${s.x},${s.y}`)) return { x: s.x, y: s.y };
  }
  for (let y = 0; y < layout.height; y++) {
    for (let x = 0; x < layout.width; x++) {
      if (occupied.has(`${x},${y}`)) continue;
      if (layoutAt(layout, x, y) !== 'floor') continue;
      return { x, y };
    }
  }
  throw conflict('This session is full.');
}

export async function leaveSession(sessionId: string, personId: string): Promise<void> {
  await requireValkey();
  await leavePerson(sessionId, personId);
}

export interface StepOutcome {
  result: 'turned' | 'moved' | 'left';
  x: number;
  y: number;
  facing: Facing;
}

// The single place a step is decided, including the pacing rule.
export async function step(sessionId: string, personId: string, direction: string): Promise<StepOutcome> {
  if (typeof direction !== 'string' || !['north', 'east', 'south', 'west'].includes(direction)) {
    throw invalid('Choose north, east, south or west.');
  }
  await requireValkey();
  const session = await getSession(sessionId);
  if (!session || session.status !== 'open') throw notFound();
  const states = await allStates(sessionId);
  const me = states.get(personId);
  if (!me) throw notFound();
  const layout = await layoutOf(session, personId);
  if (me.seated) throw conflict(SEATED_TEXT);
  const dir = direction as Facing;
  if (me.facing !== dir) {
    await checkPacing(session, personId, session.world_id);
    const next: PersonState = { ...me, facing: dir };
    await setState(sessionId, personId, next);
    await publishEvent(sessionId, { type: 'moved', personId, x: me.x, y: me.y, facing: dir, seated: false });
    return { result: 'turned', x: me.x, y: me.y, facing: dir };
  }
  const to = stepFrom({ x: me.x, y: me.y }, dir);
  if (to.x < 0 || to.y < 0 || to.x >= layout.width || to.y >= layout.height) throw conflict(WALL_TEXT);
  const kind = layoutAt(layout, to.x, to.y);
  if (kind === 'wall') throw conflict(WALL_TEXT);
  if (kind === 'seat') throw conflict(SEAT_TEXT);
  await checkPacing(session, personId, session.world_id);
  // One tile one winner: the claim is decided by server order.
  const lock = await valkeyLock(`session:${sessionId}:tile-lock`);
  try {
    const fresh = (await allStates(sessionId)).get(personId);
    if (!fresh) throw notFound();
    for (const [pid, st] of await allStates(sessionId)) {
      if (pid !== personId && st.x === to.x && st.y === to.y) throw conflict(PERSON_TEXT);
    }
    if (kind === 'exit') {
      await removeState(sessionId, personId);
      await query('UPDATE session_members SET left_at = now() WHERE session_id = $1 AND person_id = $2 AND left_at IS NULL', [sessionId, personId]);
      await publishEvent(sessionId, { type: 'left', personId, name: fresh.name });
      await endOrHandOver(sessionId, session, personId, states);
      return { result: 'left', x: me.x, y: me.y, facing: dir };
    }
    const next: PersonState = { ...fresh, x: to.x, y: to.y, seated: false };
    await setState(sessionId, personId, next);
    await publishEvent(sessionId, { type: 'moved', personId, x: to.x, y: to.y, facing: dir, seated: false });
    return { result: 'moved', x: to.x, y: to.y, facing: dir };
  } finally {
    await valkeyUnlock(`session:${sessionId}:tile-lock`, lock);
  }
}

async function endOrHandOver(sessionId: string, session: SessionRow, personId: string, states: Map<string, PersonState>): Promise<void> {
  const remaining = await allStates(sessionId).catch(() => new Map<string, PersonState>());
  if (remaining.size === 0) {
    await query("UPDATE sessions_table SET status = 'ended' WHERE id = $1", [sessionId]);
    await publishEvent(sessionId, { type: 'ended' });
  } else if (session.host_id === personId) {
    await handOverHost(sessionId, states);
  }
}

export async function handOverHost(sessionId: string, states: Map<string, PersonState>): Promise<void> {
  const members = await activeMembers(sessionId);
  let nextHost: string | null = null;
  let bestJoined = Infinity;
  for (const m of members) {
    const st = states.get(m.person_id);
    const joined = st ? st.joinedAt : m.joined_at.getTime();
    if (joined < bestJoined || (joined === bestJoined && nextHost !== null && m.person_id < nextHost)) {
      bestJoined = joined;
      nextHost = m.person_id;
    }
  }
  if (nextHost) {
    await query('UPDATE sessions_table SET host_id = $1 WHERE id = $2', [nextHost, sessionId]);
    const name = states.get(nextHost)?.name ?? (await getPerson(nextHost))?.display_name ?? 'Someone';
    await publishEvent(sessionId, { type: 'host-changed', personId: nextHost, name });
  }
}

async function layoutOf(session: SessionRow, personId: string): Promise<Layout> {
  const member = await query<{ room_version: number }>(
    'SELECT room_version FROM session_members WHERE session_id = $1 AND person_id = $2 AND left_at IS NULL',
    [session.id, personId]
  );
  const version = member[0]?.room_version ?? (await currentRoomVersion(session.room_id)) ?? 1;
  const layout = await versionLayout(session.room_id, version);
  if (!layout) throw notFound();
  return layout;
}

// The pacing check applies only to a press that would turn or move; every 409
// above comes first, so a seated press never answers 429 and refused presses
// do not restart the interval.
export async function checkPacing(session: SessionRow, personId: string, worldId: string): Promise<void> {
  const last = await lastStepAt(personId);
  const now = await worldClock(worldId);
  if (last !== null && now.getTime() - last < config.stepMinIntervalMs) {
    throw tooMany('Slow down a little.');
  }
  await query('UPDATE people SET last_step_at = $1 WHERE id = $2', [now.getTime(), personId]);
}

export async function lastStepAt(personId: string): Promise<number | null> {
  const rows = await query<{ last_step_at: string | null }>('SELECT last_step_at FROM people WHERE id = $1', [personId]);
  const v = rows[0]?.last_step_at;
  return v === null || v === undefined ? null : Number(v);
}

// ---------------------------------------------------------------------------
// Sit and stand
// ---------------------------------------------------------------------------

export async function sit(sessionId: string, personId: string): Promise<{ result: string; x: number; y: number; facing: Facing }> {
  await requireValkey();
  const session = await getSession(sessionId);
  if (!session || session.status !== 'open') throw notFound();
  const states = await allStates(sessionId);
  const me = states.get(personId);
  if (!me) throw notFound();
  if (me.seated) throw conflict('You are already seated.');
  const layout = await layoutOf(session, personId);
  const seat = seatAhead(layout, { x: me.x, y: me.y }, me.facing);
  if (!seat) throw conflict('No seat in front of you.');
  for (const [pid, st] of states) {
    if (pid !== personId && st.seated && st.seatId === seat.id) throw conflict('That seat is taken.');
  }
  const next: PersonState = { ...me, x: seat.x, y: seat.y, seated: true, seatId: seat.id, satFrom: { x: me.x, y: me.y } };
  await setState(sessionId, personId, next);
  await publishEvent(sessionId, { type: 'moved', personId, x: seat.x, y: seat.y, facing: me.facing, seated: true });
  return { result: 'seated', x: seat.x, y: seat.y, facing: me.facing };
}

export async function stand(sessionId: string, personId: string): Promise<{ result: string; x: number; y: number; facing: Facing }> {
  await requireValkey();
  const session = await getSession(sessionId);
  if (!session || session.status !== 'open') throw notFound();
  const states = await allStates(sessionId);
  const me = states.get(personId);
  if (!me) throw notFound();
  if (!me.seated) throw conflict('You are not seated.');
  const layout = await layoutOf(session, personId);
  const satFrom = me.satFrom ?? { x: me.x, y: me.y };
  let target: Tile | null = null;
  if (layoutAt(layout, satFrom.x, satFrom.y) === 'floor' && !occupiedBy(states, personId, satFrom)) target = satFrom;
  if (!target) {
    for (const dir of ['north', 'east', 'south', 'west'] as Facing[]) {
      const t = stepFrom({ x: me.x, y: me.y }, dir);
      if (t.x < 0 || t.y < 0 || t.x >= layout.width || t.y >= layout.height) continue;
      if (layoutAt(layout, t.x, t.y) !== 'floor') continue;
      if (!occupiedBy(states, personId, t)) {
        target = t;
        break;
      }
    }
  }
  if (!target) throw conflict('No space to stand.');
  const next: PersonState = { ...me, x: target.x, y: target.y, seated: false, seatId: undefined, satFrom: undefined };
  await setState(sessionId, personId, next);
  await publishEvent(sessionId, { type: 'moved', personId, x: target.x, y: target.y, facing: me.facing, seated: false });
  return { result: 'stood', x: target.x, y: target.y, facing: me.facing };
}

function occupiedBy(states: Map<string, PersonState>, personId: string, t: Tile): boolean {
  for (const [pid, st] of states) {
    if (pid !== personId && st.x === t.x && st.y === t.y) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Votes
// ---------------------------------------------------------------------------

export interface VoteRow {
  id: string;
  session_id: string;
  target_id: string;
  starter_id: string;
  status: string;
  eligible: string[];
  needed: number;
  yes: number;
  no: number;
  closes_at: Date;
}

export function voteNeeded(eligible: number): number {
  return Math.ceil(eligible * 0.6);
}

export async function startVote(sessionId: string, starterId: string, targetId: string, worldId: string): Promise<VoteRow> {
  await requireValkey();
  const session = await getSession(sessionId);
  if (!session || session.status !== 'open') throw notFound();
  if (starterId === targetId) throw invalid('You cannot start a vote about yourself.');
  const states = await allStates(sessionId);
  if (!states.has(targetId)) throw notFound();
  if (!states.has(starterId)) throw notFound();
  const open = await query<VoteRow & { eligible: unknown }>(
    "SELECT * FROM votes WHERE session_id = $1 AND target_id = $2 AND status = 'open'",
    [sessionId, targetId]
  );
  if (open.length) throw conflict('A vote on this person is already open.');
  const eligible = [...states.keys()].filter((pid) => pid !== targetId);
  if (eligible.length < 2) throw conflict('Too few people to vote.');
  const needed = voteNeeded(eligible.length);
  const now = await worldClock(worldId);
  const closesAt = new Date(now.getTime() + config.voteWindowSeconds * 1000);
  const id = opaqueId();
  const stored = JSON.stringify(eligible);
  await query(
    "INSERT INTO votes (id, session_id, target_id, starter_id, status, eligible, needed, yes, no, closes_at) VALUES ($1,$2,$3,$4,'open',$5,$6,1,0,$7)",
    [id, sessionId, targetId, starterId, stored, needed, closesAt]
  );
  await query("INSERT INTO ballots (vote_id, person_id, choice) VALUES ($1,$2,'yes')", [id, starterId]);
  const vote: VoteRow = { id, session_id: sessionId, target_id: targetId, starter_id: starterId, status: 'open', eligible, needed, yes: 1, no: 0, closes_at: closesAt };
  await publishEvent(sessionId, { type: 'vote-opened', voteId: id, targetId });
  return vote;
}

export async function castBallot(sessionId: string, voteId: string, personId: string, choice: string, worldId: string): Promise<VoteRow> {
  if (choice !== 'yes' && choice !== 'no') throw invalid('Choose yes or no.');
  await requireValkey();
  const now = await worldClock(worldId);
  const rows = await query<VoteRow & { eligible: unknown }>(
    'SELECT * FROM votes WHERE id = $1 AND session_id = $2',
    [voteId, sessionId]
  );
  if (!rows.length) throw notFound();
  const vote = rows[0];
  const eligible = Array.isArray(vote.eligible) ? (vote.eligible as string[]) : JSON.parse(String(vote.eligible));
  if (vote.status !== 'open') throw conflict('This vote has closed.');
  if (now.getTime() >= vote.closes_at.getTime()) throw conflict('This vote has closed.');
  if (!eligible.includes(personId)) throw conflict('You cannot vote on this.');
  if (vote.target_id === personId) throw conflict('You cannot vote on this.');
  const existing = await query('SELECT 1 FROM ballots WHERE vote_id = $1 AND person_id = $2', [voteId, personId]);
  if (existing.length) throw conflict('You have already voted.');
  await query('INSERT INTO ballots (vote_id, person_id, choice) VALUES ($1,$2,$3)', [voteId, personId, choice]);
  const yes = vote.yes + (choice === 'yes' ? 1 : 0);
  const no = vote.no + (choice === 'no' ? 1 : 0);
  await query('UPDATE votes SET yes = $1, no = $2 WHERE id = $3', [yes, no, voteId]);
  let status = vote.status;
  if (yes >= vote.needed) {
    status = 'passed';
    await query("UPDATE votes SET status = 'passed' WHERE id = $1", [voteId]);
  }
  const updated: VoteRow = { ...vote, yes, no, status, eligible };
  if (status === 'passed') {
    await removeByVote(sessionId, vote.target_id);
  }
  return updated;
}

export async function closeDueVote(vote: VoteRow): Promise<'passed' | 'failed' | null> {
  if (vote.status !== 'open') return null;
  if (vote.yes >= vote.needed) {
    await query("UPDATE votes SET status = 'passed' WHERE id = $1", [vote.id]);
    return 'passed';
  }
  await query("UPDATE votes SET status = 'failed' WHERE id = $1", [vote.id]);
  await publishEvent(vote.session_id, { type: 'vote-failed', voteId: vote.id });
  return 'failed';
}

export async function removeByVote(sessionId: string, targetId: string): Promise<void> {
  const states = await allStates(sessionId);
  const name = states.get(targetId)?.name ?? 'Someone';
  await removeState(sessionId, targetId);
  await query("UPDATE session_members SET left_at = now(), removed = true WHERE session_id = $1 AND person_id = $2 AND left_at IS NULL", [sessionId, targetId]);
  await publishEvent(sessionId, { type: 'removed-by-vote', personId: targetId, name });
  await publishEvent(sessionId, { type: 'me-removed', personId: targetId });
  const session = await getSession(sessionId);
  if (session) await endOrHandOver(sessionId, session, targetId, states);
}

// ---------------------------------------------------------------------------
// Valkey locks for atomic cross-instance claims
// ---------------------------------------------------------------------------

export async function valkeyLock(key: string): Promise<string> {
  const token = opaqueId();
  for (let i = 0; i < 50; i++) {
    const ok = await valkey.command('SET', `${key}:lock`, token, 'NX', 'PX', 5000);
    if (ok === 'OK') return token;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new ApiError(503, 'Live rooms are unavailable right now.');
}

export async function valkeyUnlock(key: string, token: string): Promise<void> {
  const current = await valkey.get(`${key}:lock`).catch(() => null);
  if (current === token) await valkey.del(`${key}:lock`).catch(() => {});
}

export { decodeState, encodeState, isMember };
