// Grading routes: setup creates one world from one JSON body, clock holds a
// world's clock and runs everything due, outage makes only this instance treat
// a service as unreachable.
import { Router } from 'express';
import { config, opaqueId, sha256Hex } from './config';
import { invalid, notFound } from './errors';
import { query } from './db';
import { holdClock, releaseClock, setOutage, worldClock } from './world';
import { parseLayout } from '../shared/grid';
import { buildGlbForRank } from './glbgen';
import { s3 } from './providers';
import { flushOutbox } from './mail';
import { checkAndMeasure, type Rank } from '../shared/glb';
import { dueDrops, completeDrop } from './live';
import { closeDueVote } from './sessions';
import { runDueReminders } from './reminders';

const router = Router();

function json(res: { status: (n: number) => { json: (b: unknown) => void } }, status: number, body: unknown): void {
  res.status(status).json(body);
}

router.use((req, _res, next) => {
  if (!config.gradingKey || req.headers['x-grading-key'] !== config.gradingKey) {
    throw notFound();
  }
  next();
});

interface SetupPerson {
  key: string;
  email: string;
  password: string;
  displayName: string;
  timeZone: string;
  siteRole?: string;
  avatar?: string;
}

router.post('/setup', async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const worldId = opaqueId();
  await query('INSERT INTO worlds (id) VALUES ($1)', [worldId]);
  const people: Record<string, string> = {};
  const communities: Record<string, string> = {};
  const avatars: Record<string, string> = {};
  const rooms: Record<string, string> = {};
  const sessions: Record<string, string> = {};
  const reports: Record<string, string> = {};
  const gatherings: Record<string, string> = {};

  const personList = (body.people ?? []) as SetupPerson[];
  for (const p of personList) {
    const id = opaqueId();
    people[p.key] = id;
    try {
      await query(
        `INSERT INTO people (id, world_id, email, password_hash, display_name, time_zone, site_role, confirmed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true)`,
        [id, worldId, p.email, sha256Hex(p.password), p.displayName, p.timeZone, p.siteRole ?? 'member']
      );
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === '23505') throw invalid(`Give a unique email address for ${p.key}.`);
      throw e;
    }
  }

  const communityList = (body.communities ?? []) as {
    key: string;
    name: string;
    timeZone: string;
    members?: { person: string; role: string }[];
  }[];
  for (const c of communityList) {
    const id = opaqueId();
    communities[c.key] = id;
    await query('INSERT INTO communities (id, world_id, name, time_zone) VALUES ($1,$2,$3,$4)', [id, worldId, c.name, c.timeZone]);
    for (const m of c.members ?? []) {
      await query('INSERT INTO community_members (community_id, person_id, role) VALUES ($1,$2,$3)', [id, people[m.person], m.role]);
    }
  }

  // Avatars and rooms: a published version 1 whose generated GLB's measures
  // give the named rank, stored in MinIO at the published key.
  const storeAsset = async (kind: 'room' | 'avatar', key: string, name: string, ownerKey: string, rank: Rank | string, layout: unknown, versions?: { rank: Rank | string; layout: unknown; published?: boolean }[]): Promise<string> => {
    void key;
    const id = opaqueId();
    await query('INSERT INTO assets (id, world_id, kind, name, owner_id, current_version) VALUES ($1,$2,$3,$4,$5,NULL)', [id, worldId, kind, name, people[ownerKey]]);
    let currentVersion: number | null = null;
    const specs = versions ?? [{ rank, layout, published: true }];
    for (const [i, spec] of specs.entries()) {
      const version = i + 1;
      const glb = buildGlbForRank(kind, spec.rank as Rank);
      await s3.put(`assets/${id}/v${version}.glb`, glb);
      const checked = checkAndMeasure(kind, glb);
      const parsedLayout = kind === 'room' ? parseLayout(spec.layout) : null;
      if (kind === 'room' && !parsedLayout) throw invalid('This room layout is not valid.');
      await query(
        "INSERT INTO versions (asset_id, version, status, rank, worst_measure, measures, layout) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [id, version, spec.published === false ? 'checked' : 'published', checked.rank, checked.worstMeasure, JSON.stringify(checked.measures), kind === 'room' ? JSON.stringify(spec.layout) : null]
      );
      if (spec.published !== false) currentVersion = version;
    }
    await query('UPDATE assets SET current_version = $1 WHERE id = $2', [currentVersion, id]);
    return id;
  };

  for (const a of (body.avatars ?? []) as { key: string; name: string; owner: string; rank: string; versions?: unknown[] }[]) {
    avatars[a.key] = await storeAsset('avatar', a.key, a.name, a.owner, a.rank, null, a.versions as never);
  }
  for (const r of (body.rooms ?? []) as { key: string; name: string; owner: string; rank: string; layout: unknown; versions?: unknown[] }[]) {
    rooms[r.key] = await storeAsset('room', r.key, r.name, r.owner, r.rank, r.layout, r.versions as never);
  }

  for (const p of personList) {
    if (p.avatar && avatars[p.avatar]) {
      await query('UPDATE people SET avatar_id = $1 WHERE id = $2', [avatars[p.avatar], people[p.key]]);
    }
  }

  for (const [a, b] of (body.friendships ?? []) as [string, string][]) {
    await query('INSERT INTO friendships (person_id, friend_id) VALUES ($1,$2),($2,$1) ON CONFLICT DO NOTHING', [people[a], people[b]]);
  }
  for (const b of (body.blocks ?? []) as { from: string; to: string }[]) {
    await query('INSERT INTO blocks (person_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [people[b.from], people[b.to]]);
  }
  for (const m of (body.mutes ?? []) as { from: string; to: string }[]) {
    await query('INSERT INTO mutes (person_id, muted_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [people[m.from], people[m.to]]);
  }

  for (const s of (body.sessions ?? []) as {
    key: string;
    room: string;
    host: string;
    visibility: string;
    capacity: number;
    community: string | null;
    invitees: string[];
    placements: { person: string; x: number; y: number; facing: string }[];
  }[]) {
    const id = opaqueId();
    sessions[s.key] = id;
    const roomAsset = await query<{ current_version: number | null }>('SELECT current_version FROM assets WHERE id = $1', [rooms[s.room]]);
    if (!roomAsset.length || roomAsset[0].current_version === null) throw invalid('A session needs a room with a published version.');
    await query(
      'INSERT INTO sessions_table (id, world_id, room_id, host_id, visibility, capacity, community_id, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, worldId, rooms[s.room], people[s.host], s.visibility, s.capacity, s.community ? communities[s.community] : null, 'open']
    );
    const { valkey } = await import('./providers');
    const hostPerson = await query<{ display_name: string; avatar_id: string | null }>('SELECT display_name, avatar_id FROM people WHERE id = $1', [people[s.host]]);
    const place = async (personKey: string, x: number, y: number, facing: string): Promise<void> => {
      const pid = people[personKey];
      const p = await query<{ display_name: string; avatar_id: string | null }>('SELECT display_name, avatar_id FROM people WHERE id = $1', [pid]);
      await valkey.hset(`session:${id}:positions`, pid, JSON.stringify({
        x, y, facing, seated: false, name: p[0]?.display_name, avatarId: p[0]?.avatar_id ?? undefined, joinedAt: Date.now() + 1, worldId,
      }));
      await query(
        'INSERT INTO session_members (session_id, person_id, room_version, joined_at) VALUES ($1,$2,$3,now()) ON CONFLICT (session_id, person_id) DO UPDATE SET left_at = NULL',
        [id, pid, roomAsset[0].current_version]
      );
    };
    if (!s.placements || s.placements.length === 0) {
      const layoutRows = await query<{ layout: unknown }>('SELECT layout FROM versions WHERE asset_id = $1 AND version = $2', [rooms[s.room], roomAsset[0].current_version]);
      const layout = parseLayout(layoutRows[0]?.layout);
      if (!layout) throw invalid('This room layout is not valid.');
      await place(s.host, layout.spawn[0].x, layout.spawn[0].y, 'south');
    } else {
      for (const p of s.placements) {
        await place(p.person, p.x, p.y, p.facing);
      }
    }
    for (const i of s.invitees ?? []) {
      await query('INSERT INTO invitations (session_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, people[i]]);
    }
    void hostPerson;
  }

  for (const r of (body.reports ?? []) as { key: string; filer: string; person: string; session: string; category: string; details: string; state: string }[]) {
    const id = opaqueId();
    reports[r.key] = id;
    await query(
      'INSERT INTO reports (id, world_id, person_id, session_id, category, details, state) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, worldId, people[r.person], sessions[r.session], r.category, r.details, r.state]
    );
  }

  for (const g of (body.gatherings ?? []) as { key: string; community: string; title: string; startsLocal: string; durationMinutes: number; recurrence: string; limit: number; attending: string[] }[]) {
    const id = opaqueId();
    gatherings[g.key] = id;
    await query(
      'INSERT INTO gatherings (id, community_id, title, starts_local, duration_minutes, recurrence, limit_count) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, communities[g.community], g.title, g.startsLocal, g.durationMinutes, g.recurrence, g.limit]
    );
    for (const a of g.attending ?? []) {
      await query('INSERT INTO gathering_attendees (gathering_id, person_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, people[a]]);
    }
  }

  json(res, 201, { worldId, people, communities, avatars, rooms, sessions, reports, gatherings });
});

router.post('/clock', async (req, res) => {
  const body = req.body as { worldId?: unknown; now?: unknown };
  if (typeof body.worldId !== 'string') throw notFound();
  const exists = await query('SELECT 1 FROM worlds WHERE id = $1', [body.worldId]);
  if (!exists.length) throw notFound();
  if (body.now === null) {
    await releaseClock(body.worldId);
  } else {
    if (typeof body.now !== 'string' || Number.isNaN(Date.parse(body.now))) throw invalid('Give a valid time.');
    await holdClock(body.worldId, new Date(body.now));
  }
  // Run everything that has become due before answering.
  const now = await worldClock(body.worldId);
  await runDue(body.worldId, now);
  json(res, 200, { worldId: body.worldId, now: now.toISOString() });
});

export async function runDue(worldId: string, now: Date): Promise<void> {
  for (const d of dueDrops(worldId, now.getTime())) {
    await completeDrop(d.sessionId, d.personId, worldId).catch(() => {});
  }
  const votes = await query<{ id: string; session_id: string; target_id: string; starter_id: string; status: string; eligible: unknown; needed: number; yes: number; no: number; closes_at: Date }>(
    "SELECT * FROM votes WHERE status = 'open'"
  );
  for (const v of votes) {
    if (new Date(v.closes_at).getTime() <= now.getTime()) {
      await closeDueVote({ ...v, eligible: [] } as never).catch(() => {});
    }
  }
  await runDueReminders(worldId, now).catch(() => {});
  await flushOutbox(worldId).catch(() => {});
}

router.post('/outage', async (req, res) => {
  const body = req.body as { service?: unknown; down?: unknown };
  if (body.service !== 'valkey' && body.service !== 'minio') throw invalid('Choose valkey or minio.');
  const down = body.down === true;
  setOutage(body.service, down);
  json(res, 200, { service: body.service, down });
});

export { router as gradingRoutes };
