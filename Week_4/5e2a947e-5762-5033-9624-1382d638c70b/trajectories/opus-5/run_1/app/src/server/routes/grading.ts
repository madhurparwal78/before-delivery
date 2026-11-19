import { randomBytes, randomUUID } from 'node:crypto';
import { ApiError } from '../../shared/errors.js';
import { newTopic } from '../../shared/ops.js';
import type {
  LayoutMode,
  MapDoc,
  Operation,
  Role,
  StoredTopic,
  Task,
  ThemeName,
} from '../../shared/types.js';
import {
  cookieHeader,
  createSession,
  hashPassword,
  SESSION_COOKIE,
} from '../auth.js';
import { isoNow, now } from '../clock.js';
import { advanceClock } from '../clock.js';
import { db } from '../db.js';
import { readJson, route } from '../http.js';
import { applyOperations, loadMap, refreshVisibility } from '../mapstore.js';
import { settings } from '../settings.js';
import { setStorageDown } from '../storage.js';
import { buildGeneratedDoc } from '../templates.js';
import { tick } from '../ticker.js';
import { saveVersion } from '../versions.js';
import { emptyDoc } from '../../shared/ops.js';

function requireGrading(): void {
  if (!settings.grading) throw new ApiError('not_found', 'There is no such endpoint.');
}

interface SeedTopic {
  id: string;
  title: string;
  note?: string;
  icon?: string | null;
  colour?: string | null;
  shape?: StoredTopic['shape'];
  side_pin?: 'left' | 'right' | null;
  task?: Partial<Task> | null;
  restricted?: boolean;
  locked_by?: string | null;
  children?: SeedTopic[];
  x?: number;
  y?: number;
}

interface SeedMap {
  key: string;
  owner: string;
  layout?: LayoutMode;
  theme?: ThemeName;
  root: SeedTopic;
  generate?: { topics: number; fanout: number } | null;
  floating?: SeedTopic[];
  links?: { id: string; from: string; to: string; label: string; type: 'related' | 'depends' }[];
  boundaries?: { id: string; topic_id: string; label: string }[];
  roles?: { username: string; role: Exclude<Role, 'owner'> }[];
  comments?: {
    id: string;
    topic_id: string;
    author: string;
    body: string;
    resolved?: boolean;
    replies?: { id: string; author: string; body: string }[];
  }[];
  votes?: { topic_id: string; username: string }[];
  share_links?: { role: Exclude<Role, 'owner'>; expires_in_ms?: number | null }[];
  versions?: { name: string; by: string }[];
  slides?: string[];
  presentation?: { state: 'waiting' } | null;
}

function fillTopic(doc: MapDoc, parentId: string | null, seed: SeedTopic, floating: boolean): void {
  const topic = newTopic(seed.id, parentId, seed.title);
  topic.note = seed.note ?? '';
  topic.icon = seed.icon ?? null;
  topic.colour = seed.colour ?? null;
  topic.shape = seed.shape ?? null;
  topic.side_pin = seed.side_pin ?? null;
  topic.restricted = seed.restricted ?? false;
  topic.locked_by = seed.locked_by ?? null;
  topic.floating = floating;
  if (floating) {
    topic.x = seed.x ?? 0;
    topic.y = seed.y ?? 0;
  }
  if (seed.task) {
    topic.task = {
      percent: seed.task.percent ?? 0,
      weight: seed.task.weight ?? 1,
      state: seed.task.state ?? 'open',
      priority: seed.task.priority ?? 'normal',
      due: seed.task.due ?? null,
      assignee: seed.task.assignee ?? null,
    };
  }
  doc.topics[seed.id] = topic;
  if (parentId !== null) doc.topics[parentId].children.push(seed.id);
  if (floating) doc.floating.push(seed.id);
  for (const child of seed.children ?? []) fillTopic(doc, seed.id, child, false);
}

