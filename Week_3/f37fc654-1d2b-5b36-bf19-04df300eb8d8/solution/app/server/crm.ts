// CRM events: one event id per event, delivered through Svix by a durable webhook job.
import { randomUUID } from "node:crypto";
import type { Commission } from "./commissions.js";
import type { Db } from "./db.js";
import { enqueue } from "./jobs.js";

type CrmEventType = "slot.held" | "contract.signed" | "milestone.paid" | "maintenance.changed";

export async function queueCrmEvent(db: Db, c: Commission, type: CrmEventType, data: Record<string, unknown>): Promise<void> {
  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();
  await db.query("INSERT INTO crm_events (event_id, commission_id, client_id, type, created_at) VALUES ($1, $2, $3, $4, $5)", [eventId, c.id, c.clientId, type, occurredAt]);
  await enqueue(db, "webhook", c.id, { eventId, type, occurredAt, commissionId: c.id, clientId: c.clientId, data });
}
