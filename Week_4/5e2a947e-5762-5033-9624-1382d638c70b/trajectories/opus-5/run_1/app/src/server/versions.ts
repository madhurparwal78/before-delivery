import { randomUUID } from 'node:crypto';
import { copy } from '../shared/copy.js';
import { ApiError } from '../shared/errors.js';
import { INTERNAL_KIND } from '../shared/ops.js';
import { allTopicsDepthFirst } from '../shared/tree.js';
import type { MapDoc, Operation, VersionRow, VersionSnapshot } from '../shared/types.js';
import type { Actor } from './auth.js';
import { publish } from './bus.js';
import { now } from './clock.js';
import { db, type Queryable } from './db.js';
import { applyOperations, loadMap, type MapRow } from './mapstore.js';
import { getObject, putObject, storageKeys, StorageError } from './storage.js';

export function snapshotOf(map: MapRow, version: number): VersionSnapshot {
  const doc = map.doc;
  return {
    format: 'sprigmap-version-1',
    map_id: map.id,
    version,
    revision: map.revision,
    layout: doc.layout,
    theme: doc.theme,
    topics: allTopicsDepthFirst(doc).map((id) => ({ ...doc.topics[id] })),
    links: doc.links.map((link) => ({ ...link })),
    boundaries: doc.boundaries.map((boundary) => ({ ...boundary })),
    slides: [...doc.slides],
  };
}

async function nextNumber(client: Queryable, mapId: string): Promise<number> {
  const result = await client.query<{ next: string }>(
    'select coalesce(max(number), 0)::text as next from versions where map_id = $1',
    [mapId],
  );
  return Number(result.rows[0].next) + 1;
}

