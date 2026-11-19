import { ApiError } from '../../shared/errors.ts';
import type { Op, OpsResponse, PublicOp, RecoveredEntry } from '../../shared/model.ts';
import { LIMITS, OP_CAPABILITY, can, isClientId } from '../../shared/rules.ts';
import { childrenOf } from '../../shared/tree.ts';
import { opProblem } from '../../shared/validate.ts';
import { noteOperations, requirePrincipal } from '../auth.ts';
import { config } from '../config.ts';
import { database, query, withMapLock } from '../db.ts';
import { Effects, commitGroup, emitEvent } from '../groups.ts';
import { bodyObject, empty, json, route, type Ctx, type RouteSpec } from '../http.ts';
import { operationId, randomId } from '../ids.ts';
import { loadMap, type MapRow } from '../mapStore.ts';
import { roleHolders } from '../members.ts';
import { stepHistory } from '../undo.ts';
import { resolveMap, scopeOf } from './maps.ts';

/** The stored answer to a group that was already seen: by group id, or by its operation ids. */
export async function storedResponse(db: Parameters<typeof query>[0], mapId: string, groupId: string, opIds: string[]): Promise<OpsResponse | null> {
  const byGroup = await query<{ response: OpsResponse }>(db, 'SELECT response FROM op_groups WHERE map_id = $1 AND group_id = $2', [mapId, groupId]);
  if (byGroup[0]) return byGroup[0].response;
  if (opIds.length === 0) return null;
  const seen = await query<{ op_id: string; group_id: string }>(db, 'SELECT op_id, group_id FROM op_ids WHERE map_id = $1 AND op_id = ANY($2)', [mapId, opIds]);
  const groups = new Set(seen.map((s) => s.group_id));
  if (seen.length !== new Set(opIds).size || groups.size !== 1) return null;
  const again = await query<{ response: OpsResponse }>(db, 'SELECT response FROM op_groups WHERE map_id = $1 AND group_id = $2', [mapId, [...groups][0]]);
  return again[0]?.response ?? null;
}

interface GroupBody {
  group_id: string;
  base_revision: number;
  ops: PublicOp[];
}

const groupBody = (ctx: Ctx): GroupBody => {
  const body = ctx.body;
  if (typeof body !== 'object' || body === null) return { group_id: '', base_revision: 0, ops: [] };
  const record = body as Record<string, unknown>;
  return {
    group_id: typeof record.group_id === 'string' ? record.group_id : '',
    base_revision: typeof record.base_revision === 'number' ? record.base_revision : 0,
    ops: Array.isArray(record.ops) ? (record.ops as PublicOp[]) : [],
  };
};

/** The 409 checks a group meets: an operation id already used, and a base revision too far behind. */
async function assertFreshGroup(db: Parameters<typeof query>[0], map: { id: string; revision: number }, body: GroupBody): Promise<void> {
  const ids = [...new Set(opIdsOf(body.ops))];
  if (ids.length > 0) {
    const seen = await query<{ op_id: string }>(db, 'SELECT op_id FROM op_ids WHERE map_id = $1 AND op_id = ANY($2)', [map.id, ids]);
    if (seen.length > 0) throw new ApiError('op_id_reused', 'An operation in this group was already applied.');
  }
  if (map.revision - body.base_revision > config.opWindow) throw new ApiError('stale_base', 'That change was made against a revision that is too old.');
}

const opIdsOf = (ops: readonly unknown[]): string[] =>
  ops.flatMap((o) => (typeof o === 'object' && o !== null && typeof (o as { op_id?: unknown }).op_id === 'string' ? [(o as { op_id: string }).op_id] : []));

