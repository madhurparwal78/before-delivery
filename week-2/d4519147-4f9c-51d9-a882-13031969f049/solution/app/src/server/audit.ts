import type { Db } from "./db.ts";

export type DiagramAction =
  | "share.invited" | "share.accepted" | "share.role_changed" | "share.revoked" | "share.withdrawn"
  | "export.created" | "export.failed" | "import.created" | "import.rejected";

type AccountAction = "signin.failed" | "signin.locked" | "password.changed";

/** Append-only. Called inside the transaction that commits the change it records. */
export async function auditDiagram(db: Db, diagramId: string, actor: string, action: DiagramAction, detail: Record<string, unknown>): Promise<void> {
  await db.query("INSERT INTO audit_events (diagram_id, actor, action, detail) VALUES ($1, $2, $3, $4)", [diagramId, actor, action, JSON.stringify(detail)]);
}

export async function auditAccount(db: Db, accountId: string, actor: string, action: AccountAction, detail: Record<string, unknown>): Promise<void> {
  await db.query("INSERT INTO audit_events (account_id, actor, action, detail) VALUES ($1, $2, $3, $4)", [accountId, actor, action, JSON.stringify(detail)]);
}

interface EventRow {
  id: string;
  at: Date;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
}

export function eventJson(row: EventRow) {
  return { id: String(row.id), at: row.at.toISOString(), actor: row.actor, action: row.action, detail: row.detail };
}

export type { EventRow };
