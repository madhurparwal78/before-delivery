import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { one, query, transact } from './db.js';
import { ApiError, ServiceDownError, conflict, invalid, notFound } from './errors.js';
import { worldNow } from './clock.js';
import { avatarRanks, currentPublishedVersion, getAsset, getVersion } from './assets.js';
import type { PersonRow } from './auth.js';
import type { Facing, Layout, Tile } from './domain/layout.js';
import { isFacing, joinCandidates, standCandidates, tileAhead, tileKind } from './domain/layout.js';
import { withinEarshot } from './domain/earshot.js';
import type { Rank } from './domain/ranks.js';
import { hiddenByRankSetting, isRank } from './domain/ranks.js';
import type { Visibility } from './domain/visibility.js';
import { isVisibility, maySeeSession } from './domain/visibility.js';
import type { RawPerson } from './events.js';
import { publishPersonEvent, publishSessionEvent } from './events.js';
import {
  claimPlace,
  claimTile,
  clearSessionKeys,
  releasePlace,
  releaseTile,
  valkeyUp
} from './services/valkey.js';

export const STEP_TEXT = {
  seated: 'Stand up to move.',
  wall: 'A wall blocks that way.',
  seat: 'A seat blocks that way.',
  person: 'Someone is standing there.',
  direction: 'Choose north, east, south or west.',
  pacing: 'Slow down a little.'
} as const;

export const SIT_TEXT = {
  none: 'No seat in front of you.',
  taken: 'That seat is taken.',
  already: 'You are already seated.'
} as const;

export const STAND_TEXT = {
  noSpace: 'No space to stand.',
  notSeated: 'You are not seated.'
} as const;

export const SESSION_TEXT = {
  full: 'This session is full.',
  capacity: `Capacity must be between 1 and ${config.sessionCapacityMax}.`,
  visibility: 'Choose public, friends, community or invite.',
  community: 'Choose a community for this session.'
} as const;

export const CHAT_TEXT = {
  empty: 'Write something to send.',
  tooLong: `Messages can be at most ${config.chatMaxChars} characters.`
} as const;

export interface SessionRow {
  id: string;
  world_id: string;
  room_asset_id: string;
  host_id: string;
  visibility: Visibility;
  capacity: number;
  community_id: string | null;
  status: 'open' | 'ended';
  created_at: Date;
}

export interface MemberRow {
  session_id: string;
  person_id: string;
  joined_at: Date;
  room_version: number;
  x: number;
  y: number;
  facing: Facing;
  seated: boolean;
  seat_id: string | null;
  sat_from_x: number | null;
  sat_from_y: number | null;
  last_action_at: Date | null;
  drop_deadline: Date | null;
  active: boolean;
  display_name: string;
}

export interface ViewerLens {
  personId: string;
  blocked: Set<string>;
  muted: Set<string>;
  hideAbove: Rank | null;
}

export interface MirrorPerson {
  personId: string;
  displayName: string;
  x: number;
  y: number;
  facing: Facing;
  seated: boolean;
  avatar: 'shown' | 'hidden' | 'fallback';
  host: boolean;
}

export async function lensFor(person: PersonRow): Promise<ViewerLens> {
  const blocks = await query<{ other: string }>(
    `select blocked_id as other from blocks where blocker_id = $1
     union select blocker_id as other from blocks where blocked_id = $1`,
    [person.id]
  );
  const mutes = await query<{ muted_id: string }>('select muted_id from mutes where muter_id = $1', [person.id]);
  return {
    personId: person.id,
    blocked: new Set(blocks.map((row) => row.other)),
    muted: new Set(mutes.map((row) => row.muted_id)),
    hideAbove: isRank(person.hide_above) ? person.hide_above : null
  };
}

export function projectPerson(lens: ViewerLens, raw: RawPerson): MirrorPerson {
  const blocked = lens.blocked.has(raw.personId);
  const own = raw.personId === lens.personId;
  const avatar: MirrorPerson['avatar'] =
    blocked || raw.avatarRank === null
      ? 'fallback'
      : !own && hiddenByRankSetting(lens.hideAbove, raw.avatarRank)
        ? 'hidden'
        : 'shown';
  return {
    personId: raw.personId,
    displayName: blocked ? 'Someone' : raw.displayName,
    x: raw.x,
    y: raw.y,
    facing: raw.facing,
    seated: raw.seated,
    avatar,
    host: raw.host
  };
}

