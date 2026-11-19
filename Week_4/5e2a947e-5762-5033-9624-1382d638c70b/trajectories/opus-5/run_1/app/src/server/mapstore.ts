import { randomUUID } from 'node:crypto';
import { apiTopicFrom, emptyCounts, type TopicCountsById } from '../shared/api.js';
import { copy } from '../shared/copy.js';
import { deriveAll } from '../shared/derive.js';
import { ApiError } from '../shared/errors.js';
import { can } from '../shared/permissions.js';
import {
  applyGroup,
  type GroupHint,
  type GroupOutcome,
  type OpEvent,
  type OpsContext,
} from '../shared/ops.js';
import {
  allTopicsDepthFirst,
  hiddenSet,
  lockInfo,
  permittedChildren,
  type MapView,
} from '../shared/tree.js';
import type {
  ApiTopic,
  MapDoc,
  MapPayload,
  Operation,
  OperationGroup,
  OpsResponse,
  RecoveredEntry,
  Role,
} from '../shared/types.js';
import type { Actor } from './auth.js';
import { checkOpRate } from './auth.js';
import { now, serverDate, isoNow } from './clock.js';
import { publish, setVisibilityFilter, connectionsFor } from './bus.js';
import { withTransaction, type Queryable } from './db.js';
import { settings } from './settings.js';

export interface MapRow {
  id: string;
  title: string;
  owner_id: string;
  owner: string;
  doc: MapDoc;
  revision: number;
  created_at: Date;
  updated_at: Date;
}

