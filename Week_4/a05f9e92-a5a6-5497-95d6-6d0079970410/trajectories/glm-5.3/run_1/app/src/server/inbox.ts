// Inbox delivery: event rules, digest settings and the unread count.

import { Db, clock } from './db.js';
import { Role } from '../shared/model.js';

export const URGENT_EVENTS = new Set(['page', 'page_exhausted', 'sla_breach']);

export interface InboxRule { event: string; roles: string[]; enabled: boolean }

/** Deliver an inbox item to a user, honouring inbox rules and digest. */
export async function deliver(db: Db, rules: InboxRule[], event: string, username: string, text: string, record: string | null): Promise<void> {
  const person = await db.query(`SELECT roles, digest FROM people WHERE username = $1`, [username]);
  if (!person.rows.length) return;
  const roles = (person.rows[0].roles ?? []) as string[];
  const digest = person.rows[0].digest as string;

  // Rules never add recipients; they only stop delivery. A rule with enabled
  // false for the event listing any one of the recipient's roles stops it.
  const blocking = rules.find(r =>
    r.event === event && r.enabled === false && r.roles.some(role => roles.includes(role)));
  if (blocking) return;

  if (digest === 'daily' && !URGENT_EVENTS.has(event)) {
    // Non-urgent items for daily-digest users are held until 08:00 their time.
    // The digest job folds them into one item; store them with event 'digest'
    // pending marker (event kept, delivered flag false until the digest runs).
    await db.query(
      `INSERT INTO inbox_items(username, event, text, record, at, read, held)
       VALUES ($1,$2,$3,$4,$5,FALSE,TRUE)`,
      [username, event, text, record, new Date(clock.nowMs())],
    );
    return;
  }

  await db.query(
    `INSERT INTO inbox_items(username, event, text, record, at, read, held)
     VALUES ($1,$2,$3,$4,$5,FALSE,FALSE)`,
    [username, event, text, record, new Date(clock.nowMs())],
  );
}

/** Unread count: delivered, unread items only. */
export async function unreadCount(db: Db, username: string): Promise<number> {
  const res = await db.query(
    `SELECT count(*)::int AS n FROM inbox_items WHERE username = $1 AND NOT read AND NOT held`,
    [username],
  );
  return Number(res.rows[0].n);
}