export function projectName(lens: ViewerLens, personId: string, displayName: string): string {
  return lens.blocked.has(personId) ? 'Someone' : displayName;
}

export async function getOpenSession(sessionId: string): Promise<SessionRow | null> {
  return one<SessionRow>(`select * from sessions where id = $1 and status = 'open'`, [sessionId]);
}

export async function activeMembers(sessionId: string): Promise<MemberRow[]> {
  return query<MemberRow>(
    `select m.*, p.display_name from session_members m
       join people p on p.id = m.person_id
      where m.session_id = $1 and m.active = true
      order by m.joined_at asc, m.person_id asc`,
    [sessionId]
  );
}

export async function memberOf(sessionId: string, personId: string): Promise<MemberRow | null> {
  return one<MemberRow>(
    `select m.*, p.display_name from session_members m
       join people p on p.id = m.person_id
      where m.session_id = $1 and m.person_id = $2 and m.active = true`,
    [sessionId, personId]
  );
}

export async function rawPeopleOf(session: SessionRow, members: MemberRow[]): Promise<RawPerson[]> {
  const ranks = await avatarRanks(members.map((member) => member.person_id));
  return members.map((member) => ({
    personId: member.person_id,
    displayName: member.display_name,
    x: member.x,
    y: member.y,
    facing: member.facing,
    seated: member.seated,
    host: member.person_id === session.host_id,
    avatarRank: ranks.get(member.person_id) ?? null
  }));
}

export async function rawPersonOf(session: SessionRow, member: MemberRow): Promise<RawPerson> {
  const people = await rawPeopleOf(session, [member]);
  const person = people[0];
  if (person === undefined) throw notFound();
  return person;
}

async function mayUseSession(person: PersonRow, session: SessionRow): Promise<boolean> {
  const inside = (await memberOf(session.id, person.id)) !== null;
  const banned = await one('select 1 from session_bans where session_id = $1 and person_id = $2', [
    session.id,
    person.id
  ]);
  const friend = await one(
    `select 1 from friendships where (person_a = $1 and person_b = $2) or (person_a = $2 and person_b = $1)`,
    [person.id, session.host_id]
  );
  const member =
    session.community_id === null
      ? null
      : await one('select 1 from community_members where community_id = $1 and person_id = $2', [
          session.community_id,
          person.id
        ]);
  const invited = await one('select 1 from session_invitees where session_id = $1 and person_id = $2', [
    session.id,
    person.id
  ]);
  const blocked = await one(
    `select 1 from blocks where (blocker_id = $1 and blocked_id = $2) or (blocker_id = $2 and blocked_id = $1)`,
    [person.id, session.host_id]
  );
  return maySeeSession(session.visibility, {
    sameWorld: session.world_id === person.world_id,
    inside,
    bannedByVote: banned !== null,
    friendOfHost: friend !== null,
    communityMember: member !== null,
    invited: invited !== null,
    blockedWithHost: blocked !== null
  });
}

export async function requireVisibleSession(person: PersonRow, sessionId: string): Promise<SessionRow> {
  const session = await getOpenSession(sessionId);
  if (session === null) throw notFound();
  if (!(await mayUseSession(person, session))) throw notFound();
  return session;
}

export async function requireMembership(person: PersonRow, session: SessionRow): Promise<MemberRow> {
  const member = await memberOf(session.id, person.id);
  if (member === null) throw notFound();
  return member;
}

export interface SessionSummary {
  id: string;
  roomName: string;
  hostName: string;
  visibility: Visibility;
  capacity: number;
  count: number;
  status: string;
}

export async function summaryFor(lens: ViewerLens, session: SessionRow): Promise<SessionSummary> {
  const room = await getAsset(session.room_asset_id);
  const members = await activeMembers(session.id);
  const host = await one<{ display_name: string }>('select display_name from people where id = $1', [session.host_id]);
  const hostName = host?.display_name ?? '';
  return {
    id: session.id,
    roomName: room?.name ?? '',
    hostName: projectName(lens, session.host_id, hostName),
    visibility: session.visibility,
    capacity: session.capacity,
    count: members.length,
    status: session.status
  };
}

export async function layoutOfVersion(assetId: string, version: number): Promise<Layout> {
  const row = await getVersion(assetId, version);
  if (row === null || row.layout === null) throw notFound();
  return row.layout;
}

