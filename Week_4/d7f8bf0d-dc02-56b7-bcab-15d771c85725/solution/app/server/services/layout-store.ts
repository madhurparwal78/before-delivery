import type { HistoryRow, LayoutContent, LayoutCounts, LayoutEventType, LayoutBlock, LayoutModule, LayoutTurnout } from '../../shared/domain'
import { canonicalHash } from '../canonical'
import { one, rows, type Db, type Tx } from '../db'
import { writeOutbox } from './outbox'
import { layoutStream } from './valkey'

export interface TrashEntry {
  module: LayoutModule
  blocks: LayoutBlock[]
  turnouts: LayoutTurnout[]
  revision: number
  trashed_by: string
  trashed_at: string
}

export interface LayoutRow {
  id: string
  workspace_id: string
  name: string
  revision: number
  content: LayoutContent
  trash: TrashEntry[]
  module_revisions: Record<string, number>
}

const COLUMNS = 'id, workspace_id, name, revision, content, trash, module_revisions'

export async function loadLayout(client: Db, workspaceId: string, layoutId: string, forUpdate: boolean): Promise<LayoutRow | undefined> {
  return one<LayoutRow>(client, `select ${COLUMNS} from layouts where id = $1 and workspace_id = $2${forUpdate ? ' for update' : ''}`, [layoutId, workspaceId])
}

export const workingHash = (content: LayoutContent): string => canonicalHash(content)

export function layoutCounts(layout: LayoutRow): LayoutCounts {
  const { content } = layout
  return {
    modules: content.modules.length,
    pieces: content.modules.reduce((sum, module) => sum + module.pieces.length, 0),
    blocks: content.blocks.length,
    trash: layout.trash.length,
  }
}

export interface Actor { id: string; display_name: string }

export interface HistoryEntry {
  action: string
  object_id: string | null
  module_id?: string | null
  from?: string | null
  to?: string | null
}

export interface LayoutChange {
  type: LayoutEventType
  actor: Actor
  detail: object
  history?: HistoryEntry[]
}

// Every committed layout change carries one revision and writes one history row per change and one event.
export async function saveLayout(tx: Tx, layout: LayoutRow, change: LayoutChange): Promise<void> {
  layout.revision += 1
  await tx.client.query(
    'update layouts set name = $2, revision = $3, content = $4, trash = $5, module_revisions = $6 where id = $1',
    [layout.id, layout.name, layout.revision, JSON.stringify(layout.content), JSON.stringify(layout.trash), JSON.stringify(layout.module_revisions)],
  )
  for (const entry of change.history ?? []) {
    await tx.client.query(
      'insert into layout_history (layout_id, module_id, actor_id, actor_name, action, object_id, from_value, to_value) values ($1, $2, $3, $4, $5, $6, $7, $8)',
      [layout.id, entry.module_id ?? null, change.actor.id, change.actor.display_name, entry.action, entry.object_id, entry.from ?? null, entry.to ?? null],
    )
  }
  await writeOutbox(tx, layoutStream(layout.id), layout.revision, change.type, {
    seq: layout.revision,
    type: change.type,
    actor: change.actor,
    layout: { revision: layout.revision, working_hash: workingHash(layout.content), counts: layoutCounts(layout) },
    detail: change.detail,
  })
}

export async function layoutHistory(client: Db, layoutId: string, objectId: string | null): Promise<HistoryRow[]> {
  const found = await rows<{ id: number; actor_id: string | null; actor_name: string | null; at: Date; action: string; object_id: string | null; from_value: string | null; to_value: string | null }>(
    client,
    `select id, actor_id, actor_name, at, action, object_id, from_value, to_value from layout_history
     where layout_id = $1 and ($2::text is null or object_id = $2) order by id desc limit 500`,
    [layoutId, objectId],
  )
  return found.map(row => ({
    id: String(row.id),
    actor: row.actor_id === null ? null : { id: row.actor_id, display_name: row.actor_name ?? '' },
    at: row.at.toISOString(),
    action: row.action,
    object_id: row.object_id,
    from: row.from_value,
    to: row.to_value,
  }))
}
