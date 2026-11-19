import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { SETUP_BODY_LIMIT, config } from '../config.js';
import { invalid, notFound } from '../errors.js';
import { readJsonBody, route, sendJson } from '../http.js';
import { setHeldClock, worldExists, worldNow } from '../clock.js';
import { transact } from '../db.js';
import { hashPassword } from '../auth.js';
import { runDueWork } from '../duework.js';
import { generateGlb } from '../domain/glbgen.js';
import { isFacing, parseLayout } from '../domain/layout.js';
import { isRank } from '../domain/ranks.js';
import type { AssetKind, Rank } from '../domain/ranks.js';
import { isVisibility } from '../domain/visibility.js';
import { isAllowedZone } from '../domain/zones.js';
import { isRecurrence } from '../domain/gatherings.js';
import { rankOf } from '../domain/ranks.js';
import { inspectGlb } from '../domain/glb.js';
import { objectKey, putObject } from '../services/storage.js';
import { setForcedDown } from '../services/outage.js';

function requireGradingKey(header: string | string[] | undefined): void {
  const given = Array.isArray(header) ? header[0] : header;
  if (config.gradingKey === '' || given !== config.gradingKey) throw notFound();
}

function asArray(value: unknown, label: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid(`${label} must be a list.`);
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '') throw invalid(`${label} is required.`);
  return value;
}

function lookup(map: Map<string, string>, key: unknown, label: string): string {
  if (typeof key !== 'string') throw invalid(`${label} must name a key.`);
  const found = map.get(key);
  if (found === undefined) throw invalid(`Unknown ${label}: ${key}.`);
  return found;
}

interface PendingVersion {
  assetId: string;
  version: number;
  kind: AssetKind;
  rank: Rank;
  name: string;
  layout: unknown;
  published: boolean;
}

