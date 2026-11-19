import { randomUUID } from "node:crypto";
import { isoInstant } from "./clock.js";
import type { Queryable } from "./db.js";
import { publish } from "./events.js";

interface InboxInput {
  personId: string;
  text: string;
  taskId: string | null;
  kind: "note" | "approval_request" | "decision";
  approvalId?: string | null;
}

export async function addInboxItem(tx: Queryable, input: InboxInput, now: Date): Promise<void> {
  const id = randomUUID();
  await tx.query(
    "INSERT INTO inbox (id, person_id, text, task_id, kind, approval_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [id, input.personId, input.text, input.taskId, input.kind, input.approvalId ?? null, now],
  );
  await publish(tx, { t: "inbox", person: input.personId, added: id, text: input.text });
}

interface InboxRow { id: string; text: string; task_id: string | null; kind: string; read: boolean; created_at: Date }

export function inboxJson(row: InboxRow, pending: boolean) {
  return {
    id: row.id, text: row.text, taskId: row.task_id, kind: row.kind, read: row.read,
    createdAt: isoInstant(row.created_at), pending,
  };
}
