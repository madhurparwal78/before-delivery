import type pg from 'pg';
import type {
  BlockContent,
  HistoryRow,
  LayoutContent,
  LayoutEventType,
  ModuleContent,
} from '../../shared/protocol.js';
import { pool } from '../db/pool.js';
import {
  applyJointAdjacency,
  contentHash,
  countsOf,
  recomputeBlockLengths,
  sortContent,
} from '../domain/layout.js';
import { writeOutbox } from './outbox.js';
import { layoutStream } from './valkey.js';

export interface ConsumedEnd {
  label: string;
  piece_id: string;
  taken_by: string;
}

export interface TrashedModule {
  id: string;
  name: string;
  module: ModuleContent;
  blocks: BlockContent[];
  module_revision: number;
  trashed_by: string;
  trashed_at: string;
}

export interface LayoutRow {
  id: string;
  workspace_id: string;
  name: string;
  content: LayoutContent;
  module_revisions: Record<string, number>;
  trash: TrashedModule[];
  consumed_ends: Record<string, ConsumedEnd>;
  revision: number;
}

export interface HistoryInput {
  action: string;
  object_id: string | null;
  from: string | null;
  to: string | null;
}

export async function loadLayout(
  layoutId: string,
  workspaceId: string,
  client: pg.PoolClient | typeof pool = pool,
): Promise<LayoutRow | null> {
  const { rows } = await client.query<LayoutRow>(
    `select id, workspace_id, name, content, module_revisions, trash, consumed_ends,
            revision::int as revision
     from layouts where id = $1 and workspace_id = $2`,
    [layoutId, workspaceId],
  );
  return rows[0] ?? null;
}

export async function lockLayout(
  client: pg.PoolClient,
  layoutId: string,
  workspaceId: string,
): Promise<LayoutRow | null> {
  const { rows } = await client.query<LayoutRow>(
    `select id, workspace_id, name, content, module_revisions, trash, consumed_ends,
            revision::int as revision
     from layouts where id = $1 and workspace_id = $2 for update`,
    [layoutId, workspaceId],
  );
  return rows[0] ?? null;
}

/** The one place a working-copy change is written: content, history and one event. */
export async function commitLayout(
  client: pg.PoolClient,
  layout: LayoutRow,
  type: LayoutEventType,
  actor: { id: string; display_name: string },
  detail: Record<string, unknown>,
  history: HistoryInput[],
): Promise<{ revision: number; working_hash: string }> {
  recomputeBlockLengths(layout.content);
  applyJointAdjacency(layout.content);
  layout.content = sortContent(layout.content);
  layout.revision += 1;
  const workingHash = contentHash(layout.content);

  await client.query(
    `update layouts set name = $2, content = $3, module_revisions = $4, trash = $5,
            consumed_ends = $6, revision = $7 where id = $1`,
    [
      layout.id,
      layout.name,
      JSON.stringify(layout.content),
      JSON.stringify(layout.module_revisions),
      JSON.stringify(layout.trash),
      JSON.stringify(layout.consumed_ends),
      layout.revision,
    ],
  );

  for (const row of history) {
    await client.query(
      `insert into layout_history (layout_id, actor, action, object_id, from_value, to_value)
       values ($1, $2, $3, $4, $5, $6)`,
      [layout.id, actor.display_name, row.action, row.object_id, row.from, row.to],
    );
  }

  await writeOutbox(client, layoutStream(layout.id), layout.revision, type, {
    seq: layout.revision,
    type,
    actor: actor.display_name,
    layout: {
      revision: layout.revision,
      working_hash: workingHash,
      counts: countsOf(layout.content, layout.trash.length),
    },
    detail,
  });

  return { revision: layout.revision, working_hash: workingHash };
}

export async function historyOf(layoutId: string, objectId: string | null): Promise<HistoryRow[]> {
  const { rows } = await pool.query<{
    id: string;
    actor: string;
    at: Date;
    action: string;
    object_id: string | null;
    from_value: string | null;
    to_value: string | null;
  }>(
    `select id, actor, at, action, object_id, from_value, to_value from layout_history
     where layout_id = $1 and ($2::text is null or object_id = $2)
     order by id desc limit 500`,
    [layoutId, objectId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    actor: row.actor,
    at: row.at.toISOString(),
    action: row.action,
    object_id: row.object_id,
    from: row.from_value,
    to: row.to_value,
  }));
}