export interface SessionDetail extends SessionSummary {
  roomId: string;
  roomVersion: number;
  hostId: string;
  communityId: string | null;
  layout?: Layout;
  features?: Array<{ id: string; kind: 'exit' | 'seat'; x: number; y: number; occupiedBy: string }>;
  people?: MirrorPerson[];
}

export async function detailFor(person: PersonRow, session: SessionRow): Promise<SessionDetail> {
  const lens = await lensFor(person);
  const summary = await summaryFor(lens, session);
  const member = await memberOf(session.id, person.id);
  const current = await currentPublishedVersion(session.room_asset_id);
  const version = member?.room_version ?? current?.version ?? 1;
  const detail: SessionDetail = {
    ...summary,
    roomId: session.room_asset_id,
    roomVersion: version,
    hostId: session.host_id,
    communityId: session.community_id
  };
  if (member === null) return detail;
  const layout = await layoutOfVersion(session.room_asset_id, version);
  const members = await activeMembers(session.id);
  const raw = await rawPeopleOf(session, members);
  detail.layout = layout;
  detail.features = [
    ...layout.exits.map((exit) => ({ id: exit.id, kind: 'exit' as const, x: exit.x, y: exit.y, occupiedBy: '' })),
    ...layout.seats.map((seat) => ({
      id: seat.id,
      kind: 'seat' as const,
      x: seat.x,
      y: seat.y,
      occupiedBy:
        members.find((entry) => entry.seated && entry.x === seat.x && entry.y === seat.y)?.person_id ?? ''
    }))
  ];
  detail.people = raw.map((entry) => projectPerson(lens, entry));
  return detail;
}

function seedOf(members: MemberRow[]): Array<{ personId: string; x: number; y: number; facing: string; seated: boolean }> {
  return members.map((member) => ({
    personId: member.person_id,
    x: member.x,
    y: member.y,
    facing: member.facing,
    seated: member.seated
  }));
}

export async function notifyFriendsOfPresence(personId: string): Promise<void> {
  const friends = await query<{ other: string }>(
    `select person_b as other from friendships where person_a = $1
     union select person_a as other from friendships where person_b = $1`,
    [personId]
  );
  for (const friend of friends) await publishPersonEvent(friend.other, { type: 'friend-presence' });
}

export async function openSession(
  person: PersonRow,
  input: { roomId: unknown; visibility: unknown; capacity: unknown; communityId: unknown }
): Promise<SessionDetail> {
  const roomId = typeof input.roomId === 'string' ? input.roomId : '';
  const room = await getAsset(roomId);
  if (room === null || room.kind !== 'room' || room.world_id !== person.world_id) throw notFound();
  const published = await currentPublishedVersion(room.id);
  if (published === null || published.layout === null) throw notFound();

  const communityId = typeof input.communityId === 'string' ? input.communityId : null;
  if (communityId !== null) {
    const role = await one<{ role: string; world_id: string }>(
      `select m.role, c.world_id from community_members m join communities c on c.id = m.community_id
        where m.community_id = $1 and m.person_id = $2`,
      [communityId, person.id]
    );
    if (role === null || role.world_id !== person.world_id || role.role === 'member') throw notFound();
  }

  if (!isVisibility(input.visibility)) throw invalid(SESSION_TEXT.visibility);
  const capacity = input.capacity;
  if (!Number.isInteger(capacity) || (capacity as number) < 1 || (capacity as number) > config.sessionCapacityMax) {
    throw invalid(SESSION_TEXT.capacity);
  }
  if (input.visibility === 'community' && communityId === null) throw invalid(SESSION_TEXT.community);
  if (!valkeyUp()) throw new ServiceDownError('valkey');

  const now = await worldNow(person.world_id);
  const sessionId = randomUUID();
  const layout = published.layout;
  const session: SessionRow = {
    id: sessionId,
    world_id: person.world_id,
    room_asset_id: room.id,
    host_id: person.id,
    visibility: input.visibility,
    capacity: capacity as number,
    community_id: input.visibility === 'community' ? communityId : null,
    status: 'open',
    created_at: now
  };
  await transact(async (client) => {
    await client.query(
      `insert into sessions (id, world_id, room_asset_id, host_id, visibility, capacity, community_id, status, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'open', $8)`,
      [
        session.id,
        session.world_id,
        session.room_asset_id,
        session.host_id,
        session.visibility,
        session.capacity,
        session.community_id,
        now
      ]
    );
    const tile = await claimTile(session.id, [], person.id, 'south', false, joinCandidates(layout));
    if (tile === null) throw conflict(SESSION_TEXT.full);
    await claimPlace(session.id, [], person.id, session.capacity);
    await client.query(
      `insert into session_members (session_id, person_id, joined_at, room_version, x, y, facing)
       values ($1, $2, $3, $4, $5, $6, 'south')`,
      [session.id, person.id, now, published.version, tile.x, tile.y]
    );
  });
  await notifyFriendsOfPresence(person.id);
  return detailFor(person, session);
}

