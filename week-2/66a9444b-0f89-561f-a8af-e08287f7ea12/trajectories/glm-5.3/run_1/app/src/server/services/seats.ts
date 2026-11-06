import type { Row } from "../db.js";

export interface SessionRow {
  id: string;
  title: string;
  discipline: string;
  venue_id: string;
  admission: string;
  capacity: number | null;
  price_full_cents: number | null;
  price_reduced_cents: number | null;
  starts_at: Date;
  ends_at: Date;
  festival_day: string;
  status: string;
  publish_at: Date | null;
  version: number;
  description: string;
}

export function sessionFromRow(row: Row): SessionRow {
  return {
    id: String(row.id),
    title: String(row.title),
    discipline: String(row.discipline),
    venue_id: String(row.venue_id),
    admission: String(row.admission),
    capacity: row.capacity === null || row.capacity === undefined ? null : Number(row.capacity),
    price_full_cents: row.price_full_cents === null || row.price_full_cents === undefined ? null : Number(row.price_full_cents),
    price_reduced_cents: row.price_reduced_cents === null || row.price_reduced_cents === undefined ? null : Number(row.price_reduced_cents),
    starts_at: row.starts_at instanceof Date ? row.starts_at : new Date(String(row.starts_at)),
    ends_at: row.ends_at instanceof Date ? row.ends_at : new Date(String(row.ends_at)),
    festival_day: String(row.festival_day),
    status: String(row.status),
    publish_at: row.publish_at === null || row.publish_at === undefined ? null : new Date(String(row.publish_at)),
    version: Number(row.version),
    description: row.description === null || row.description === undefined ? "" : String(row.description),
  };
}

// A scheduled item counts as published for every read at or after its publish instant.
export function effectiveStatus(status: string, publishAt: Date | null, now: Date): string {
  if (status === "scheduled" && publishAt !== null && publishAt.getTime() <= now.getTime()) {
    return "published";
  }
  return status;
}

// Seats remaining is always computed from the records: capacity minus active holds,
// open waitlist offers and seats on lines in states proof_pending, captured or transferred.
export type Queriable = { query: (sql: string, a: unknown[]) => Promise<{ rows: Row[] }> };

export async function seatsRemaining(
  client: Queriable,
  sessionId: string,
): Promise<number | null> {
  const res = await client.query(
    `select
       (select capacity from sessions where id = $1)
       - coalesce((select sum(quantity) from holds
           where session_id = $1 and status = 'active' and expires_at > now()), 0)
       - coalesce((select count(*) from waitlist_entries
           where session_id = $1 and status = 'offered' and offer_expires_at > now()), 0)
       - coalesce((select count(*) from lines
           where session_id = $1 and state in ('proof_pending','captured','transferred')), 0)
     as remaining`,
    [sessionId],
  );
  const row = res.rows[0];
  if (!row || row.remaining === null) return null;
  return Math.max(0, Number(row.remaining));
}

export async function getSession(client: Queriable, id: string): Promise<SessionRow | null> {
  const res = await client.query("select * from sessions where id = $1", [id]);
  return res.rows[0] ? sessionFromRow(res.rows[0]) : null;
}
