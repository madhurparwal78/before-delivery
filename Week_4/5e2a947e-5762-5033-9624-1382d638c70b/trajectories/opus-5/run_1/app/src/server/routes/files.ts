import { randomUUID } from 'node:crypto';
import { copy } from '../../shared/copy.js';
import { ApiError } from '../../shared/errors.js';
import { countOutlineNodes, parseOutline, previewTree, type OutlineNode } from '../../shared/outline.js';
import { can } from '../../shared/permissions.js';
import type { AttachmentType, Operation } from '../../shared/types.js';
import { requireActor } from '../auth.js';
import { now, nowMs } from '../clock.js';
import { db } from '../db.js';
import { readJson, route } from '../http.js';
import { applyOperations, requireRole } from '../mapstore.js';
import { settings } from '../settings.js';
import {
  deleteObject,
  getObject,
  objectExists,
  putObject,
  sha256OfBytes,
  storageKeys,
  StorageError,
} from '../storage.js';
import { canExportMove } from '../../shared/states.js';
import { advanceExports, exportJson, type ExportRow } from '../exports.js';

function imageType(bytes: Buffer): AttachmentType | null {
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  return null;
}

route(
  'POST',
  '/api/maps/:id/topics/:topic/attachments',
  async (ctx) => {
    const actor = await requireActor(ctx);
    const { map, role } = await requireRole(db, ctx.params.id, actor);
    if (!map.doc.topics[ctx.params.topic]) throw new ApiError('not_found', copy.missingTopic);
    if (!can(role, 'edit')) throw new ApiError('forbidden', copy.readOnly);
    if (ctx.body.length > settings.attachMaxBytes) {
      throw new ApiError('too_large', copy.imageTooLarge(settings.attachMaxBytes));
    }
    const type = imageType(ctx.body);
    if (type === null) throw new ApiError('wrong_type', copy.imageWrongType);
    const digest = sha256OfBytes(ctx.body);
    const used = await db.query<{ total: string }>(
      `select coalesce(sum(bytes), 0)::text as total from (
         select distinct sha256, bytes from attachments where map_id = $1 and state = 'stored'
       ) distinct_bytes`,
      [map.id],
    );
    const already = await db.query<{ count: string }>(
      "select count(*)::text as count from attachments where map_id = $1 and sha256 = $2 and state = 'stored'",
      [map.id, digest],
    );
    const extra = Number(already.rows[0].count) > 0 ? 0 : ctx.body.length;
    if (Number(used.rows[0].total) + extra > settings.mapQuotaBytes) {
      throw new ApiError('quota_exceeded', copy.imageQuota(settings.mapQuotaBytes));
    }
    const id = randomUUID();
    await db.query(
      `insert into attachments (id, map_id, topic_id, sha256, bytes, type, state, created_at)
       values ($1, $2, $3, $4, $5, $6, 'pending', $7)`,
      [id, map.id, ctx.params.topic, digest, ctx.body.length, type, now()],
    );
    const key = storageKeys.attachment(map.id, digest, type);
    try {
      await putObject(key, ctx.body, type === 'png' ? 'image/png' : 'image/jpeg');
      if (!(await objectExists(key))) throw new StorageError('the image was not stored');
    } catch (error) {
      await db.query("update attachments set state = 'failed' where id = $1", [id]);
      if (error instanceof StorageError) {
        throw new ApiError('storage_unavailable', copy.storageOutage);
      }
      throw error;
    }
    await db.query("update attachments set state = 'stored' where id = $1", [id]);
    const topic = map.doc.topics[ctx.params.topic];
    topic.attachments = [
      ...topic.attachments,
      { id, sha256: digest, bytes: ctx.body.length, type },
    ];
    await db.query('update maps set doc = $2, updated_at = $3 where id = $1', [
      map.id,
      JSON.stringify(map.doc),
      now(),
    ]);
    return {
      status: 201,
      json: {
        attachment: { id, sha256: digest, bytes: ctx.body.length, type, state: 'stored' },
      },
    };
  },
  { maxBytes: () => settings.attachMaxBytes + 1 },
);

route('GET', '/api/attachments/:id', async (ctx) => {
  const actor = await requireActor(ctx);
  const row = await db.query<{ map_id: string; sha256: string; type: AttachmentType }>(
    "select map_id, sha256, type from attachments where id = $1 and state = 'stored'",
    [ctx.params.id],
  );
  const found = row.rows[0];
  if (!found) throw new ApiError('not_found', 'That attachment is gone.');
  await requireRole(db, found.map_id, actor);
  try {
    const bytes = await getObject(storageKeys.attachment(found.map_id, found.sha256, found.type));
    return {
      status: 200,
      body: bytes,
      contentType: found.type === 'png' ? 'image/png' : 'image/jpeg',
    };
  } catch {
    throw new ApiError('storage_unavailable', copy.storageOutage);
  }
});

