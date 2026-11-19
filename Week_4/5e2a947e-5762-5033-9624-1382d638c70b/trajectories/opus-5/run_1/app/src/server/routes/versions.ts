import { copy } from '../../shared/copy.js';
import { diffSnapshots } from '../../shared/diff.js';
import { ApiError } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';
import { hiddenSet } from '../../shared/tree.js';
import type { VersionSnapshot } from '../../shared/types.js';
import { requireActor } from '../auth.js';
import { db } from '../db.js';
import { readJson, route } from '../http.js';
import { loadMap, requireRole } from '../mapstore.js';
import { StorageError } from '../storage.js';
import { listVersions, readSnapshot, restoreVersion, saveVersion } from '../versions.js';

function filterSnapshot(snapshot: VersionSnapshot, canSeeRestricted: boolean): VersionSnapshot {
  if (canSeeRestricted) return snapshot;
  const doc = {
    root: snapshot.topics.find((t) => t.parent_id === null && !t.floating)?.id ?? '',
    topics: Object.fromEntries(snapshot.topics.map((t) => [t.id, t])),
    floating: snapshot.topics.filter((t) => t.floating).map((t) => t.id),
    links: snapshot.links,
    boundaries: snapshot.boundaries,
    slides: snapshot.slides,
    layout: snapshot.layout,
    theme: snapshot.theme,
    custom_colours: [],
    title_edits: {},
    tombstones: {},
    last_touch: {},
  };
  const hidden = hiddenSet(doc, false);
  return {
    ...snapshot,
    topics: snapshot.topics
      .filter((topic) => !hidden.has(topic.id))
      .map((topic) => ({ ...topic, children: topic.children.filter((id) => !hidden.has(id)) })),
    links: snapshot.links.filter((link) => !hidden.has(link.from) && !hidden.has(link.to)),
    boundaries: snapshot.boundaries.filter((boundary) => !hidden.has(boundary.topic_id)),
    slides: snapshot.slides.filter((id) => !hidden.has(id)),
  };
}

route('GET', '/api/maps/:id/versions', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map } = await requireRole(db, ctx.params.id, actor);
  return { status: 200, json: { versions: await listVersions(map.id) } };
});

route('POST', '/api/maps/:id/versions', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  if (!can(role, 'edit')) throw new ApiError('forbidden', copy.readOnly);
  const body = readJson(ctx);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 1 || name.length > 60) {
    throw new ApiError('invalid', 'A version name is 1 to 60 characters.');
  }
  try {
    const version = await saveVersion(map, actor.name, 'named', name);
    return { status: 201, json: { version } };
  } catch (error) {
    if (error instanceof StorageError) {
      throw new ApiError('storage_unavailable', copy.versionOutage);
    }
    throw error;
  }
});

route('GET', '/api/maps/:id/versions/diff', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  const from = ctx.query.get('from') ?? '';
  const to = ctx.query.get('to') ?? '';
  const rows = await db.query<{ id: string; number: number }>(
    'select id, number from versions where map_id = $1 and id = any($2::text[])',
    [map.id, [from, to]],
  );
  if (rows.rows.length < 2) throw new ApiError('not_found', 'Those versions are gone.');
  const ordered = [...rows.rows].sort((a, b) => a.number - b.number);
  const canSee = can(role, 'see_restricted');
  const earlier = filterSnapshot(await readSnapshot(ordered[0].id, map.id), canSee);
  const later = filterSnapshot(await readSnapshot(ordered[1].id, map.id), canSee);
  return { status: 200, json: diffSnapshots(earlier, later) };
});

route('GET', '/api/maps/:id/versions/:vid', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  const row = await db.query<{ number: number; name: string; by_user: string; kind: string }>(
    'select number, name, by_user, kind from versions where id = $1 and map_id = $2',
    [ctx.params.vid, map.id],
  );
  const found = row.rows[0];
  if (!found) throw new ApiError('not_found', 'That version is gone.');
  const snapshot = filterSnapshot(
    await readSnapshot(ctx.params.vid, map.id),
    can(role, 'see_restricted'),
  );
  return {
    status: 200,
    json: {
      ...snapshot,
      snapshot,
      version_id: ctx.params.vid,
      number: found.number,
      name: found.name,
      kind: found.kind,
      by: found.by_user,
      map: { id: map.id, title: map.title, role, owner: map.owner },
      versions: await listVersions(map.id),
    },
  };
});

route('POST', '/api/maps/:id/versions/:vid/restore', async (ctx) => {
  const actor = await requireActor(ctx);
  const { role } = await requireRole(db, ctx.params.id, actor);
  if (!can(role, 'manage')) throw new ApiError('forbidden', 'Only the owner can restore a version.');
  const map = await loadMap(db, ctx.params.id);
  if (!map) throw new ApiError('not_found', copy.unknownMap);
  try {
    const result = await restoreVersion(ctx.params.id, actor, ctx.params.vid);
    return {
      status: 200,
      json: { ...(result.response as Record<string, unknown>), version: result.version },
    };
  } catch (error) {
    if (error instanceof StorageError) {
      throw new ApiError('storage_unavailable', copy.restoreOutage);
    }
    throw error;
  }
});
