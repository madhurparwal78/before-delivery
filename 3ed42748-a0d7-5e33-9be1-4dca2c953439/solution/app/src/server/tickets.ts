// Ticket storing, waiting and replay for hand-overs, purchases and postcard mail. Each
// namespace is separate; only successes are stored; a request with a ticket already in
// flight waits for it, because the lock below is held until the first one's transaction ends.
import type pg from "pg";
import { lockKey, one } from "./db";
import { conflict, validation } from "./errors";
import type { Ctx, Reply } from "./http";
import { JSON_TYPE } from "./http";

type TicketNamespace = "handover" | "purchase" | "mail";

const TICKET = /^[A-Za-z0-9_-]{8,64}$/;

/** Step 4: the ticket header must be present and well formed. */
export function ticketHeader(ctx: Ctx, header: "Handover-Ticket" | "Purchase-Ticket" | "Mail-Ticket"): string {
  const value = ctx.req.headers[header.toLowerCase()];
  if (value === undefined) throw validation({ [header]: "required" });
  if (typeof value !== "string" || !TICKET.test(value)) throw validation({ [header]: "invalid" });
  return value;
}

/** Step 5: replays a stored success or refuses a ticket bound to another request; null when unused. */
export async function storedTicket(
  db: pg.PoolClient,
  courierId: string,
  namespace: TicketNamespace,
  ticket: string,
  binding: string,
): Promise<Reply | null> {
  await lockKey(db, `ticket:${courierId}:${namespace}:${ticket}`);
  const row = await one<{ binding: string; status: number; body: string }>(
    db,
    "SELECT binding, status, body FROM tickets WHERE courier_id = $1 AND namespace = $2 AND ticket = $3",
    [courierId, namespace, ticket],
  );
  if (!row) return null;
  if (row.binding !== binding) throw conflict("ticket_conflict");
  return { status: row.status, body: row.body, type: JSON_TYPE };
}

export async function storeTicket(
  db: pg.PoolClient,
  courierId: string,
  namespace: TicketNamespace,
  ticket: string,
  binding: string,
  reply: { status: number; body: string },
): Promise<Reply> {
  await db.query(
    "INSERT INTO tickets (courier_id, namespace, ticket, binding, status, body, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [courierId, namespace, ticket, binding, reply.status, reply.body, new Date()],
  );
  return { ...reply, type: JSON_TYPE };
}