export async function loadMap(client: Queryable, id: string, lock = false): Promise<MapRow | null> {
  const result = await client.query<MapRow>(
    `select m.id, m.title, m.owner_id, u.username as owner, m.doc, m.revision,
            m.created_at, m.updated_at
       from maps m join users u on u.id = m.owner_id
      where m.id = $1${lock ? ' for update of m' : ''}`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function roleFor(client: Queryable, map: MapRow, actor: Actor | null): Promise<Role | null> {
  if (!actor) return null;
  if (actor.kind === 'user') {
    if (actor.userId === map.owner_id) return 'owner';
    const result = await client.query<{ role: Role }>(
      'select role from members where map_id = $1 and username = $2',
      [map.id, actor.name],
    );
    return result.rows[0]?.role ?? null;
  }
  if (actor.guestMapId === map.id) return actor.guestRole;
  return null;
}

/** A private map is 404 to anyone without a role. */
export async function requireRole(
  client: Queryable,
  mapId: string,
  actor: Actor | null,
): Promise<{ map: MapRow; role: Role }> {
  const map = await loadMap(client, mapId);
  if (!map) throw new ApiError('not_found', "We couldn't find that map.");
  const role = await roleFor(client, map, actor);
  if (role === null) throw new ApiError('not_found', "We couldn't find that map.");
  return { map, role };
}

export async function membersOf(client: Queryable, map: MapRow): Promise<Set<string>> {
  const result = await client.query<{ username: string }>(
    'select username from members where map_id = $1',
    [map.id],
  );
  return new Set([map.owner, ...result.rows.map((row) => row.username)]);
}

export async function collapsedFor(
  client: Queryable,
  mapId: string,
  actorKey: string,
): Promise<Set<string>> {
  const result = await client.query<{ topic_id: string }>(
    'select topic_id from collapse_state where map_id = $1 and actor = $2',
    [mapId, actorKey],
  );
  return new Set(result.rows.map((row) => row.topic_id));
}

export async function countsFor(
  client: Queryable,
  mapId: string,
  actorKey: string,
): Promise<TopicCountsById> {
  const counts = emptyCounts();
  const comments = await client.query<{ topic_id: string; total: string }>(
    `select c.topic_id, count(*)::text as total
       from comments c
      where c.map_id = $1
        and not exists (
          select 1 from comments t
           where t.id = coalesce(c.reply_to, c.id) and t.resolved
        )
      group by c.topic_id`,
    [mapId],
  );
  for (const row of comments.rows) counts.comments.set(row.topic_id, Number(row.total));
  const votes = await client.query<{ topic_id: string; total: string }>(
    'select topic_id, count(*)::text as total from votes where map_id = $1 group by topic_id',
    [mapId],
  );
  for (const row of votes.rows) counts.votes.set(row.topic_id, Number(row.total));
  const mine = await client.query<{ topic_id: string }>(
    'select topic_id from votes where map_id = $1 and actor = $2',
    [mapId, actorKey],
  );
  for (const row of mine.rows) counts.voted.add(row.topic_id);
  return counts;
}

export async function recoveredFor(
  client: Queryable,
  mapId: string,
  actorKey: string,
): Promise<RecoveredEntry[]> {
  const result = await client.query<{ id: string; entry: Omit<RecoveredEntry, 'id'> }>(
    'select id, entry from recovered_edits where map_id = $1 and actor = $2 order by created_at asc',
    [mapId, actorKey],
  );
  return result.rows.map((row) => ({ id: row.id, ...row.entry }));
}

export function viewFor(doc: MapDoc, role: Role, collapsed: Set<string>): MapView {
  return { doc, collapsed, hidden: hiddenSet(doc, can(role, 'see_restricted')) };
}

export function topicsPayload(view: MapView, counts: TopicCountsById): ApiTopic[] {
  const derived = deriveAll({ ...view, theme: view.doc.theme, today: serverDate() });
  const out: ApiTopic[] = [];
  const level1 = [view.doc.root, ...view.doc.floating].filter((id) => !view.hidden.has(id));
  const walk = (id: string, rank: number): void => {
    const stored = view.doc.topics[id];
    if (!stored) return;
    const lock = lockInfo(view.doc, id);
    const derivedTopic = derived.get(id);
    if (!derivedTopic) return;
    out.push(apiTopicFrom(stored, rank, lock.inherited, counts, derivedTopic));
    permittedChildren(view, id).forEach((child, index) => walk(child, index));
  };
  level1.forEach((id, index) => walk(id, index));
  return out;
}

export async function buildPayload(
  client: Queryable,
  map: MapRow,
  role: Role,
  actor: Actor,
): Promise<MapPayload> {
  const collapsed = await collapsedFor(client, map.id, actor.key);
  const counts = await countsFor(client, map.id, actor.key);
  const view = viewFor(map.doc, role, collapsed);
  const topics = topicsPayload(view, counts);
  const visible = new Set(topics.map((t) => t.id));
  return {
    map: {
      id: map.id,
      title: map.title,
      revision: map.revision,
      layout: map.doc.layout,
      theme: map.doc.theme,
      owner: map.owner,
      role,
      custom_colours: map.doc.custom_colours,
    },
    topics,
    links: map.doc.links.filter((link) => visible.has(link.from) && visible.has(link.to)),
    boundaries: map.doc.boundaries.filter((boundary) => visible.has(boundary.topic_id)),
    collapsed: [...collapsed].filter((id) => visible.has(id)),
    slides: map.doc.slides.filter((id) => visible.has(id)),
    recovered: await recoveredFor(client, map.id, actor.key),
    server_time: isoNow(),
    server_date: serverDate(),
    settings: {
      toast_ms: settings.toastMs,
      presence_timeout_ms: settings.presenceTimeoutMs,
      virtual_from: settings.virtualFrom,
      dom_margin_px: settings.domMarginPx,
      dom_ceiling: settings.domCeiling,
    },
  };
}

export function refreshVisibility(map: MapRow): void {
  setVisibilityFilter(map.id, { restricted: hiddenSet(map.doc, false) });
}

interface UndoEntry {
  group_id: string;
  ops: Operation[];
  touched: string[];
  revision: number;
  title: string;
}

async function readStack(
  client: Queryable,
  mapId: string,
  actorKey: string,
  kind: 'undo' | 'redo',
): Promise<UndoEntry[]> {
  const result = await client.query<{ entries: UndoEntry[] }>(
    'select entries from undo_stacks where map_id = $1 and actor = $2 and kind = $3',
    [mapId, actorKey, kind],
  );
  return result.rows[0]?.entries ?? [];
}

async function writeStack(
  client: Queryable,
  mapId: string,
  actorKey: string,
  kind: 'undo' | 'redo',
  entries: UndoEntry[],
): Promise<void> {
  const capped = entries.slice(-settings.undoDepth);
  await client.query(
    `insert into undo_stacks (map_id, actor, kind, entries) values ($1, $2, $3, $4)
     on conflict (map_id, actor, kind) do update set entries = $4`,
    [mapId, actorKey, kind, JSON.stringify(capped)],
  );
}

export interface ApplyOptions {
  hint?: GroupHint;
  versionNumber?: number;
  /** Set when the group is itself an undo or a redo, so the stacks are not disturbed. */
  stack?: 'undo' | 'redo' | null;
}

export interface AppliedGroup {
  response: OpsResponse;
  outcome: GroupOutcome | null;
  map: MapRow;
}

export async function applyOperations(
  mapId: string,
  actor: Actor,
  group: OperationGroup,
  options: ApplyOptions = {},
): Promise<AppliedGroup> {
  if (group.ops.length < 1 || group.ops.length > 500) {
    throw new ApiError('invalid', 'A group holds 1 to 500 operations.');
  }
  await checkOpRate(actor.key, group.ops.length);
  const result = await withTransaction(async (client) => {
    const { map, role } = await requireRole(client, mapId, actor);
    const locked = await loadMap(client, mapId, true);
    const live = locked ?? map;

    const ids = group.ops.map((op) => op.op_id);
    const seen = await client.query<{ op_id: string; group_id: string }>(
      'select op_id, group_id from op_ids where map_id = $1 and op_id = any($2::text[])',
      [mapId, ids],
    );
    if (seen.rows.length > 0) {
      if (seen.rows.length === ids.length) {
        const stored = await client.query<{ response: OpsResponse }>(
          'select response from op_groups where map_id = $1 and group_id = $2',
          [mapId, seen.rows[0].group_id],
        );
        const response = stored.rows[0]?.response;
        if (response) return { response: { ...response, replayed: true }, outcome: null, map: live };
      }
      throw new ApiError('op_id_reused', 'That group mixes seen and unseen operation ids.');
    }

    const members = await membersOf(client, live);
    const ctx: OpsContext = {
      user: actor.name,
      role,
      revision: live.revision,
      members,
      internal: options.hint === 'undo' || options.hint === 'redo' || options.hint === 'restore',
      hint: options.hint ?? null,
      versionNumber: options.versionNumber,
      opWindow: settings.opWindow,
    };
    const applied = applyGroup(live.doc, group, ctx);
    const outcome = applied.outcome;
    const response: OpsResponse = {
      group_id: group.group_id,
      status: outcome.status,
      revision: outcome.revision,
      replayed: false,
      results: outcome.results,
      notice: outcome.notice,
    };

    for (const entry of outcome.recovered) {
      await client.query(
        'insert into recovered_edits (id, map_id, actor, entry, created_at) values ($1, $2, $3, $4, $5)',
        [randomUUID(), mapId, actor.key, JSON.stringify(entry), now()],
      );
    }

    await client.query(
      `insert into op_groups (map_id, group_id, actor, actor_name, base_revision, revision, ops,
                              response, sentence, topic_id, events, touched, at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        mapId,
        group.group_id,
        actor.key,
        actor.name,
        group.base_revision,
        outcome.revision,
        JSON.stringify(group.ops),
        JSON.stringify(response),
        outcome.activitySentence,
        outcome.activityTopicId,
        JSON.stringify(outcome.events),
        JSON.stringify(outcome.touched),
        now(),
      ],
    );
    for (const id of ids) {
      await client.query(
        'insert into op_ids (map_id, op_id, group_id) values ($1, $2, $3) on conflict do nothing',
        [mapId, id, group.group_id],
      );
    }

    if (outcome.status === 'applied' || outcome.status === 'merged') {
      await client.query(
        'update maps set doc = $2, revision = $3, updated_at = $4 where id = $1',
        [mapId, JSON.stringify(applied.doc), outcome.revision, now()],
      );
      live.doc = applied.doc;
      live.revision = outcome.revision;
      if (outcome.inverse !== null) {
        if (options.stack === 'undo') {
          const redo = await readStack(client, mapId, actor.key, 'redo');
          redo.push({
            group_id: group.group_id,
            ops: outcome.inverse,
            touched: outcome.touched,
            revision: outcome.revision,
            title: outcome.events[0]?.title ?? '',
          });
          await writeStack(client, mapId, actor.key, 'redo', redo);
        } else if (options.stack === 'redo') {
          const undo = await readStack(client, mapId, actor.key, 'undo');
          undo.push({
            group_id: group.group_id,
            ops: outcome.inverse,
            touched: outcome.touched,
            revision: outcome.revision,
            title: outcome.events[0]?.title ?? '',
          });
          await writeStack(client, mapId, actor.key, 'undo', undo);
        } else {
          const undo = await readStack(client, mapId, actor.key, 'undo');
          undo.push({
            group_id: group.group_id,
            ops: outcome.inverse,
            touched: outcome.touched,
            revision: outcome.revision,
            title: outcome.events[0]?.title ?? '',
          });
          await writeStack(client, mapId, actor.key, 'undo', undo);
          await writeStack(client, mapId, actor.key, 'redo', []);
        }
      }
    }
    return { response, outcome, map: live };
  });

  if (result.outcome && (result.outcome.status === 'applied' || result.outcome.status === 'merged')) {
    refreshVisibility(result.map);
    await publish(result.map.id, {
      type: 'op',
      topics: result.outcome.touched,
      payload: {
        group_id: group.group_id,
        actor: actor.name,
        actor_key: actor.key,
        revision: result.outcome.revision,
        ops: result.outcome.effective,
        sentence: result.outcome.activitySentence,
        topic_id: result.outcome.activityTopicId,
        at: isoNow(),
      },
    });
    for (const notice of result.outcome.noticesToOthers) {
      await publishNoticeToName(result.map.id, notice.user, notice.text);
    }
  }
  return result;
}

export async function publishNoticeToName(
  mapId: string,
  actorName: string,
  text: string,
): Promise<void> {
  const target = connectionsFor(mapId).find((conn) => conn.actorName === actorName);
  await publish(mapId, {
    type: 'notice',
    recipient: target?.actorKey ?? actorName,
    payload: { text },
  });
}

export interface UndoResponse {
  status: 'undone' | 'skipped' | 'empty';
  revision: number;
  focus_topic_id: string | null;
  notice: string | null;
}

/** Undo or redo the acting person's own last group. */
export async function undoOrRedo(
  mapId: string,
  actor: Actor,
  direction: 'undo' | 'redo',
): Promise<UndoResponse> {
  const prepared = await withTransaction(async (client) => {
    const { map, role } = await requireRole(client, mapId, actor);
    if (!can(role, 'edit')) throw new ApiError('forbidden', 'You can view this map but not edit it.');
    const stack = await readStack(client, mapId, actor.key, direction);
    if (stack.length === 0) return { map, entry: null, skip: null as null | { user: string; title: string } };
    const entry = stack[stack.length - 1];
    const later = await client.query<{ actor_name: string; events: OpEvent[] }>(
      `select actor_name, events from op_groups
        where map_id = $1 and revision > $2 and actor <> $3 order by revision asc`,
      [mapId, entry.revision, actor.key],
    );
    const touched = new Set(entry.touched);
    for (const row of later.rows) {
      for (const event of row.events) {
        const blocking =
          event.kind === 'rename' ||
          event.kind === 'note' ||
          event.kind === 'task' ||
          event.kind === 'move' ||
          event.kind === 'reorder';
        if (blocking && touched.has(event.topic_id)) {
          stack.pop();
          await writeStack(client, mapId, actor.key, direction, stack);
          return {
            map,
            entry: null,
            skip: { user: row.actor_name, title: event.title ?? '' },
          };
        }
      }
    }
    stack.pop();
    await writeStack(client, mapId, actor.key, direction, stack);
    return { map, entry, skip: null };
  });

  if (prepared.skip) {
    return {
      status: 'skipped',
      revision: prepared.map.revision,
      focus_topic_id: null,
      notice:
        direction === 'undo'
          ? copy.undoSkipped(prepared.skip.user, prepared.skip.title)
          : copy.redoSkipped(prepared.skip.user, prepared.skip.title),
    };
  }
  if (!prepared.entry) {
    return {
      status: 'empty',
      revision: prepared.map.revision,
      focus_topic_id: null,
      notice: direction === 'undo' ? copy.nothingToUndo : copy.nothingToRedo,
    };
  }
  const groupId = `${direction}-${randomUUID().slice(0, 24)}`;
  const applied = await applyOperations(
    mapId,
    actor,
    {
      group_id: groupId,
      base_revision: prepared.map.revision,
      ops: prepared.entry.ops.map((op, index) => ({
        ...op,
        op_id: `${groupId.slice(0, 32)}-${index}`.slice(0, 40),
      })),
    },
    { hint: direction, stack: direction },
  );
  return {
    status: 'undone',
    revision: applied.response.revision,
    focus_topic_id: applied.outcome?.events[0]?.topic_id ?? null,
    notice: direction === 'undo' ? copy.undone : copy.redone,
  };
}

export function topicCount(doc: MapDoc): number {
  return allTopicsDepthFirst(doc).length;
}