export async function joinSession(person: PersonRow, session: SessionRow): Promise<SessionDetail> {
  const existing = await memberOf(session.id, person.id);
  if (existing !== null) return detailFor(person, session);
  if (!valkeyUp()) throw new ServiceDownError('valkey');
  const published = await currentPublishedVersion(session.room_asset_id);
  if (published === null || published.layout === null) throw notFound();
  const now = await worldNow(person.world_id);
  const members = await activeMembers(session.id);
  const place = await claimPlace(
    session.id,
    members.map((member) => member.person_id),
    person.id,
    session.capacity
  );
  if (place === 'full') throw conflict(SESSION_TEXT.full);
  const layout = published.layout;
  try {
    const tile = await claimTile(session.id, seedOf(members), person.id, 'south', false, joinCandidates(layout));
    if (tile === null) throw conflict(SESSION_TEXT.full);
    await query(
      `insert into session_members (session_id, person_id, joined_at, room_version, x, y, facing, seated, seat_id,
                                   sat_from_x, sat_from_y, last_action_at, drop_deadline, active)
       values ($1, $2, $3, $4, $5, $6, 'south', false, null, null, null, null, null, true)
       on conflict (session_id, person_id) do update
         set joined_at = $3, room_version = $4, x = $5, y = $6, facing = 'south', seated = false, seat_id = null,
             sat_from_x = null, sat_from_y = null, last_action_at = null, drop_deadline = null, active = true`,
      [session.id, person.id, now, published.version, tile.x, tile.y]
    );
    const member = await requireMembership(person, session);
    await publishSessionEvent(session.id, { type: 'person-arrived', person: await rawPersonOf(session, member) });
    await notifyFriendsOfPresence(person.id);
    return detailFor(person, session);
  } catch (error) {
    if (place === 'ok') await releasePlace(session.id, person.id).catch(() => undefined);
    throw error;
  }
}

export async function leaveSession(session: SessionRow, personId: string, displayName: string): Promise<void> {
  const settle = async (): Promise<{ ended: boolean; newHost: MemberRow | null }> => {
    await query(
      `update session_members set active = false, drop_deadline = null, seated = false, seat_id = null
        where session_id = $1 and person_id = $2 and active = true`,
      [session.id, personId]
    );
    const remaining = await activeMembers(session.id);
    if (remaining.length === 0) {
      await query(`update sessions set status = 'ended', ended_at = now() where id = $1`, [session.id]);
      return { ended: true, newHost: null };
    }
    if (session.host_id !== personId) return { ended: false, newHost: null };
    const next = remaining[0] ?? null;
    if (next !== null) await query('update sessions set host_id = $2 where id = $1', [session.id, next.person_id]);
    return { ended: false, newHost: next };
  };
  const result = await settle();
  if (valkeyUp()) {
    await releaseTile(session.id, personId).catch(() => undefined);
    await releasePlace(session.id, personId).catch(() => undefined);
    if (result.ended) await clearSessionKeys(session.id).catch(() => undefined);
  }
  await publishSessionEvent(session.id, { type: 'person-left', personId, displayName });
  if (result.ended) await publishSessionEvent(session.id, { type: 'session-ended' });
  if (result.newHost !== null) {
    await publishSessionEvent(session.id, {
      type: 'host-changed',
      personId: result.newHost.person_id,
      displayName: result.newHost.display_name
    });
  }
  await notifyFriendsOfPresence(personId);
}

function pacingCheck(member: MemberRow, now: Date): void {
  if (member.last_action_at === null) return;
  if (now.getTime() - member.last_action_at.getTime() < config.stepMinIntervalMs) {
    throw new ApiError(429, STEP_TEXT.pacing);
  }
}

export interface StepResult {
  result: 'turned' | 'moved' | 'left' | 'seated' | 'stood';
  x: number;
  y: number;
  facing: Facing;
}