route('DELETE', '/api/attachments/:id', async (ctx) => {
  const actor = await requireActor(ctx);
  const row = await db.query<{
    map_id: string;
    topic_id: string;
    sha256: string;
    type: AttachmentType;
  }>('select map_id, topic_id, sha256, type from attachments where id = $1', [ctx.params.id]);
  const found = row.rows[0];
  if (!found) throw new ApiError('not_found', 'That attachment is gone.');
  const { map, role } = await requireRole(db, found.map_id, actor);
  if (!can(role, 'edit')) throw new ApiError('forbidden', copy.readOnly);
  await db.query('delete from attachments where id = $1', [ctx.params.id]);
  const others = await db.query<{ count: string }>(
    'select count(*)::text as count from attachments where map_id = $1 and sha256 = $2',
    [found.map_id, found.sha256],
  );
  if (Number(others.rows[0].count) === 0) {
    await deleteObject(storageKeys.attachment(found.map_id, found.sha256, found.type)).catch(
      () => undefined,
    );
  }
  const topic = map.doc.topics[found.topic_id];
  if (topic) {
    topic.attachments = topic.attachments.filter((each) => each.id !== ctx.params.id);
    await db.query('update maps set doc = $2 where id = $1', [map.id, JSON.stringify(map.doc)]);
  }
  return { status: 204 };
});

