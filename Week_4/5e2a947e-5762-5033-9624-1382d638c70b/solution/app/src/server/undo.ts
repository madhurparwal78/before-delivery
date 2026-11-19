import type pg from 'pg';
import type { MapDoc, Op, Role } from '../shared/model.ts';
import { COPY, noticeRedoSkipped, noticeUndoSkipped } from '../shared/rules.ts';
import { query, withMapLock } from './db.ts';
import { Effects, commitGroup, type Origin } from './groups.ts';
import type { Principal } from './http.ts';
import { operationId, randomId } from './ids.ts';
import { loadMap, type MapRow } from './mapStore.ts';
import { roleHolders } from './members.ts';

interface UndoResponse {
  status: 'undone' | 'redone' | 'skipped' | 'empty';
  revision: number;
  focus_topic_id: string | null;
  notice: string;
}

interface UndoEntry {
  group_id: string;
  revision: number;
  inverse: Op[];
  touched: string[];
  focus: string | null;
}

const WATCHED = new Set(['title', 'note', 'task', 'move', 'delete']);

/** The first person who changed one of the topics after the entry's group, or null. */
async function laterChange(client: pg.PoolClient, map: MapRow, entry: UndoEntry, personId: string): Promise<{ author: string; topic: string } | null> {
  const rows = await query<{ author: string; ops: Op[]; removed: { id: string }[] }>(
    client,
    'SELECT author, ops, removed FROM ops_log WHERE map_id = $1 AND revision > $2 AND author_id <> $3 ORDER BY revision',
    [map.id, entry.revision, personId],
  );
  const mine = new Set(entry.touched);
  for (const row of rows) {
    for (const op of row.ops) {
      if (WATCHED.has(op.kind) && 'topic_id' in op && mine.has(op.topic_id)) return { author: row.author, topic: op.topic_id };
    }
    const gone = row.removed.find((t) => mine.has(t.id));
    if (gone) return { author: row.author, topic: gone.id };
  }
  return null;
}

const titleOf = (doc: MapDoc, id: string): string => doc.topics[id]?.title ?? '';

/** Undo or redo the person's latest own group, skipping it when someone else has changed its topics since. */
export async function stepHistory(
  mapId: string,
  principal: Principal,
  role: Role,
  direction: 'undo' | 'redo',
): Promise<UndoResponse> {
  const fx = new Effects();
  const response = await withMapLock(mapId, async (client): Promise<UndoResponse> => {
    const map = (await loadMap(client, mapId, true)) as MapRow;
    const rows = await query<{ id: string; entry: UndoEntry }>(
      client,
      'SELECT id, entry FROM undo_stack WHERE map_id = $1 AND user_id = $2 AND kind = $3 ORDER BY id DESC LIMIT 1',
      [mapId, principal.id, direction],
    );
    const top = rows[0];
    if (!top) {
      return { status: 'empty', revision: map.revision, focus_topic_id: null, notice: direction === 'undo' ? COPY.nothing_undo : COPY.nothing_redo };
    }
    await client.query('DELETE FROM undo_stack WHERE id = $1', [top.id]);
    const skip = (author: string, topic: string): UndoResponse => ({
      status: 'skipped',
      revision: map.revision,
      focus_topic_id: null,
      notice: (direction === 'undo' ? noticeUndoSkipped : noticeRedoSkipped)(author, titleOf(map.doc, topic)),
    });
    const later = await laterChange(client, map, top.entry, principal.id);
    if (later) return skip(later.author, later.topic);
    const ops = top.entry.inverse.map((op) => ({ ...op, op_id: operationId() }));
    const origin: Origin = direction;
    const committed = await commitGroup({
      client,
      map,
      principal,
      role,
      groupId: `${direction}-${randomId(14)}`,
      base: map.revision,
      ops,
      origin,
      fx,
      roleHolders: await roleHolders(client, map),
    });
    const status = committed.response.status;
    if (status !== 'applied' && status !== 'merged') {
      const topic = top.entry.touched[0] ?? '';
      return skip('someone', topic);
    }
    return {
      status: direction === 'undo' ? 'undone' : 'redone',
      revision: committed.response.revision,
      focus_topic_id: committed.resolution.focus ?? top.entry.focus,
      notice: direction === 'undo' ? COPY.undone : COPY.redone,
    };
  });
  fx.run();
  return response;
}

