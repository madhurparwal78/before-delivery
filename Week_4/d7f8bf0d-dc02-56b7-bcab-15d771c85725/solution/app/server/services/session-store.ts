import type { SessionEventType, SessionListItem } from '../../shared/domain'
import { one, rows, type Db, type Tx } from '../db'
import type { StatusPair } from '../../shared/session-states'
import { buildSnapshot, positionsOf, type SessionRow } from '../domain/session/state'
import { writeOutbox } from './outbox'
import { sessionStream } from './valkey'

const COLUMNS = `id, workspace_id, layout_id, name, status, hold_reason, ratio, revision, control_revision, session_version, tick,
  last_tick_at, layout_version_id, layout_version_number, timetable_version, state`

export async function loadSession(client: Db, sessionId: string, forUpdate: boolean): Promise<SessionRow | undefined> {
  return one<SessionRow>(client, `select ${COLUMNS} from sessions where id = $1${forUpdate ? ' for update' : ''}`, [sessionId])
}

export async function loadWorkspaceSession(client: Db, workspaceId: string, sessionId: string, forUpdate: boolean): Promise<SessionRow | undefined> {
  return one<SessionRow>(client, `select ${COLUMNS} from sessions where id = $1 and workspace_id = $2${forUpdate ? ' for update' : ''}`, [sessionId, workspaceId])
}

export async function listSessions(client: Db, workspaceId: string): Promise<SessionListItem[]> {
  return rows<SessionListItem>(client, `select id, name, status, tick, layout_version_number from sessions where workspace_id = $1 order by created_at, id`, [workspaceId])
}

export async function sessionsOfLayout(client: Db, layoutId: string): Promise<SessionRow[]> {
  return rows<SessionRow>(client, `select ${COLUMNS} from sessions where layout_id = $1 and status <> 'Ended' order by id for update`, [layoutId])
}

interface SessionChange {
  type: SessionEventType
  detail: object
  // Start, Hold, Resume, End, block service, turnout throws and automatic holds raise the control revision.
  control?: boolean
}

// Every committed session change carries one revision and writes one event; the only place that does so.
export async function saveSession(tx: Tx, row: SessionRow, change: SessionChange): Promise<void> {
  row.revision += 1
  if (change.control === true) row.control_revision += 1
  await tx.client.query(
    `update sessions set status = $2, hold_reason = $3, revision = $4, control_revision = $5, session_version = $6, tick = $7,
       last_tick_at = $8, state = $9 where id = $1`,
    [row.id, row.status, row.hold_reason, row.revision, row.control_revision, row.session_version, row.tick, row.last_tick_at, JSON.stringify(row.state)],
  )
  const snapshot = buildSnapshot(row)
  await writeOutbox(tx, sessionStream(row.id), row.revision, change.type, { seq: row.revision, type: change.type, session: snapshot, detail: change.detail })
  if (change.type === 'tick.committed') {
    await tx.client.query(
      'insert into session_ticks (session_id, tick, revision, positions, counters) values ($1, $2, $3, $4, $5)',
      [row.id, row.tick, row.revision, JSON.stringify(positionsOf(row.state)), JSON.stringify(snapshot.counters)],
    )
  }
}

// A status change (a command, an automatic hold, a lost lease): the status, a restarted tick clock when Running, one event.
export async function changeStatus(tx: Tx, row: SessionRow, next: StatusPair, detail: object): Promise<void> {
  row.status = next.status
  row.hold_reason = next.hold_reason
  if (next.status === 'Running') row.last_tick_at = new Date()
  await saveSession(tx, row, { type: 'session.status', control: true, detail })
}
