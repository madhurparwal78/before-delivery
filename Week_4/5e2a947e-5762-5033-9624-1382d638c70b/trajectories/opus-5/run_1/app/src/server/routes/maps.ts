import { randomUUID } from 'node:crypto';
import { copy } from '../../shared/copy.js';
import { ApiError } from '../../shared/errors.js';
import { noteError } from '../../shared/notes.js';
import { can } from '../../shared/permissions.js';
import { ID_PATTERN } from '../../shared/ops.js';
import type { Operation, OperationGroup, Role } from '../../shared/types.js';
import { optionalActor, requireActor, requireUser } from '../auth.js';
import { now } from '../clock.js';
import { db } from '../db.js';
import { readJson, route } from '../http.js';
import {
  applyOperations,
  buildPayload,
  loadMap,
  refreshVisibility,
  requireRole,
  topicCount,
  undoOrRedo,
} from '../mapstore.js';
import { buildMapDoc, isTemplateKey } from '../templates.js';

route('GET', '/api/maps', async (ctx) => {
  const actor = await requireUser(ctx);
  const result = await db.query<{
    id: string;
    title: string;
    role: Role;
    updated_at: Date;
    revision: number;
    doc: { topics: Record<string, unknown> };
  }>(
    `select m.id, m.title, m.updated_at, m.revision, m.doc,
            case when m.owner_id = $1 then 'owner' else mb.role end as role
       from maps m
       left join members mb on mb.map_id = m.id and mb.username = $2
      where m.owner_id = $1 or mb.username = $2
      order by m.updated_at desc`,
    [actor.userId, actor.name],
  );
  return {
    status: 200,
    json: {
      maps: result.rows.map((row) => ({
        id: row.id,
        title: row.title,
        role: row.role,
        updated_at: row.updated_at.toISOString(),
        revision: row.revision,
        topic_count: Object.keys(row.doc.topics).length,
      })),
    },
  };
});

route('POST', '/api/maps', async (ctx) => {
  const actor = await requireUser(ctx);
  const body = readJson(ctx);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length < 1 || title.length > 200) {
    throw new ApiError('invalid', 'A central idea is 1 to 200 characters.', {
      fields: { title: 'A central idea is 1 to 200 characters.' },
    });
  }
  const template = body.template ?? null;
  if (template !== null && !isTemplateKey(template)) {
    throw new ApiError('invalid', 'That template does not exist.');
  }
  const id = randomUUID();
  const doc = buildMapDoc(title, template);
  await db.query(
    `insert into maps (id, title, owner_id, doc, revision, created_at, updated_at)
     values ($1, $2, $3, $4, 1, $5, $5)`,
    [id, title, actor.userId, JSON.stringify(doc), now()],
  );
  await db.query(
    'insert into version_baselines (map_id, baseline, last_revision) values ($1, $2, 1)',
    [id, now()],
  );
  return {
    status: 201,
    json: {
      map: {
        id,
        title,
        role: 'owner',
        revision: 1,
        updated_at: now().toISOString(),
        topic_count: topicCount(doc),
      },
    },
  };
});

route('GET', '/api/maps/:id', async (ctx) => {
  const actor = await optionalActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  refreshVisibility(map);
  const payload = await buildPayload(db, map, role, actor as NonNullable<typeof actor>);
  return { status: 200, json: payload };
});

route('DELETE', '/api/maps/:id', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  if (!can(role, 'manage')) throw new ApiError('forbidden', 'Only the owner can delete this map.');
  await db.query('delete from maps where id = $1', [map.id]);
  return { status: 204 };
});

route('PUT', '/api/maps/:id/collapse', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map } = await requireRole(db, ctx.params.id, actor);
  const body = readJson(ctx);
  const topicId = typeof body.topic_id === 'string' ? body.topic_id : '';
  if (!map.doc.topics[topicId]) throw new ApiError('not_found', copy.missingTopic);
  if (body.collapsed === true) {
    await db.query(
      `insert into collapse_state (map_id, actor, topic_id) values ($1, $2, $3)
       on conflict do nothing`,
      [map.id, actor.key, topicId],
    );
  } else {
    await db.query(
      'delete from collapse_state where map_id = $1 and actor = $2 and topic_id = $3',
      [map.id, actor.key, topicId],
    );
  }
  return { status: 204 };
});

route('GET', '/api/maps/:id/activity', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map } = await requireRole(db, ctx.params.id, actor);
  const person = ctx.query.get('person');
  const rows = await db.query<{
    seq: string;
    actor_name: string;
    sentence: string;
    topic_id: string | null;
    at: Date;
  }>(
    `select seq, actor_name, sentence, topic_id, at from op_groups
      where map_id = $1 and sentence <> ''
        and ($2::text is null or actor_name = $2)
      order by seq desc`,
    [map.id, person && person !== 'Everyone' ? person : null],
  );
  return {
    status: 200,
    json: {
      entries: rows.rows.map((row) => ({
        seq: Number(row.seq),
        user: row.actor_name,
        sentence: row.sentence,
        topic_id: row.topic_id,
        at: row.at.toISOString(),
      })),
    },
  };
});

