import type { Role } from '../shared/api.js';
import { isOrganizerRole } from '../shared/rules.js';
import type { User } from './auth.js';
import { serverNow } from './clock.js';
import { pool, tx, type Client, type Db } from './db.js';
import { fail } from './errors.js';
import { announcementOf } from './domain/announcements.js';
import { match as matchOf } from './domain/draw.js';
import { computeStandings } from './domain/standings.js';
import type { Draw, Entrant } from './domain/types.js';
import { MSG } from './messages.js';
import { loadCoOrganizers, loadDraw } from './repo.js';
import { deliver, publish, type Outgoing } from './live.js';
import { matchView, tournamentView } from './views.js';

export interface Access {
  user: User;
  draw: Draw;
  role: Role;
  organizer: boolean;
  coOrganizers: string[];
  myEntrant: Entrant | null;
}

async function open(db: Db, id: string, user: User, now: number, lock: boolean): Promise<Access> {
  const draw = await loadDraw(db, id, user.username, now, lock);
  if (!draw) return fail('not_found', MSG.tournamentNotFound);
  const co = await loadCoOrganizers(db, id);
  const myEntrant = draw.entrants.find((e) => e.userId === user.id) ?? null;
  const role: Role = draw.tournament.organizerId === user.id ? 'organizer'
    : co.some((c) => c.id === user.id) ? 'co_organizer' : myEntrant ? 'player' : 'viewer';
  const organizer = isOrganizerRole(role);
  // A draft tournament is visible only to its organizers; everyone else gets 404, never 403.
  if (draw.tournament.state === 'draft' && !organizer) fail('not_found', MSG.tournamentNotFound);
  return { user, draw, role, organizer, coOrganizers: co.map((c) => c.username), myEntrant };
}

export async function read(user: User, id: string): Promise<Access> {
  return open(pool, id, user, await serverNow(), false);
}

// A write: the tournament row is locked, so writes to one tournament apply one at a time in arrival order.
export async function mutate<T>(user: User, id: string, work: (a: Access, c: Client) => Promise<T>): Promise<T> {
  const now = await serverNow();
  const result = await tx(async (client) => work(await open(client, id, user, now, true), client));
  await deliver(id);
  return result;
}

export function requireOrganizerPowers(a: Access): void {
  if (!a.organizer) fail('forbidden', MSG.cannotChange);
}

export function requireOrganizer(a: Access): void {
  if (a.role === 'co_organizer') fail('forbidden', MSG.onlyOrganizer);
  if (a.role !== 'organizer') fail('forbidden', MSG.cannotChange);
}

export const tournamentMessage = (draw: Draw, coOrganizers: string[]): Outgoing =>
  ({ type: 'tournament.updated', data: { tournament: tournamentView(draw, coOrganizers, 'organizer') } });

export const entrantsMessage = (draw: Draw): Outgoing => ({
  type: 'entrants.updated',
  data: { entrants: draw.entrants.map((e) => ({ id: e.id, name: e.name, seed: e.seed, username: e.username, checked_in: e.checkedIn })) },
});

interface Emit {
  // Matches already announced some other way (the Shutter trace reset set).
  skip?: ReadonlySet<string>;
  // Also announce the matches the operation created (a new Swiss round).
  created?: boolean;
  tournament?: boolean;
  text?: string | null;
}

// The messages every domain operation sends: changed matches, standings, the tournament, the announcement.
export async function emitDraw(db: Db, draw: Draw, coOrganizers: string[], options: Emit = {}): Promise<void> {
  const ids = [...(options.created ? draw.created : []), ...draw.changed.keys()].filter((id) => !options.skip?.has(id));
  const messages: Outgoing[] = ids.map((id) => ({ type: 'match.updated', data: { match: matchView(draw, matchOf(draw, id)) } }));
  const touched = draw.changed.size > 0 || (options.created && draw.created.size > 0);
  const standings = touched ? computeStandings(draw) : null;
  if (standings) messages.push({ type: 'standings.updated', data: { rows: standings.rows } });
  if (options.tournament || draw.finished) messages.push(tournamentMessage(draw, coOrganizers));
  const text = options.text === undefined ? announcementOf(draw.tournament.format, draw.events) : options.text;
  if (text) messages.push({ type: 'announcement', data: { text } });
  await publish(db, draw.tournament.id, draw.now, messages);
}
