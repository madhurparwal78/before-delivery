import { newId } from '../crypto';
import { query, type PoolClient } from '../db';
import type { AuditEventRecord } from '../../shared/types';

export type DiagramAuditAction =
  | 'share.invited'
  | 'share.accepted'
  | 'share.role_changed'
  | 'share.revoked'
  | 'share.withdrawn'
  | 'export.created'
  | 'export.failed'
  | 'import.created'
  | 'import.rejected';

export type AccountAuditAction = 'signin.failed' | 'signin.locked' | 'password.changed';

interface Writer {
  query(text: string, values: unknown[]): Promise<unknown>;
}

function writerFor(client?: PoolClient): Writer {
  return client ?? { query: (text, values) => query(text, values) };
}

/** Diagram audit events are written by the same code path that commits the change. */
export async function writeDiagramEvent(
  client: PoolClient | undefined,
  diagramId: string,
  actor: string,
  action: DiagramAuditAction,
  detail: Record<string, unknown>,
): Promise<void> {
  await writerFor(client).query(
    'insert into audit_events (id, diagram_id, actor, action, detail) values ($1, $2, $3, $4, $5)',
    [newId(), diagramId, actor, action, JSON.stringify(detail)],
  );
}

export async function writeAccountEvent(
  client: PoolClient | undefined,
  userId: string,
  actor: string,
  action: AccountAuditAction,
  detail: Record<string, unknown>,
): Promise<void> {
  await writerFor(client).query(
    'insert into audit_events (id, account_user_id, actor, action, detail) values ($1, $2, $3, $4, $5)',
    [newId(), userId, actor, action, JSON.stringify(detail)],
  );
}

interface EventRow {
  id: string;
  at: Date;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
}

function toRecord(row: EventRow): AuditEventRecord {
  return { id: row.id, at: row.at.toISOString(), actor: row.actor, action: row.action, detail: row.detail };
}

export async function diagramEvents(diagramId: string): Promise<AuditEventRecord[]> {
  const rows = await query<EventRow>(
    'select id, at, actor, action, detail from audit_events where diagram_id = $1 order by seq desc limit 500',
    [diagramId],
  );
  return rows.map(toRecord);
}

export async function accountEvents(userId: string): Promise<AuditEventRecord[]> {
  const rows = await query<EventRow>(
    'select id, at, actor, action, detail from audit_events where account_user_id = $1 order by seq desc limit 500',
    [userId],
  );
  return rows.map(toRecord);
}