export async function stepInSession(
  person: PersonRow,
  session: SessionRow,
  direction: unknown
): Promise<StepResult> {
  const member = await requireMembership(person, session);
  if (!valkeyUp()) throw new ServiceDownError('valkey');
  if (member.seated) throw conflict(STEP_TEXT.seated);
  if (!isFacing(direction)) throw invalid(STEP_TEXT.direction);
  const now = await worldNow(session.world_id);
  const layout = await layoutOfVersion(session.room_asset_id, member.room_version);
  const members = await activeMembers(session.id);

  if (member.facing !== direction) {
    pacingCheck(member, now);
    await query('update session_members set facing = $3, last_action_at = $4 where session_id = $1 and person_id = $2', [
      session.id,
      person.id,
      direction,
      now
    ]);
    await claimTile(session.id, seedOf(members), person.id, direction, false, [{ x: member.x, y: member.y }]);
    await publishMoved(session, person.id);
    return { result: 'turned', x: member.x, y: member.y, facing: direction };
  }

  const target = tileAhead({ x: member.x, y: member.y }, direction);
  const kind = tileKind(layout, target);
  if (kind === 'outside' || kind === 'wall') throw conflict(STEP_TEXT.wall);
  if (kind === 'seat') throw conflict(STEP_TEXT.seat);
  if (members.some((entry) => entry.person_id !== person.id && entry.x === target.x && entry.y === target.y)) {
    throw conflict(STEP_TEXT.person);
  }
  pacingCheck(member, now);

  if (kind === 'exit') {
    await leaveSession(session, person.id, member.display_name);
    return { result: 'left', x: member.x, y: member.y, facing: direction };
  }

  const claimed = await claimTile(session.id, seedOf(members), person.id, direction, false, [target]);
  if (claimed === null) throw conflict(STEP_TEXT.person);
  await query(
    'update session_members set x = $3, y = $4, facing = $5, last_action_at = $6 where session_id = $1 and person_id = $2',
    [session.id, person.id, claimed.x, claimed.y, direction, now]
  );
  await publishMoved(session, person.id);
  return { result: 'moved', x: claimed.x, y: claimed.y, facing: direction };
}

async function publishMoved(session: SessionRow, personId: string): Promise<void> {
  const member = await memberOf(session.id, personId);
  if (member === null) return;
  await publishSessionEvent(session.id, { type: 'person-moved', person: await rawPersonOf(session, member) });
}

export async function sitInSession(person: PersonRow, session: SessionRow): Promise<StepResult> {
  const member = await requireMembership(person, session);
  if (!valkeyUp()) throw new ServiceDownError('valkey');
  if (member.seated) throw conflict(SIT_TEXT.already);
  const layout = await layoutOfVersion(session.room_asset_id, member.room_version);
  const ahead = tileAhead({ x: member.x, y: member.y }, member.facing);
  const seat = layout.seats.find((entry) => entry.x === ahead.x && entry.y === ahead.y);
  if (seat === undefined) throw conflict(SIT_TEXT.none);
  const members = await activeMembers(session.id);
  if (members.some((entry) => entry.person_id !== person.id && entry.x === seat.x && entry.y === seat.y)) {
    throw conflict(SIT_TEXT.taken);
  }
  const claimed = await claimTile(session.id, seedOf(members), person.id, member.facing, true, [
    { x: seat.x, y: seat.y }
  ]);
  if (claimed === null) throw conflict(SIT_TEXT.taken);
  await query(
    `update session_members set x = $3, y = $4, seated = true, seat_id = $5, sat_from_x = $6, sat_from_y = $7
      where session_id = $1 and person_id = $2`,
    [session.id, person.id, seat.x, seat.y, seat.id, member.x, member.y]
  );
  await publishMoved(session, person.id);
  return { result: 'seated', x: seat.x, y: seat.y, facing: member.facing };
}