function readGroup(body: Record<string, unknown>): OperationGroup {
  const groupId = body.group_id;
  if (typeof groupId !== 'string' || !ID_PATTERN.test(groupId)) {
    throw new ApiError('invalid', 'A group id is 1 to 40 letters, digits, hyphens or underscores.');
  }
  if (typeof body.base_revision !== 'number' || !Number.isInteger(body.base_revision)) {
    throw new ApiError('invalid', 'A group carries the base revision it was made against.');
  }
  if (!Array.isArray(body.ops)) throw new ApiError('invalid', 'A group carries its operations.');
  const ops = body.ops as Operation[];
  for (const op of ops) {
    if (op.kind === 'note' && typeof op.text === 'string') {
      const bad = noteError(op.text);
      if (bad) throw new ApiError('invalid', bad);
    }
  }
  return { group_id: groupId, base_revision: body.base_revision, ops };
}

route('POST', '/api/maps/:id/ops', async (ctx) => {
  const actor = await requireActor(ctx);
  await requireRole(db, ctx.params.id, actor);
  const group = readGroup(readJson(ctx));
  const applied = await applyOperations(ctx.params.id, actor, group);
  return { status: 200, json: applied.response };
});

route('POST', '/api/maps/:id/undo', async (ctx) => {
  const actor = await requireActor(ctx);
  await requireRole(db, ctx.params.id, actor);
  return { status: 200, json: await undoOrRedo(ctx.params.id, actor, 'undo') };
});

route('POST', '/api/maps/:id/redo', async (ctx) => {
  const actor = await requireActor(ctx);
  await requireRole(db, ctx.params.id, actor);
  return { status: 200, json: await undoOrRedo(ctx.params.id, actor, 'redo') };
});