route('POST', '/api/grading/seed', async (ctx) => {
  requireGrading();
  const body = readJson(ctx);
  const users = (body.users ?? []) as { username: string; password: string }[];
  const maps = (body.maps ?? []) as SeedMap[];
  const userIds: Record<string, string> = {};
  for (const user of users) {
    const existing = await db.query<{ id: string }>('select id from users where username = $1', [
      user.username,
    ]);
    if (existing.rows[0]) {
      userIds[user.username] = existing.rows[0].id;
      continue;
    }
    const id = randomUUID();
    await db.query(
      'insert into users (id, username, pw_hash, created_at) values ($1, $2, $3, $4)',
      [id, user.username, await hashPassword(user.password), now()],
    );
    userIds[user.username] = id;
  }

  const result: Record<string, unknown> = {};
  for (const seed of maps) {
    const ownerId = userIds[seed.owner];
    if (!ownerId) throw new ApiError('invalid', `The owner ${seed.owner} was not seeded.`);
    const doc = seed.generate
      ? buildGeneratedDoc(seed.generate.topics, seed.generate.fanout)
      : blankDocFor(seed);
    doc.layout = seed.layout ?? 'map';
    doc.theme = seed.theme ?? 'daylight';
    for (const floating of seed.floating ?? []) fillTopic(doc, null, floating, true);
    for (const link of seed.links ?? []) doc.links.push({ ...link });
    for (const boundary of seed.boundaries ?? []) doc.boundaries.push({ ...boundary });
    doc.slides = (seed.slides ?? []).filter((id) => doc.topics[id]);

    const mapId = randomUUID();
    const title = doc.topics[doc.root].title;
    await db.query(
      `insert into maps (id, title, owner_id, doc, revision, created_at, updated_at)
       values ($1, $2, $3, $4, 1, $5, $5)`,
      [mapId, title, ownerId, JSON.stringify(doc), now()],
    );
    await db.query(
      'insert into version_baselines (map_id, baseline, last_revision) values ($1, $2, 1)',
      [mapId, now()],
    );
    for (const member of seed.roles ?? []) {
      await db.query(
        `insert into members (map_id, username, role) values ($1, $2, $3)
         on conflict (map_id, username) do update set role = $3`,
        [mapId, member.username, member.role],
      );
    }
    for (const comment of seed.comments ?? []) {
      await db.query(
        `insert into comments (id, map_id, topic_id, author, body, resolved, reply_to, created_at)
         values ($1, $2, $3, $4, $5, $6, null, $7)`,
        [
          comment.id,
          mapId,
          comment.topic_id,
          comment.author,
          comment.body,
          comment.resolved ?? false,
          now(),
        ],
      );
      for (const reply of comment.replies ?? []) {
        await db.query(
          `insert into comments (id, map_id, topic_id, author, body, resolved, reply_to, created_at)
           values ($1, $2, $3, $4, $5, false, $6, $7)`,
          [reply.id, mapId, comment.topic_id, reply.author, reply.body, comment.id, now()],
        );
      }
    }
    for (const vote of seed.votes ?? []) {
      await db.query(
        'insert into votes (map_id, topic_id, actor) values ($1, $2, $3) on conflict do nothing',
        [mapId, vote.topic_id, vote.username],
      );
    }
    const links: Record<string, string> = {};
    for (const share of seed.share_links ?? []) {
      const code = randomBytes(9).toString('base64url');
      const expires =
        share.expires_in_ms === undefined || share.expires_in_ms === null
          ? null
          : new Date(now().getTime() + share.expires_in_ms);
      await db.query(
        `insert into share_links (id, map_id, code, role, expires_at, state, created_at)
         values ($1, $2, $3, $4, $5, 'active', $6)`,
        [randomUUID(), mapId, code, share.role, expires, now()],
      );
      links[share.role] = code;
    }
    const versionIds: string[] = [];
    const stored = await loadMap(db, mapId);
    for (const version of seed.versions ?? []) {
      if (!stored) break;
      const saved = await saveVersion(stored, version.by, 'named', version.name);
      versionIds.push(saved.id);
    }
    let presentation: { id: string; code: string } | null = null;
    if (seed.presentation) {
      const code = randomBytes(9).toString('base64url');
      const id = randomUUID();
      await db.query(
        `insert into presentations (id, map_id, code, state, slide_index, presenter, created_at)
         values ($1, $2, $3, 'waiting', 0, $4, $5)`,
        [id, mapId, code, seed.owner, now()],
      );
      presentation = { id, code };
    }
    if (stored) refreshVisibility(stored);
    result[seed.key] = { id: mapId, links, versions: versionIds, presentation };
  }
  return { status: 201, json: { users: userIds, maps: result } };
});

function blankDocFor(seed: SeedMap): MapDoc {
  const doc = emptyDoc(seed.root.id, seed.root.title);
  doc.topics[seed.root.id].note = seed.root.note ?? '';
  doc.topics[seed.root.id].restricted = seed.root.restricted ?? false;
  doc.topics[seed.root.id].locked_by = seed.root.locked_by ?? null;
  for (const child of seed.root.children ?? []) fillTopic(doc, seed.root.id, child, false);
  return doc;
}

route('POST', '/api/grading/session', async (ctx) => {
  requireGrading();
  const body = readJson(ctx);
  const username = typeof body.username === 'string' ? body.username : '';
  const row = await db.query<{ id: string; username: string }>(
    'select id, username from users where username = $1',
    [username],
  );
  const user = row.rows[0];
  if (!user) throw new ApiError('not_found', 'There is no such person.');
  const session = await createSession(user.id);
  ctx.setCookie(cookieHeader(SESSION_COOKIE, session.id, settings.sessionTtlMs));
  return { status: 200, json: { user: { id: user.id, username: user.username } } };
});

route('POST', '/api/grading/clock', async (ctx) => {
  requireGrading();
  const body = readJson(ctx);
  const advance = typeof body.advance_ms === 'number' ? body.advance_ms : 0;
  advanceClock(advance);
  await tick();
  return { status: 200, json: { server_time: isoNow() } };
});

route('POST', '/api/grading/maps/:id/ops', async (ctx) => {
  requireGrading();
  const body = readJson(ctx);
  const username = typeof body.as === 'string' ? body.as : '';
  const row = await db.query<{ id: string }>('select id from users where username = $1', [username]);
  const user = row.rows[0];
  if (!user) throw new ApiError('not_found', 'There is no such person.');
  const ctxActor = {
    key: username,
    name: username,
    kind: 'user' as const,
    userId: user.id,
    guestId: null,
    guestMapId: null,
    guestLinkId: null,
    guestRole: null,
  };
  const applied = await applyOperations(ctx.params.id, ctxActor, {
    group_id: String(body.group_id ?? ''),
    base_revision: Number(body.base_revision ?? 0),
    ops: (body.ops ?? []) as Operation[],
  });
  return { status: 200, json: applied.response };
});

route('POST', '/api/grading/storage', async (ctx) => {
  requireGrading();
  const body = readJson(ctx);
  const down = body.down === true;
  setStorageDown(down);
  return { status: 200, json: { storage: down ? 'down' : 'up' } };
});
