import { randomBytes, randomUUID } from 'node:crypto';
import { pool, withTransaction } from '../db.js';
import { fieldError } from '../errors.js';
import { asString } from '../input.js';
import type { Ctx, Reply } from '../http.js';
import { requireEditor, requireMembership, requireUser } from '../access.js';
import { textInLength } from '../domain/validate.js';
import { insertLayer } from '../domain/layers.js';
import { readSetDocument } from '../domain/document.js';
import { commitOp, readEnvelope, readOps } from '../domain/ops.js';
import { keepAlive, openStream, subscribe, writeEvent } from '../events.js';
import type { SetSummary } from '../../shared/types.js';

export async function listSets(ctx: Ctx): Promise<Reply> {
  const user = await requireUser(ctx);
  const result = await pool.query<SetSummary>(
    `select s.id, s.name, m.role, s.bpm, s.head, s.live_number
       from sets s join set_members m on m.set_id = s.id
      where m.user_id = $1
      order by s.created_at desc`,
    [user.id],
  );
  return { status: 200, json: { sets: result.rows } };
}

export async function createSet(ctx: Ctx): Promise<Reply> {
  const user = await requireUser(ctx);
  const name = textInLength('name', ctx.json['name'], 1, 80, 'Set name');
  const starter = asString(ctx.json['starter']);
  if (starter !== 'blank-stage') throw fieldError('starter', 'Choose the Blank stage starter');

  const setId = randomUUID();
  await withTransaction(async (client) => {
    const stageId = randomUUID();
    const cameraId = randomUUID();
    const lightId = randomUUID();
    const floorId = randomUUID();
    await client.query(
      `insert into sets (id, name, bpm, owner_id, head, settings_version, graph_version, active_camera_id, show_token)
       values ($1, $2, 120, $3, 0, 1, 1, $4, $5)`,
      [setId, name, user.id, cameraId, randomBytes(18).toString('base64url')],
    );
    await client.query(
      `insert into set_members (set_id, user_id, role, join_order) values ($1, $2, 'owner', 0)`,
      [setId, user.id],
    );
    await insertLayer(client, { id: stageId, setId, parentId: null, index: 0, name: 'Stage', kind: 'group' });
    await insertLayer(client, {
      id: cameraId,
      setId,
      parentId: stageId,
      index: 0,
      name: 'Main camera',
      kind: 'camera',
      position: [0, 2, 8],
    });
    await insertLayer(client, {
      id: lightId,
      setId,
      parentId: stageId,
      index: 1,
      name: 'Key light',
      kind: 'light',
      position: [4, 6, 4],
    });
    await insertLayer(client, {
      id: floorId,
      setId,
      parentId: stageId,
      index: 2,
      name: 'Floor',
      kind: 'plane',
      scale: [10, 1, 10],
    });
    await client.query(
      `insert into graph_nodes (set_id, node_id, type, params, x, y) values ($1, $2, 'Beat clock', '{}', 40, 40)`,
      [setId, randomUUID()],
    );
  });

  const document = await readSetDocument(pool, setId, 'owner');
  return { status: 201, json: document };
}

export async function getSet(ctx: Ctx): Promise<Reply> {
  const membership = await requireMembership(ctx, ctx.params['id'] ?? '');
  const document = await readSetDocument(pool, membership.setId, membership.role);
  return { status: 200, json: document };
}

export async function postOp(ctx: Ctx): Promise<Reply> {
  const membership = requireEditor(await requireMembership(ctx, ctx.params['id'] ?? ''));
  const envelope = readEnvelope(ctx.json);
  const result = await commitOp(membership, envelope);
  return { status: 200, json: result };
}

export async function getOps(ctx: Ctx): Promise<Reply> {
  const membership = await requireMembership(ctx, ctx.params['id'] ?? '');
  const afterText = ctx.query.get('after');
  const after = afterText === null ? 0 : Number(afterText);
  if (!Number.isInteger(after) || after < 0) throw fieldError('after', 'after must be a sequence number');
  const limitText = ctx.query.get('limit');
  const limit = limitText === null ? 500 : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw fieldError('limit', 'limit must be an integer from 1 to 500');
  }
  const ops = await readOps(membership.setId, after, limit);
  const head = await pool.query<{ head: number }>(`select head from sets where id = $1`, [membership.setId]);
  return { status: 200, json: { ops, head: head.rows[0]?.head ?? 0 } };
}

export async function streamSetEvents(ctx: Ctx): Promise<void> {
  const membership = await requireMembership(ctx, ctx.params['id'] ?? '');
  const lastEventId = ctx.req.headers['last-event-id'];
  const afterText = ctx.query.get('after') ?? (typeof lastEventId === 'string' ? lastEventId : null);
  const after = afterText === null || !Number.isInteger(Number(afterText)) ? 0 : Number(afterText);

  openStream(ctx.res);
  const backlog = await readOps(membership.setId, after, 500);
  for (const op of backlog) writeEvent(ctx.res, { event: 'op', id: op.seq, data: op });

  const unsubscribe = subscribe(membership.setId, (event) => writeEvent(ctx.res, event));
  const timer = keepAlive(ctx.res);
  ctx.req.on('close', () => {
    clearInterval(timer);
    unsubscribe();
  });
}
