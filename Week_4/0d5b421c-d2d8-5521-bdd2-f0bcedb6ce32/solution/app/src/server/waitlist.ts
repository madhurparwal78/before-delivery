// The waitlist: one live entry per email and date, offered tables in strict join order.
import type { WaitlistEntryResponse } from "../shared/api.js";
import { now } from "./clock.js";
import { UNIQUE_VIOLATION, isPgError, pool, rows, type Queryable } from "./db.js";
import { newId } from "./ids.js";
import { MESSAGES, objectBody, parseDate, parseEmail, parseName, parsePartySize, parseSlot, rejectInvalid } from "./validation.js";

export interface EntryRow {
  entry_id: string;
  sequence: string;
  date: string;
  party_size: number;
  earliest: string;
  latest: string;
  name: string;
  email: string;
  status: WaitlistEntryResponse["status"];
}

export const ENTRY_COLUMNS = "entry_id, sequence, date, party_size, earliest, latest, name, email, status";

/** 1 plus the number of waiting or offered entries for the date that joined earlier. */
async function respond(db: Queryable, entry: EntryRow): Promise<WaitlistEntryResponse> {
  const [ahead] = await rows<{ count: string }>(
    db,
    "SELECT count(*) AS count FROM waitlist_entries WHERE date = $1 AND status IN ('waiting', 'offered') AND sequence < $2",
    [entry.date, entry.sequence],
  );
  return { entry_id: entry.entry_id, status: entry.status, position: Number(ahead?.count ?? 0) + 1 };
}

export async function joinWaitlist(body: unknown): Promise<{ created: boolean; entry: WaitlistEntryResponse }> {
  const input = objectBody(body);
  const date = parseDate(input["date"], now());
  const partySize = parsePartySize(input["party_size"]);
  const earliest = parseSlot(input["earliest"]);
  const latest = parseSlot(input["latest"]);
  const name = parseName(input["name"]);
  const email = parseEmail(input["email"]);
  const windowOrdered = earliest === null || latest === null || earliest <= latest;
  if (date === null || partySize === null || earliest === null || latest === null || !windowOrdered || name === null || email === null) {
    throw rejectInvalid({
      date: [date, MESSAGES.date],
      party_size: [partySize, MESSAGES.party],
      earliest: [earliest, MESSAGES.time],
      latest: [latest === null ? null : windowOrdered, latest === null ? MESSAGES.time : MESSAGES.latest],
      name: [name, MESSAGES.name],
      email: [email, MESSAGES.email],
    });
  }

  const live = () =>
    rows<EntryRow>(
      pool,
      `SELECT ${ENTRY_COLUMNS} FROM waitlist_entries WHERE lower(email) = lower($1) AND date = $2 AND status IN ('waiting', 'offered')`,
      [email, date],
    );
  const [existing] = await live();
  if (existing !== undefined) return { created: false, entry: await respond(pool, existing) };
  try {
    const [created] = await rows<EntryRow>(
      pool,
      `INSERT INTO waitlist_entries (entry_id, date, party_size, earliest, latest, name, email, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'waiting') RETURNING ${ENTRY_COLUMNS}`,
      [newId(), date, partySize, earliest, latest, name, email],
    );
    if (created === undefined) throw new Error("the waitlist entry was not written");
    return { created: true, entry: await respond(pool, created) };
  } catch (error) {
    if (!isPgError(error, UNIQUE_VIOLATION)) throw error;
    const [raced] = await live();
    if (raced === undefined) throw error;
    return { created: false, entry: await respond(pool, raced) };
  }
}