async function insertAssetVersions(client: PoolClient, pending: PendingVersion[], now: Date): Promise<void> {
  for (const entry of pending) {
    const bytes = generateGlb(entry.kind, entry.rank, entry.name);
    const inspection = inspectGlb(bytes, entry.kind);
    if (!inspection.ok) throw invalid(`Generated model for ${entry.name} is not valid.`);
    const ranking = rankOf(entry.kind, inspection.measures);
    if (ranking.rank !== entry.rank) throw invalid(`Cannot generate a ${entry.rank} model for ${entry.name}.`);
    await putObject(objectKey(entry.assetId, entry.version), bytes);
    await client.query(
      `insert into asset_versions (asset_id, version, status, rank, worst_measure, measures, layout, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.assetId,
        entry.version,
        entry.published ? 'published' : 'checked',
        ranking.rank,
        ranking.worstMeasure,
        JSON.stringify(inspection.measures),
        entry.layout === undefined ? null : JSON.stringify(entry.layout),
        now
      ]
    );
  }
}

function versionsOf(entry: Record<string, unknown>, kind: AssetKind, name: string, assetId: string): PendingVersion[] {
  const raw = entry['versions'];
  if (raw === undefined) {
    const rank = entry['rank'] ?? 'Feather';
    if (!isRank(rank)) throw invalid(`Unknown rank for ${name}.`);
    let layout: unknown = undefined;
    if (kind === 'room') {
      layout = entry['layout'];
      if (parseLayout(layout) === null) throw invalid(`Layout for ${name} is not valid.`);
    }
    return [{ assetId, version: 1, kind, rank, name, layout, published: true }];
  }
  const list = asArray(raw, `versions for ${name}`);
  if (list.length === 0) throw invalid(`Give at least one version for ${name}.`);
  return list.map((item, index) => {
    const version = asRecord(item, `version of ${name}`);
    const rank = version['rank'] ?? 'Feather';
    if (!isRank(rank)) throw invalid(`Unknown rank for ${name}.`);
    let layout: unknown = undefined;
    if (kind === 'room') {
      layout = version['layout'];
      if (parseLayout(layout) === null) throw invalid(`Layout for ${name} is not valid.`);
    }
    return {
      assetId,
      version: index + 1,
      kind,
      rank,
      name,
      layout,
      published: version['published'] === undefined ? true : version['published'] === true
    };
  });
}

route('POST', '/api/grading/setup', 'open', async (ctx) => {
  requireGradingKey(ctx.req.headers['x-grading-key']);
  const body = await readJsonBody(ctx, SETUP_BODY_LIMIT);
  const worldId = randomUUID();
  const people = new Map<string, string>();
  const communities = new Map<string, string>();
  const avatars = new Map<string, string>();
  const rooms = new Map<string, string>();
  const sessions = new Map<string, string>();
  const reports = new Map<string, string>();
  const gatherings = new Map<string, string>();

  await transact(async (client) => {
    await client.query('insert into worlds (id) values ($1)', [worldId]);
    const now = new Date();

    const peopleInput = asArray(body['people'], 'people').map((item) => asRecord(item, 'person'));
    for (const person of peopleInput) {
      const key = text(person['key'], 'person key');
      const email = text(person['email'], 'person email');
      const password = text(person['password'], 'person password');
      const displayName = text(person['displayName'], 'person displayName');
      const timeZone = person['timeZone'];
      if (!isAllowedZone(timeZone)) throw invalid(`Unknown time zone for ${key}.`);
      const siteRole = person['siteRole'] ?? 'member';
      if (siteRole !== 'member' && siteRole !== 'moderator') throw invalid(`Unknown site role for ${key}.`);
      const id = randomUUID();
      const exists = await client.query('select 1 from people where lower(email) = $1', [email.toLowerCase()]);
      if (exists.rowCount !== null && exists.rowCount > 0) throw invalid(`Email already used: ${email}.`);
      await client.query(
        `insert into people (id, world_id, email, password_hash, display_name, time_zone, site_role, confirmed)
         values ($1, $2, $3, $4, $5, $6, $7, true)`,
        [id, worldId, email, hashPassword(password), displayName, timeZone, siteRole]
      );
      people.set(key, id);
    }

    const pendingVersions: PendingVersion[] = [];
    for (const item of asArray(body['avatars'], 'avatars')) {
      const avatar = asRecord(item, 'avatar');
      const key = text(avatar['key'], 'avatar key');
      const name = text(avatar['name'], 'avatar name');
      const ownerId = lookup(people, avatar['owner'], 'avatar owner');
      const id = randomUUID();
      const versions = versionsOf(avatar, 'avatar', name, id);
      await client.query(
        `insert into assets (id, world_id, kind, name, owner_id, last_version, created_at)
         values ($1, $2, 'avatar', $3, $4, $5, $6)`,
        [id, worldId, name, ownerId, versions.length, now]
      );
      pendingVersions.push(...versions);
      avatars.set(key, id);
    }
    for (const item of asArray(body['rooms'], 'rooms')) {
      const room = asRecord(item, 'room');
      const key = text(room['key'], 'room key');
      const name = text(room['name'], 'room name');
      const ownerId = lookup(people, room['owner'], 'room owner');
      const id = randomUUID();
      const versions = versionsOf(room, 'room', name, id);
      await client.query(
        `insert into assets (id, world_id, kind, name, owner_id, last_version, created_at)
         values ($1, $2, 'room', $3, $4, $5, $6)`,
        [id, worldId, name, ownerId, versions.length, now]
      );
      pendingVersions.push(...versions);
      rooms.set(key, id);
    }
    await insertAssetVersions(client, pendingVersions, now);

    for (const person of peopleInput) {
      if (person['avatar'] === undefined || person['avatar'] === null) continue;
      const avatarId = lookup(avatars, person['avatar'], 'person avatar');
      await client.query('update people set avatar_asset_id = $2 where id = $1', [
        lookup(people, person['key'], 'person key'),
        avatarId
      ]);
    }

    for (const item of asArray(body['friendships'], 'friendships')) {
      if (!Array.isArray(item) || item.length !== 2) throw invalid('A friendship needs two person keys.');
      const [first, second] = [lookup(people, item[0], 'friendship person'), lookup(people, item[1], 'friendship person')].sort();
      await client.query('insert into friendships (person_a, person_b) values ($1, $2) on conflict do nothing', [
        first,
        second
      ]);
    }
    for (const item of asArray(body['blocks'], 'blocks')) {
      const block = asRecord(item, 'block');
      await client.query('insert into blocks (blocker_id, blocked_id) values ($1, $2) on conflict do nothing', [
        lookup(people, block['from'], 'block from'),
        lookup(people, block['to'], 'block to')
      ]);
    }
    for (const item of asArray(body['mutes'], 'mutes')) {
      const mute = asRecord(item, 'mute');
      await client.query('insert into mutes (muter_id, muted_id) values ($1, $2) on conflict do nothing', [
        lookup(people, mute['from'], 'mute from'),
        lookup(people, mute['to'], 'mute to')
      ]);
    }

    for (const item of asArray(body['communities'], 'communities')) {
      const community = asRecord(item, 'community');
      const key = text(community['key'], 'community key');
      const name = text(community['name'], 'community name');
      const timeZone = community['timeZone'];
      if (!isAllowedZone(timeZone)) throw invalid(`Unknown time zone for ${key}.`);
      const id = randomUUID();
      await client.query('insert into communities (id, world_id, name, time_zone) values ($1, $2, $3, $4)', [
        id,
        worldId,
        name,
        timeZone
      ]);
      for (const memberItem of asArray(community['members'], 'community members')) {
        const member = asRecord(memberItem, 'community member');
        const role = member['role'] ?? 'member';
        if (role !== 'owner' && role !== 'steward' && role !== 'member') throw invalid(`Unknown role in ${key}.`);
        await client.query(
          `insert into community_members (community_id, person_id, role, joined_at) values ($1, $2, $3, $4)
           on conflict (community_id, person_id) do nothing`,
          [id, lookup(people, member['person'], 'community member'), role, now]
        );
      }
      communities.set(key, id);
    }

    for (const item of asArray(body['sessions'], 'sessions')) {
      const session = asRecord(item, 'session');
      const key = text(session['key'], 'session key');
      const roomId = lookup(rooms, session['room'], 'session room');
      const hostId = lookup(people, session['host'], 'session host');
      const visibility = session['visibility'] ?? 'public';
      if (!isVisibility(visibility)) throw invalid(`Unknown visibility in ${key}.`);
      const capacity = session['capacity'] ?? 10;
      if (!Number.isInteger(capacity) || (capacity as number) < 1 || (capacity as number) > config.sessionCapacityMax) {
        throw invalid(`Capacity in ${key} is out of range.`);
      }
      const communityId =
        session['community'] === undefined || session['community'] === null
          ? null
          : lookup(communities, session['community'], 'session community');
      const current = await client.query<{ version: number; layout: unknown }>(
        `select version, layout from asset_versions where asset_id = $1 and status = 'published'
          order by version desc limit 1`,
        [roomId]
      );
      const version = current.rows[0];
      if (version === undefined) throw invalid(`Room for ${key} has no published version.`);
      const layout = parseLayout(version.layout);
      if (layout === null) throw invalid(`Room layout for ${key} is not valid.`);
      const id = randomUUID();
      await client.query(
        `insert into sessions (id, world_id, room_asset_id, host_id, visibility, capacity, community_id, status, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'open', $8)`,
        [id, worldId, roomId, hostId, visibility, capacity, communityId, now]
      );
      for (const inviteeItem of asArray(session['invitees'], 'session invitees')) {
        await client.query('insert into session_invitees (session_id, person_id) values ($1, $2)', [
          id,
          lookup(people, inviteeItem, 'session invitee')
        ]);
      }
      const placements = asArray(session['placements'], 'session placements').map((entry) =>
        asRecord(entry, 'placement')
      );
      const entries: Array<{ personId: string; x: number; y: number; facing: string }> = [];
      if (placements.length === 0) {
        const spawn = layout.spawn[0];
        if (spawn === undefined) throw invalid(`Room for ${key} has no spawn tile.`);
        entries.push({ personId: hostId, x: spawn.x, y: spawn.y, facing: 'south' });
      } else {
        for (const placement of placements) {
          const personId = lookup(people, placement['person'], 'placement person');
          const x = placement['x'];
          const y = placement['y'];
          if (!Number.isInteger(x) || !Number.isInteger(y)) throw invalid(`Placement in ${key} needs x and y.`);
          const facing = placement['facing'] ?? 'south';
          if (!isFacing(facing)) throw invalid(`Placement facing in ${key} is not valid.`);
          entries.push({ personId, x: x as number, y: y as number, facing });
        }
      }
      let order = 0;
      for (const entry of entries) {
        await client.query(
          `insert into session_members (session_id, person_id, joined_at, room_version, x, y, facing)
           values ($1, $2, $3, $4, $5, $6, $7)`,
          [id, entry.personId, new Date(now.getTime() + order), version.version, entry.x, entry.y, entry.facing]
        );
        order += 1;
      }
      sessions.set(key, id);
    }

    for (const item of asArray(body['reports'], 'reports')) {
      const report = asRecord(item, 'report');
      const key = text(report['key'], 'report key');
      const state = report['state'] ?? 'open';
      if (state !== 'open' && state !== 'reviewing' && state !== 'upheld' && state !== 'dismissed') {
        throw invalid(`Unknown report state in ${key}.`);
      }
      const category = report['category'] ?? 'other';
      if (typeof category !== 'string') throw invalid(`Unknown category in ${key}.`);
      const id = randomUUID();
      await client.query(
        `insert into reports (id, world_id, filer_id, person_id, session_id, category, details, state, action, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          worldId,
          lookup(people, report['filer'], 'report filer'),
          lookup(people, report['person'], 'report person'),
          lookup(sessions, report['session'], 'report session'),
          category,
          text(report['details'], 'report details'),
          state,
          report['action'] ?? null,
          now
        ]
      );
      reports.set(key, id);
    }

    for (const item of asArray(body['gatherings'], 'gatherings')) {
      const gathering = asRecord(item, 'gathering');
      const key = text(gathering['key'], 'gathering key');
      const communityId = lookup(communities, gathering['community'], 'gathering community');
      const startsLocal = text(gathering['startsLocal'], 'gathering startsLocal');
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(startsLocal)) throw invalid(`Start in ${key} is not valid.`);
      const duration = gathering['durationMinutes'] ?? 60;
      if (!Number.isInteger(duration) || (duration as number) < 15 || (duration as number) > 480) {
        throw invalid(`Duration in ${key} is out of range.`);
      }
      const recurrence = gathering['recurrence'] ?? 'none';
      if (!isRecurrence(recurrence)) throw invalid(`Recurrence in ${key} is not valid.`);
      const limit = gathering['limit'] ?? 20;
      if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 500) {
        throw invalid(`Limit in ${key} is out of range.`);
      }
      const id = randomUUID();
      await client.query(
        `insert into gatherings (id, community_id, title, starts_local, duration_minutes, recurrence, attend_limit, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, communityId, text(gathering['title'], 'gathering title'), startsLocal, duration, recurrence, limit, now]
      );
      for (const attendee of asArray(gathering['attending'], 'gathering attending')) {
        await client.query('insert into gathering_attendees (gathering_id, person_id) values ($1, $2)', [
          id,
          lookup(people, attendee, 'gathering attendee')
        ]);
      }
      gatherings.set(key, id);
    }
  });

  const asObject = (map: Map<string, string>): Record<string, string> => Object.fromEntries(map);
  sendJson(ctx.res, 201, {
    worldId,
    people: asObject(people),
    communities: asObject(communities),
    avatars: asObject(avatars),
    rooms: asObject(rooms),
    sessions: asObject(sessions),
    reports: asObject(reports),
    gatherings: asObject(gatherings)
  });
});

route('POST', '/api/grading/clock', 'open', async (ctx) => {
  requireGradingKey(ctx.req.headers['x-grading-key']);
  const body = await readJsonBody(ctx);
  const worldId = typeof body['worldId'] === 'string' ? body['worldId'] : '';
  if (!(await worldExists(worldId))) throw notFound();
  const given = body['now'];
  if (given === null) {
    await setHeldClock(worldId, null);
  } else {
    if (typeof given !== 'string') throw invalid('Give a valid time.');
    const instant = new Date(given);
    if (Number.isNaN(instant.getTime())) throw invalid('Give a valid time.');
    await setHeldClock(worldId, instant);
  }
  await runDueWork(worldId);
  const now = await worldNow(worldId);
  sendJson(ctx.res, 200, { worldId, now: now.toISOString() });
});

route('POST', '/api/grading/outage', 'open', async (ctx) => {
  requireGradingKey(ctx.req.headers['x-grading-key']);
  const body = await readJsonBody(ctx);
  const service = body['service'];
  const down = body['down'];
  if ((service !== 'valkey' && service !== 'minio') || typeof down !== 'boolean') {
    throw invalid('Choose valkey or minio.');
  }
  setForcedDown(service, down);
  sendJson(ctx.res, 200, { service, down });
});