export async function standInSession(person: PersonRow, session: SessionRow): Promise<StepResult> {
  const member = await requireMembership(person, session);
  if (!valkeyUp()) throw new ServiceDownError('valkey');
  if (!member.seated) throw conflict(STAND_TEXT.notSeated);
  const layout = await layoutOfVersion(session.room_asset_id, member.room_version);
  const satFrom: Tile | null =
    member.sat_from_x === null || member.sat_from_y === null ? null : { x: member.sat_from_x, y: member.sat_from_y };
  const candidates = standCandidates(layout, { x: member.x, y: member.y }, satFrom);
  const members = await activeMembers(session.id);
  const free = candidates.filter(
    (tile) => !members.some((entry) => entry.person_id !== person.id && entry.x === tile.x && entry.y === tile.y)
  );
  if (free.length === 0) throw conflict(STAND_TEXT.noSpace);
  const claimed = await claimTile(session.id, seedOf(members), person.id, member.facing, false, free);
  if (claimed === null) throw conflict(STAND_TEXT.noSpace);
  await query(
    `update session_members set x = $3, y = $4, seated = false, seat_id = null, sat_from_x = null, sat_from_y = null
      where session_id = $1 and person_id = $2`,
    [session.id, person.id, claimed.x, claimed.y]
  );
  await publishMoved(session, person.id);
  return { result: 'stood', x: claimed.x, y: claimed.y, facing: member.facing };
}

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function countCharacters(text: string): number {
  let total = 0;
  for (const _unit of segmenter.segment(text)) total += 1;
  return total;
}

export async function sendChat(
  person: PersonRow,
  session: SessionRow,
  text: unknown
): Promise<{ id: string; heardBy: number }> {
  const member = await requireMembership(person, session);
  if (!valkeyUp()) throw new ServiceDownError('valkey');
  if (typeof text !== 'string' || text.trim() === '') throw invalid(CHAT_TEXT.empty);
  if (countCharacters(text) > config.chatMaxChars) throw invalid(CHAT_TEXT.tooLong);
  const now = await worldNow(session.world_id);
  const members = await activeMembers(session.id);
  const blocks = await query<{ other: string }>(
    `select blocked_id as other from blocks where blocker_id = $1
     union select blocker_id as other from blocks where blocked_id = $1`,
    [person.id]
  );
  const blocked = new Set(blocks.map((row) => row.other));
  const muters = await query<{ muter_id: string }>('select muter_id from mutes where muted_id = $1', [person.id]);
  const mutedBy = new Set(muters.map((row) => row.muter_id));
  const recipients = members
    .filter((entry) => entry.person_id !== person.id)
    .filter((entry) => withinEarshot({ x: member.x, y: member.y }, { x: entry.x, y: entry.y }))
    .filter((entry) => !blocked.has(entry.person_id) && !mutedBy.has(entry.person_id))
    .map((entry) => entry.person_id);
  const id = randomUUID();
  await transact(async (client) => {
    await client.query('insert into chat_messages (id, session_id, from_id, text, sent_at) values ($1, $2, $3, $4, $5)', [
      id,
      session.id,
      person.id,
      text,
      now
    ]);
    for (const recipient of recipients) {
      await client.query('insert into chat_recipients (message_id, person_id) values ($1, $2)', [id, recipient]);
    }
  });
  await publishSessionEvent(session.id, {
    type: 'chat',
    message: {
      id,
      fromId: person.id,
      fromName: member.display_name,
      text,
      sentAt: now.toISOString()
    },
    recipients
  });
  return { id, heardBy: recipients.length };
}

export async function chatHistory(
  person: PersonRow,
  session: SessionRow
): Promise<Array<{ id: string; fromId: string; fromName: string; text: string; sentAt: string }>> {
  const lens = await lensFor(person);
  const rows = await query<{ id: string; from_id: string; display_name: string; text: string; sent_at: Date }>(
    `select m.id, m.from_id, p.display_name, m.text, m.sent_at
       from chat_messages m
       join people p on p.id = m.from_id
      where m.session_id = $1
        and (m.from_id = $2 or exists (select 1 from chat_recipients r where r.message_id = m.id and r.person_id = $2))
      order by m.sent_at asc, m.id asc`,
    [session.id, person.id]
  );
  return rows.map((row) => ({
    id: row.id,
    fromId: row.from_id,
    fromName: projectName(lens, row.from_id, row.display_name),
    text: row.text,
    sentAt: row.sent_at.toISOString()
  }));
}

export async function visibleSessions(person: PersonRow): Promise<SessionRow[]> {
  const sessions = await query<SessionRow>(
    `select * from sessions where world_id = $1 and status = 'open' order by created_at asc`,
    [person.world_id]
  );
  const visible: SessionRow[] = [];
  for (const session of sessions) {
    if (await mayUseSession(person, session)) visible.push(session);
  }
  return visible;
}

export async function maySeeSessionRow(person: PersonRow, session: SessionRow): Promise<boolean> {
  return mayUseSession(person, session);
}