export const opsRoute: RouteSpec = {
  body: 'json',
  stages: {
    authenticate: async (ctx) => {
      if (!ctx.principal) await requirePrincipal(ctx);
    },
    rate: (ctx) => {
      const count = Math.max(1, groupBody(ctx).ops.length);
      noteOperations(ctx.principal?.id ?? '', count);
    },
    resolve: resolveMap,
    replay: async (ctx) => {
      const { group_id, ops } = groupBody(ctx);
      const stored = await storedResponse(database(), ctx.params.id ?? '', group_id, opIdsOf(ops));
      if (stored) ctx.scope.replay = stored;
    },
    authorize: (ctx) => {
      if (ctx.scope.replay) return;
      const { role } = scopeOf(ctx);
      if (!can(role, 'edit')) throw new ApiError('forbidden', 'You can view this map but not edit it.');
      for (const op of groupBody(ctx).ops as unknown[]) {
        const kind = typeof op === 'object' && op !== null ? (op as { kind?: unknown }).kind : undefined;
        const capability = typeof kind === 'string' && Object.hasOwn(OP_CAPABILITY, kind) ? OP_CAPABILITY[kind as PublicOp['kind']] : undefined;
        if (capability && !can(role, capability)) throw new ApiError('forbidden', 'Your role cannot make that change.');
      }
    },
    state: async (ctx) => {
      if (ctx.scope.replay) return;
      try {
        await assertFreshGroup(database(), scopeOf(ctx).map, groupBody(ctx));
      } catch (error) {
        // A concurrent send of this same group may have committed since the replay stage looked: answer as its replay.
        if (!(error instanceof ApiError) || error.code !== 'op_id_reused') throw error;
        const { group_id, ops } = groupBody(ctx);
        const stored = await storedResponse(database(), ctx.params.id ?? '', group_id, opIdsOf(ops));
        if (!stored) throw error;
        ctx.scope.replay = stored;
      }
    },
    validate: (ctx) => {
      if (ctx.scope.replay) return;
      const body = bodyObject(ctx);
      if (!isClientId(body.group_id)) throw new ApiError('invalid', 'group_id must be 1 to 40 letters, digits, _ or -.');
      if (!Number.isInteger(body.base_revision) || (body.base_revision as number) < 0) throw new ApiError('invalid', 'base_revision must be a whole number.');
      const ops = body.ops;
      if (!Array.isArray(ops) || ops.length < 1 || ops.length > LIMITS.ops_per_group) throw new ApiError('invalid', 'A group holds 1 to 500 operations.');
      const seen = new Set<string>();
      for (const op of ops) {
        const problem = opProblem(op);
        if (problem) throw new ApiError('invalid', problem);
        const id = (op as PublicOp).op_id;
        if (seen.has(id)) throw new ApiError('invalid', 'op_id appears twice in the group.');
        seen.add(id);
      }
    },
  },
  handle: async (ctx) => {
    const replay = ctx.scope.replay as OpsResponse | undefined;
    if (replay) return json(200, { ...replay, replayed: true });
    const { map, role } = scopeOf(ctx);
    const { group_id, base_revision, ops } = groupBody(ctx);
    const principal = ctx.principal as NonNullable<Ctx['principal']>;
    const fx = new Effects();
    const response = await withMapLock(map.id, async (client) => {
      const again = await storedResponse(client, map.id, group_id, opIdsOf(ops));
      if (again) return { ...again, replayed: true };
      const fresh = (await loadMap(client, map.id, true)) as MapRow;
      await assertFreshGroup(client, fresh, { group_id, base_revision, ops });
      return (
        await commitGroup({
          client,
          map: fresh,
          principal,
          role,
          groupId: group_id,
          base: base_revision,
          ops: ops as Op[],
          origin: 'edit',
          fx,
          roleHolders: await roleHolders(client, fresh),
        })
      ).response;
    });
    fx.run();
    return json(200, response);
  },
};

route('POST', '/api/maps/:id/ops', opsRoute);

for (const direction of ['undo', 'redo'] as const) {
  route('POST', `/api/maps/:id/${direction}`, {
    stages: {
      authenticate: requirePrincipal,
      rate: (ctx) => noteOperations(ctx.principal?.id ?? '', 1),
      resolve: resolveMap,
      authorize: (ctx) => {
        if (!can(scopeOf(ctx).role, 'edit')) throw new ApiError('forbidden', 'You can view this map but not edit it.');
      },
    },
    handle: async (ctx) => {
      const { map, role } = scopeOf(ctx);
      return json(200, await stepHistory(map.id, ctx.principal as NonNullable<Ctx['principal']>, role, direction));
    },
  });
}

