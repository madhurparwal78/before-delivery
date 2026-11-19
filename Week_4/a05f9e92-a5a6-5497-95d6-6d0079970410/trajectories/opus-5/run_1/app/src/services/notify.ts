/**
 * Inbox delivery. Rules only stop delivery, urgent events ignore the digest
 * setting, and every delivery pushes the new unread count to open pages.
 */

import { now } from '../clock';
import type { PoolClient } from '../db';
import { blocked, isUrgent, type InboxEvent, type InboxRule } from '../domain/inbox';
import type { Person } from './store';

export interface Recipient {
  readonly person: Person;
}

export interface Delivery {
  readonly username: string;
  readonly event: InboxEvent;
  readonly text: string;
  readonly number: string | null;
}

/**
 * Delivers one event to the named people. A recipient loses the event when a
 * rule with `enabled` false lists any one of their roles.
 */
export async function deliver(
  client: PoolClient,
  rules: readonly InboxRule[],
  people: ReadonlyMap<string, Person>,
  event: InboxEvent,
  usernames: readonly string[],
  text: string,
  number: string | null,
): Promise<string[]> {
  const delivered: string[] = [];
  const at = now();
  for (const username of [...new Set(usernames)]) {
    const person = people.get(username);
    if (!person || !person.active) continue;
    if (blocked(rules, event, person.roles)) continue;
    const pendingDigest = person.digest === 'daily' && !isUrgent(event);
    await client.query(
      `INSERT INTO inbox_item (username, event, text, number, at, read, pending_digest)
       VALUES ($1, $2, $3, $4, $5, FALSE, $6)`,
      [username, event, text, number, at, pendingDigest],
    );
    delivered.push(username);
  }
  return delivered;
}

export async function unreadCount(client: PoolClient, username: string): Promise<number> {
  const result = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM inbox_item
     WHERE username = $1 AND NOT read AND NOT pending_digest`,
    [username],
  );
  return Number(result.rows[0]?.n ?? 0);
}

/** The managers of a department, who receive SLA threshold items. */
export function managersOf(
  people: ReadonlyMap<string, Person>,
  department: string | null,
): string[] {
  if (department === null) return [];
  return [...people.values()]
    .filter((p) => p.active && p.department === department && p.roles.includes('manager'))
    .map((p) => p.username);
}

export function operators(people: ReadonlyMap<string, Person>): string[] {
  return [...people.values()].filter((p) => p.active && p.roles.includes('operator')).map((p) => p.username);
}

export function withRole(people: ReadonlyMap<string, Person>, roles: readonly string[]): string[] {
  if (roles.length === 0) return [];
  return [...people.values()]
    .filter((p) => p.active && p.roles.some((r) => roles.includes(r)))
    .map((p) => p.username);
}

/** `@username` mentions in a note or comment. */
export function mentionsIn(text: string, people: ReadonlyMap<string, Person>): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/@([A-Za-z0-9_.-]+)/g)) {
    if (people.has(match[1])) out.push(match[1]);
  }
  return [...new Set(out)];
}