route('POST', '/api/maps/:id/recovered/:entry/reapply', async (ctx) => {
  const actor = await requireActor(ctx);
  const { role } = await requireRole(db, ctx.params.id, actor);
  if (!can(role, 'edit')) throw new ApiError('forbidden', copy.readOnly);
  const result = await db.query<{
    entry: { text: string; kind: 'title' | 'note' | 'add'; from_title: string; parent_id: string | null };
  }>('select entry from recovered_edits where id = $1 and map_id = $2 and actor = $3', [
    ctx.params.entry,
    ctx.params.id,
    actor.key,
  ]);
  const entry = result.rows[0]?.entry;
  if (!entry) throw new ApiError('not_found', 'That recovered edit is gone.');
  const map = await loadMap(db, ctx.params.id);
  if (!map) throw new ApiError('not_found', copy.unknownMap);
  const parentId =
    entry.parent_id !== null && map.doc.topics[entry.parent_id] ? entry.parent_id : map.doc.root;
  const groupId = `reapply-${randomUUID().slice(0, 20)}`;
  const topicId = `t-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const ops: Operation[] = [
    {
      op_id: `${groupId}-1`.slice(0, 40),
      kind: 'add',
      topic_id: topicId,
      parent_id: parentId,
      after: lastChildOf(map.doc.topics[parentId].children),
      title: entry.kind === 'note' ? 'Recovered note' : entry.text,
    },
  ];
  if (entry.kind === 'note') {
    ops.push({
      op_id: `${groupId}-2`.slice(0, 40),
      kind: 'note',
      topic_id: topicId,
      text: entry.text,
    });
  }
  const applied = await applyOperations(
    ctx.params.id,
    actor,
    { group_id: groupId, base_revision: map.revision, ops },
    { hint: 'reapply' },
  );
  await db.query('delete from recovered_edits where id = $1', [ctx.params.entry]);
  return { status: 200, json: applied.response };
});

function lastChildOf(children: string[]): string | null {
  return children.length > 0 ? children[children.length - 1] : null;
}

route('DELETE', '/api/maps/:id/recovered/:entry', async (ctx) => {
  const actor = await requireActor(ctx);
  await requireRole(db, ctx.params.id, actor);
  await db.query('delete from recovered_edits where id = $1 and map_id = $2 and actor = $3', [
    ctx.params.entry,
    ctx.params.id,
    actor.key,
  ]);
  return { status: 204 };
});

route('POST', '/api/clipboard', async (ctx) => {
  const actor = await requireActor(ctx);
  const body = readJson(ctx);
  const mapId = typeof body.map_id === 'string' ? body.map_id : '';
  const topicIds = Array.isArray(body.topic_ids) ? (body.topic_ids as string[]) : [];
  const { map, role } = await requireRole(db, mapId, actor);
  const hidden = !can(role, 'see_restricted');
  const branches = topicIds.filter((id) => map.doc.topics[id]);
  if (branches.length !== topicIds.length) throw new ApiError('not_found', copy.missingTopic);
  const payload = branches.map((id) => cloneBranch(map, id, hidden));
  const total = payload.reduce((sum, node) => sum + countNodes(node), 0);
  await db.query(
    `insert into clipboards (actor, payload, updated_at) values ($1, $2, $3)
     on conflict (actor) do update set payload = $2, updated_at = $3`,
    [actor.key, JSON.stringify({ map_id: mapId, nodes: payload }), now()],
  );
  return { status: 200, json: { topics: total } };
});

export interface ClipboardNode {
  title: string;
  note: string;
  icon: string | null;
  colour: string | null;
  shape: string | null;
  task: unknown;
  attachments: unknown[];
  source_id: string;
  children: ClipboardNode[];
}

function cloneBranch(
  map: Awaited<ReturnType<typeof loadMap>>,
  id: string,
  hideRestricted: boolean,
): ClipboardNode {
  const doc = (map as NonNullable<typeof map>).doc;
  const topic = doc.topics[id];
  return {
    title: topic.title,
    note: topic.note,
    icon: topic.icon,
    colour: topic.colour,
    shape: topic.shape,
    task: topic.task,
    attachments: topic.attachments,
    source_id: topic.id,
    children: topic.children
      .filter((child) => !(hideRestricted && doc.topics[child]?.restricted))
      .map((child) => cloneBranch(map, child, hideRestricted)),
  };
}

function countNodes(node: ClipboardNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

export function graftOps(
  nodes: ClipboardNode[],
  parentId: string,
  lastChild: string | null,
  groupId: string,
): { ops: Operation[]; count: number } {
  const ops: Operation[] = [];
  let counter = 0;
  const idFor = (): string => {
    counter += 1;
    return `t-${groupId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 14)}-${counter}`.slice(0, 40);
  };
  const walk = (node: ClipboardNode, parent: string, after: string | null): string => {
    const id = idFor();
    ops.push({
      op_id: `${groupId.slice(0, 30)}-a${counter}`.slice(0, 40),
      kind: 'add',
      topic_id: id,
      parent_id: parent,
      after,
      title: node.title,
    });
    if (node.note !== '') {
      ops.push({
        op_id: `${groupId.slice(0, 30)}-n${counter}`.slice(0, 40),
        kind: 'note',
        topic_id: id,
        text: node.note,
      });
    }
    if (node.task) {
      ops.push({
        op_id: `${groupId.slice(0, 30)}-t${counter}`.slice(0, 40),
        kind: 'task',
        topic_id: id,
        task: node.task as never,
      });
    }
    if (node.colour !== null || node.icon !== null) {
      ops.push({
        op_id: `${groupId.slice(0, 30)}-s${counter}`.slice(0, 40),
        kind: 'style',
        topic_id: id,
        colour: node.colour,
        icon: node.icon,
      });
    }
    let previous: string | null = null;
    for (const child of node.children) {
      previous = walk(child, id, previous);
    }
    return id;
  };
  let after = lastChild;
  for (const node of nodes) {
    after = walk(node, parentId, after);
  }
  return { ops, count: counter };
}

route('POST', '/api/maps/:id/paste', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  if (!can(role, 'edit')) throw new ApiError('forbidden', copy.readOnly);
  const body = readJson(ctx);
  const parentId = typeof body.parent_id === 'string' ? body.parent_id : '';
  if (!map.doc.topics[parentId]) throw new ApiError('not_found', copy.missingTopic);
  const stored = await db.query<{ payload: { map_id: string; nodes: ClipboardNode[] } }>(
    'select payload from clipboards where actor = $1',
    [actor.key],
  );
  const nodes = stored.rows[0]?.payload.nodes ?? [];
  if (nodes.length === 0) throw new ApiError('clipboard_empty', copy.nothingToPaste);
  const groupId = typeof body.group_id === 'string' ? body.group_id : `paste-${randomUUID().slice(0, 20)}`;
  const children = map.doc.topics[parentId].children;
  const built = graftOps(nodes, parentId, children.length > 0 ? children[children.length - 1] : null, groupId);
  const applied = await applyOperations(
    ctx.params.id,
    actor,
    {
      group_id: groupId,
      base_revision: typeof body.base_revision === 'number' ? body.base_revision : map.revision,
      ops: built.ops,
    },
    { hint: 'paste' },
  );
  await copyAttachments(nodes, map.id);
  return { status: 200, json: applied.response };
});

async function copyAttachments(nodes: ClipboardNode[], mapId: string): Promise<void> {
  const walk = async (node: ClipboardNode): Promise<void> => {
    for (const attachment of node.attachments as { id: string }[]) {
      const row = await db.query<{ sha256: string; bytes: number; type: string }>(
        'select sha256, bytes, type from attachments where id = $1',
        [attachment.id],
      );
      const found = row.rows[0];
      if (found) {
        await db.query(
          `insert into attachments (id, map_id, topic_id, sha256, bytes, type, state, created_at)
           values ($1, $2, $3, $4, $5, $6, 'stored', $7) on conflict do nothing`,
          [randomUUID(), mapId, node.source_id, found.sha256, found.bytes, found.type, now()],
        );
      }
    }
    for (const child of node.children) await walk(child);
  };
  for (const node of nodes) await walk(node);
}