route(
  'POST',
  '/api/maps/:id/imports',
  async (ctx) => {
    const actor = await requireActor(ctx);
    const { map, role } = await requireRole(db, ctx.params.id, actor);
    if (!can(role, 'edit')) throw new ApiError('forbidden', copy.readOnly);
    if (ctx.body.length > settings.outlineMaxBytes) {
      throw new ApiError('too_large', 'That outline file is larger than the limit.');
    }
    const digest = sha256OfBytes(ctx.body);
    try {
      const key = storageKeys.outlineImport(map.id, digest);
      await putObject(key, ctx.body, 'text/plain; charset=utf-8');
      if (!(await objectExists(key))) throw new StorageError('the file was not stored');
    } catch (error) {
      if (error instanceof StorageError) {
        throw new ApiError('storage_unavailable', copy.storageOutage);
      }
      throw error;
    }
    const parsed = parseOutline(ctx.body);
    if (parsed.errors.length > 0) {
      throw new ApiError('invalid_outline', copy.importErrorHeading, { lines: parsed.errors });
    }
    const id = randomUUID();
    await db.query(
      `insert into outline_imports (id, map_id, sha256, bytes, nodes, created_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [id, map.id, digest, ctx.body.length, JSON.stringify(parsed.nodes), now()],
    );
    return {
      status: 201,
      json: {
        import: {
          id,
          sha256: digest,
          bytes: ctx.body.length,
          topic_count: countOutlineNodes(parsed.nodes),
        },
        preview: previewTree(parsed.nodes),
      },
    };
  },
  { maxBytes: () => settings.outlineMaxBytes + 1 },
);

function outlineOps(
  nodes: OutlineNode[],
  parentId: string,
  lastChild: string | null,
  groupId: string,
): Operation[] {
  const ops: Operation[] = [];
  let counter = 0;
  const walk = (node: OutlineNode, parent: string, after: string | null): string => {
    counter += 1;
    const id = `t-${groupId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12)}-${counter}`.slice(0, 40);
    const stem = `${groupId.slice(0, 28)}-${counter}`;
    ops.push({
      op_id: `${stem}a`.slice(0, 40),
      kind: 'add',
      topic_id: id,
      parent_id: parent,
      after,
      title: node.title,
    });
    if (node.note !== '') {
      ops.push({ op_id: `${stem}n`.slice(0, 40), kind: 'note', topic_id: id, text: node.note });
    }
    if (node.task) {
      ops.push({ op_id: `${stem}t`.slice(0, 40), kind: 'task', topic_id: id, task: node.task });
    }
    if (node.colour !== null || node.icon !== null) {
      ops.push({
        op_id: `${stem}s`.slice(0, 40),
        kind: 'style',
        topic_id: id,
        colour: node.colour,
        icon: node.icon,
      });
    }
    let previous: string | null = null;
    for (const child of node.children) previous = walk(child, id, previous);
    return id;
  };
  let after = lastChild;
  for (const node of nodes) after = walk(node, parentId, after);
  return ops;
}

route('POST', '/api/maps/:id/imports/:iid/graft', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map, role } = await requireRole(db, ctx.params.id, actor);
  if (!can(role, 'edit')) throw new ApiError('forbidden', copy.readOnly);
  const body = readJson(ctx);
  const parentId = typeof body.parent_id === 'string' ? body.parent_id : '';
  if (!map.doc.topics[parentId]) throw new ApiError('not_found', copy.missingTopic);
  const row = await db.query<{ nodes: OutlineNode[] }>(
    'select nodes from outline_imports where id = $1 and map_id = $2',
    [ctx.params.iid, map.id],
  );
  const nodes = row.rows[0]?.nodes;
  if (!nodes) throw new ApiError('not_found', 'That upload is gone.');
  const groupId = typeof body.group_id === 'string' ? body.group_id : `graft-${randomUUID().slice(0, 20)}`;
  const children = map.doc.topics[parentId].children;
  const ops = outlineOps(
    nodes,
    parentId,
    children.length > 0 ? children[children.length - 1] : null,
    groupId,
  );
  const applied = await applyOperations(
    ctx.params.id,
    actor,
    {
      group_id: groupId,
      base_revision: typeof body.base_revision === 'number' ? body.base_revision : map.revision,
      ops,
    },
    { hint: 'graft' },
  );
  return { status: 200, json: applied.response };
});

route('POST', '/api/maps/:id/exports', async (ctx) => {
  const actor = await requireActor(ctx);
  const { map } = await requireRole(db, ctx.params.id, actor);
  const body = readJson(ctx);
  if (body.format !== 'sprig' && body.format !== 'svg') {
    throw new ApiError('invalid', 'An export is a Sprig outline or an SVG picture.');
  }
  const topicId = body.topic_id ?? null;
  if (topicId !== null && typeof topicId !== 'string') {
    throw new ApiError('invalid', 'A topic id names the branch to export.');
  }
  if (topicId !== null && !map.doc.topics[topicId]) {
    throw new ApiError('invalid', 'There is no such topic.');
  }
  const id = randomUUID();
  await db.query(
    `insert into export_jobs (id, map_id, actor, format, topic_id, state, progress, next_step_at, created_at)
     values ($1, $2, $3, $4, $5, 'queued', 0, $6, $7)`,
    [id, map.id, actor.key, body.format, topicId, new Date(nowMs() + settings.exportStepMs), now()],
  );
  return {
    status: 202,
    json: { export: { id, state: 'queued', progress: 0, format: body.format } },
  };
});

async function exportRow(id: string): Promise<ExportRow> {
  const row = await db.query<ExportRow>(
    'select id, map_id, actor, format, topic_id, state, progress from export_jobs where id = $1',
    [id],
  );
  const found = row.rows[0];
  if (!found) throw new ApiError('not_found', 'That export is gone.');
  return found;
}

route('GET', '/api/exports/:id', async (ctx) => {
  const actor = await requireActor(ctx);
  await advanceExports();
  const row = await exportRow(ctx.params.id);
  await requireRole(db, row.map_id, actor);
  return { status: 200, json: { export: exportJson(row, row.state === 'ready') } };
});

route('POST', '/api/exports/:id/retry', async (ctx) => {
  const actor = await requireActor(ctx);
  const row = await exportRow(ctx.params.id);
  await requireRole(db, row.map_id, actor);
  if (row.state !== 'failed' || !canExportMove(row.state, 'running')) {
    throw new ApiError('invalid_transition', 'Only a failed export can be retried.');
  }
  await db.query(
    "update export_jobs set state = 'running', progress = 80, next_step_at = $2 where id = $1",
    [row.id, new Date(nowMs() + settings.exportStepMs)],
  );
  return {
    status: 202,
    json: { export: { id: row.id, state: 'running', progress: 80, format: row.format, download_url: null } },
  };
});

route('GET', '/api/exports/:id/download', async (ctx) => {
  const actor = await requireActor(ctx);
  const row = await exportRow(ctx.params.id);
  const { map } = await requireRole(db, row.map_id, actor);
  if (row.state !== 'ready') throw new ApiError('not_ready', 'That export is not ready yet.');
  const key = storageKeys.exportObject(row.map_id, row.id, row.format);
  let bytes: Buffer;
  try {
    bytes = await getObject(key);
  } catch {
    throw new ApiError('storage_unavailable', copy.exportOutage);
  }
  const name = row.format === 'sprig' ? `${map.title}.sprig.txt` : `${map.title}.svg`;
  return {
    status: 200,
    body: bytes,
    contentType: row.format === 'sprig' ? 'text/plain; charset=utf-8' : 'image/svg+xml',
    headers: {
      'content-disposition': `attachment; filename="${name.replace(/"/g, '')}"`,
    },
  };
});