export async function saveVersion(
  map: MapRow,
  byUser: string,
  kind: 'auto' | 'named' | 'restore',
  name: string,
): Promise<VersionRow> {
  const number = await nextNumber(db, map.id);
  const id = randomUUID();
  const snapshot = snapshotOf(map, number);
  await putObject(
    storageKeys.versionSnapshot(map.id, id),
    Buffer.from(JSON.stringify(snapshot), 'utf8'),
    'application/json; charset=utf-8',
  );
  const created = now();
  await db.query(
    `insert into versions (id, map_id, number, name, kind, by_user, revision, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, map.id, number, name, kind, byUser, map.revision, created],
  );
  await db.query(
    `insert into version_baselines (map_id, baseline, last_revision) values ($1, $2, $3)
     on conflict (map_id) do update set baseline = $2, last_revision = $3`,
    [map.id, created, map.revision],
  );
  const row: VersionRow = {
    id,
    number,
    name,
    kind,
    by: byUser,
    revision: map.revision,
    created_at: created.toISOString(),
  };
  await publish(map.id, { type: 'version', payload: { version: row } });
  return row;
}

export async function readSnapshot(versionId: string, mapId: string): Promise<VersionSnapshot> {
  const bytes = await getObject(storageKeys.versionSnapshot(mapId, versionId));
  return JSON.parse(bytes.toString('utf8')) as VersionSnapshot;
}

export async function listVersions(mapId: string): Promise<VersionRow[]> {
  const result = await db.query<{
    id: string;
    number: number;
    name: string;
    kind: 'auto' | 'named' | 'restore';
    by_user: string;
    revision: number;
    created_at: Date;
  }>(
    `select id, number, name, kind, by_user, revision, created_at
       from versions where map_id = $1 order by number asc`,
    [mapId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    number: row.number,
    name: row.name,
    kind: row.kind,
    by: row.by_user,
    revision: row.revision,
    created_at: row.created_at.toISOString(),
  }));
}

/** Builds the operations that make the live map equal to a snapshot. */
export function restoreOperations(doc: MapDoc, snapshot: VersionSnapshot, groupId: string): Operation[] {
  const ops: Operation[] = [];
  let counter = 0;
  const opId = (): string => {
    counter += 1;
    return `${groupId.slice(0, 30)}-${counter}`.slice(0, 40);
  };
  const wanted = new Map(snapshot.topics.map((topic) => [topic.id, topic] as const));
  const present = new Set(allTopicsDepthFirst(doc));

  for (const id of [...present]) {
    if (!wanted.has(id) && id !== doc.root) {
      const parent = doc.topics[id]?.parent_id;
      if (parent !== null && parent !== undefined && !present.has(parent)) continue;
      ops.push({ op_id: opId(), kind: 'delete', topic_id: id });
    }
  }

  for (const topic of snapshot.topics) {
    if (present.has(topic.id)) continue;
    const branch = {
      topics: [{ ...topic, children: [] }],
      links: [],
      boundaries: [],
      parent_id: topic.parent_id,
      index: 0,
      floating_index: topic.floating ? 0 : null,
    };
    ops.push({ op_id: opId(), kind: INTERNAL_KIND, branch });
  }

  for (const topic of snapshot.topics) {
    const live = doc.topics[topic.id];
    if (live) {
      if (live.title !== topic.title) {
        ops.push({
          op_id: opId(),
          kind: 'title',
          topic_id: topic.id,
          offset: 0,
          delete: [...live.title].length,
          insert: topic.title,
        });
      }
      if (live.note !== topic.note) {
        ops.push({ op_id: opId(), kind: 'note', topic_id: topic.id, text: topic.note });
      }
      if (JSON.stringify(live.task) !== JSON.stringify(topic.task)) {
        ops.push({ op_id: opId(), kind: 'task', topic_id: topic.id, task: topic.task });
      }
      if (
        live.colour !== topic.colour ||
        live.shape !== topic.shape ||
        live.icon !== topic.icon
      ) {
        ops.push({
          op_id: opId(),
          kind: 'style',
          topic_id: topic.id,
          colour: topic.colour,
          shape: topic.shape,
          icon: topic.icon,
        });
      }
      if (live.side_pin !== topic.side_pin) {
        ops.push({ op_id: opId(), kind: 'pin', topic_id: topic.id, side: topic.side_pin });
      }
    }
  }

  // Order children only under the parents whose order has changed.
  for (const parent of snapshot.topics) {
    const wantedChildren = parent.children.filter((id) => wanted.has(id));
    const liveChildren = (doc.topics[parent.id]?.children ?? []).filter((id) => wanted.has(id));
    if (JSON.stringify(wantedChildren) === JSON.stringify(liveChildren)) continue;
    let after: string | null = null;
    for (const child of wantedChildren) {
      ops.push({
        op_id: opId(),
        kind: 'move',
        topic_id: child,
        parent_id: parent.id,
        after,
      });
      after = child;
    }
  }
  for (const topic of snapshot.topics) {
    if (topic.parent_id === null || doc.topics[topic.id]?.parent_id === topic.parent_id) continue;
    ops.push({
      op_id: opId(),
      kind: 'move',
      topic_id: topic.id,
      parent_id: topic.parent_id,
      after: null,
    });
  }
  for (const topic of snapshot.topics) {
    if (!topic.floating) continue;
    ops.push({
      op_id: opId(),
      kind: 'float_move',
      topic_id: topic.id,
      x: topic.x ?? 0,
      y: topic.y ?? 0,
    });
  }

  for (const link of doc.links) {
    if (!snapshot.links.some((other) => other.id === link.id)) {
      ops.push({ op_id: opId(), kind: 'link_remove', link_id: link.id });
    }
  }
  for (const link of snapshot.links) {
    ops.push({
      op_id: opId(),
      kind: 'link_add',
      link_id: link.id,
      from: link.from,
      to: link.to,
      label: link.label,
      type: link.type,
    });
  }
  for (const boundary of doc.boundaries) {
    if (!snapshot.boundaries.some((other) => other.id === boundary.id)) {
      ops.push({ op_id: opId(), kind: 'boundary_remove', boundary_id: boundary.id });
    }
  }
  for (const boundary of snapshot.boundaries) {
    ops.push({
      op_id: opId(),
      kind: 'boundary_add',
      boundary_id: boundary.id,
      topic_id: boundary.topic_id,
      label: boundary.label,
    });
  }
  if (doc.layout !== snapshot.layout) {
    ops.push({ op_id: opId(), kind: 'layout', layout: snapshot.layout });
  }
  if (doc.theme !== snapshot.theme) {
    ops.push({ op_id: opId(), kind: 'theme', theme: snapshot.theme });
  }
  if (JSON.stringify(doc.slides) !== JSON.stringify(snapshot.slides)) {
    ops.push({ op_id: opId(), kind: 'slides', order: snapshot.slides });
  }
  return ops;
}

export async function restoreVersion(
  mapId: string,
  actor: Actor,
  versionId: string,
): Promise<{ response: unknown; version: VersionRow }> {
  const map = await loadMap(db, mapId);
  if (!map) throw new ApiError('not_found', copy.unknownMap);
  const versionRow = await db.query<{ number: number }>(
    'select number from versions where id = $1 and map_id = $2',
    [versionId, mapId],
  );
  const number = versionRow.rows[0]?.number;
  if (number === undefined) throw new ApiError('not_found', 'That version is gone.');
  let snapshot: VersionSnapshot;
  try {
    snapshot = await readSnapshot(versionId, mapId);
  } catch (error) {
    if (error instanceof StorageError) {
      throw new ApiError('storage_unavailable', copy.restoreOutage);
    }
    throw error;
  }
  const groupId = `restore-${randomUUID().slice(0, 20)}`;
  const ops = restoreOperations(map.doc, snapshot, groupId);
  const applied = await applyOperations(
    mapId,
    actor,
    {
      group_id: groupId,
      base_revision: map.revision,
      ops: ops.length > 0 ? ops : [{ op_id: `${groupId}-same`.slice(0, 40), kind: 'theme', theme: map.doc.theme }],
    },
    { hint: 'restore', versionNumber: number },
  );
  const fresh = await loadMap(db, mapId);
  const version = await saveVersion(
    fresh ?? map,
    actor.name,
    'restore',
    `Restored from version ${number}`,
  );
  return { response: applied.response, version };
}

export async function cutAutomaticVersion(map: MapRow): Promise<void> {
  const latest = await db.query<{ actor_name: string }>(
    'select actor_name from op_groups where map_id = $1 order by revision desc limit 1',
    [map.id],
  );
  const by = latest.rows[0]?.actor_name ?? map.owner;
  const number = await nextNumber(db, map.id);
  await saveVersion(map, by, 'auto', `Version ${number}`);
}