interface RecoveredRow extends RecoveredEntry {
  chain: string[];
}

const recoveredFor = async (ctx: Ctx): Promise<RecoveredRow> => {
  const rows = await query<RecoveredRow>(
    database(),
    'SELECT id, text, kind, from_title, parent_id, chain FROM recovered WHERE id = $1 AND map_id = $2 AND user_id = $3',
    [ctx.params.eid, ctx.params.id, ctx.principal?.id],
  );
  const row = rows[0];
  if (!row) throw new ApiError('not_found', 'That recovered edit no longer exists.');
  return row;
};

route('POST', '/api/maps/:id/recovered/:eid/reapply', {
  stages: {
    authenticate: requirePrincipal,
    resolve: async (ctx) => {
      await resolveMap(ctx);
      ctx.scope.entry = await recoveredFor(ctx);
    },
    authorize: (ctx) => {
      if (!can(scopeOf(ctx).role, 'edit')) throw new ApiError('forbidden', 'You can view this map but not edit it.');
    },
  },
  handle: async (ctx) => {
    const { map, role } = scopeOf(ctx);
    const entry = ctx.scope.entry as RecoveredRow;
    const principal = ctx.principal as NonNullable<Ctx['principal']>;
    const fx = new Effects();
    const response = await withMapLock(map.id, async (client) => {
      const fresh = (await loadMap(client, map.id, true)) as MapRow;
      const parentId = [entry.parent_id, ...entry.chain].find((id) => id !== null && fresh.doc.topics[id]) ?? Object.values(fresh.doc.topics).find((t) => t.parent_id === null && !t.floating)?.id ?? '';
      const last = childrenOf(fresh.doc.topics, parentId).at(-1)?.id ?? null;
      const topicId = `r${randomId(10)}`;
      const ops: Op[] = [{ op_id: operationId(), kind: 'add', topic_id: topicId, parent_id: parentId, after: last, title: entry.kind === 'note' ? 'Recovered note' : entry.text }];
      if (entry.kind === 'note') ops.push({ op_id: operationId(), kind: 'note', topic_id: topicId, text: entry.text });
      const parentTitle = fresh.doc.topics[parentId]?.title ?? '';
      const committed = await commitGroup({
        client,
        map: fresh,
        principal,
        role,
        groupId: `reapply-${randomId(14)}`,
        base: fresh.revision,
        ops,
        origin: 'reapply',
        sentence: `${principal.name} re-applied an edit under ${parentTitle}`,
        fx,
        roleHolders: await roleHolders(client, fresh),
      });
      await client.query('DELETE FROM recovered WHERE id = $1', [entry.id]);
      const remaining = await query<RecoveredEntry>(client, 'SELECT id, text, kind, from_title, parent_id FROM recovered WHERE map_id = $1 AND user_id = $2 ORDER BY created_at, id', [map.id, principal.id]);
      await emitEvent(client, map.id, { type: 'recovered', entries: remaining }, 'user', principal.id, fx);
      return committed.response;
    });
    fx.run();
    return json(200, response);
  },
});

route('DELETE', '/api/maps/:id/recovered/:eid', {
  stages: {
    authenticate: requirePrincipal,
    resolve: async (ctx) => {
      await resolveMap(ctx);
      await recoveredFor(ctx);
    },
  },
  handle: async (ctx) => {
    const fx = new Effects();
    await withMapLock(ctx.params.id ?? '', async (client) => {
      await client.query('DELETE FROM recovered WHERE id = $1', [ctx.params.eid]);
      const remaining = await query<RecoveredEntry>(client, 'SELECT id, text, kind, from_title, parent_id FROM recovered WHERE map_id = $1 AND user_id = $2 ORDER BY created_at, id', [ctx.params.id, ctx.principal?.id]);
      await emitEvent(client, ctx.params.id ?? '', { type: 'recovered', entries: remaining }, 'user', ctx.principal?.id ?? '', fx);
    });
    fx.run();
    return empty();
  },
});
