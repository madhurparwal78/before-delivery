import { randomUUID } from 'node:crypto';
import type { AddEntrantBody, SeedingResult } from '../../shared/api.js';
import type { User } from '../auth.js';
import { entrantsMessage, mutate, read, requireOrganizerPowers, tournamentMessage, type Access } from '../access.js';
import { pool, type Client } from '../db.js';
import { assertNotStarted } from '../domain/lifecycle.js';
import type { Entrant } from '../domain/types.js';
import { fail } from '../errors.js';
import { noContent, ok, route, type Ctx } from '../http.js';
import { publish } from '../live.js';
import { FIELD, MSG } from '../messages.js';
import { loadEntrants, saveTournament } from '../repo.js';
import { entrantForViewer, entrantView } from '../views.js';

const me = (ctx: Ctx): User => ctx.user as User;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

async function tournamentOfEntrant(id: string): Promise<string> {
  const { rows } = await pool.query<{ tournament_id: string }>('SELECT tournament_id FROM entrants WHERE id = $1', [id]);
  return rows[0]?.tournament_id ?? fail('not_found', MSG.tournamentNotFound);
}

// The account a name or an entrant is linked to: it must exist and be linked to no other entrant here.
async function accountFor(c: Client, a: Access, raw: unknown, except: string | null): Promise<string | null> {
  const username = text(raw).trim().toLowerCase();
  if (!username) return null;
  const { rows } = await c.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [username]);
  const user = rows[0];
  if (!user) return fail('validation', MSG.checkFields, { fields: { username: FIELD.noAccount(username) } });
  if (a.draw.entrants.some((e) => e.userId === user.id && e.id !== except)) {
    fail('validation', MSG.checkFields, { fields: { username: FIELD.accountLinked(username) } });
  }
  return user.id;
}

// Every change to the field raises seeding_version, so a stale reorder is refused.
async function recordFieldChange(c: Client, a: Access): Promise<void> {
  const t = a.draw.tournament;
  t.seedingVersion += 1;
  t.seedingUpdatedBy = a.user.username;
  await saveTournament(c, t);
  a.draw.entrants = await loadEntrants(c, t.id);
  await publish(c, t.id, a.draw.now, [entrantsMessage(a.draw), tournamentMessage(a.draw, a.coOrganizers)]);
}

export function registerEntrants(): void {
  route('GET', '/api/tournaments/:id/entrants', async (ctx) => {
    const a = await read(me(ctx), ctx.params['id'] as string);
    return ok({ entrants: a.draw.entrants.map((e) => entrantForViewer(entrantView(e), a.organizer)) });
  });

  route('POST', '/api/tournaments/:id/entrants', async (ctx) => {
    const body = ctx.json() as Partial<AddEntrantBody>;
    return mutate(me(ctx), ctx.params['id'] as string, async (a, c) => {
      requireOrganizerPowers(a);
      assertNotStarted(a.draw.tournament);
      const name = text(body.name).trim();
      if ([...name].length < 1 || [...name].length > 40) fail('validation', MSG.checkFields, { fields: { name: FIELD.entrantName } });
      if (a.draw.entrants.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
        fail('validation', MSG.checkFields, { fields: { name: FIELD.entrantDuplicate } });
      }
      const userId = await accountFor(c, a, body.username, null);
      const id = randomUUID();
      await c.query('INSERT INTO entrants (id, tournament_id, name, seed, user_id) VALUES ($1,$2,$3,$4,$5)',
        [id, a.draw.tournament.id, name, a.draw.entrants.length + 1, userId]);
      await recordFieldChange(c, a);
      const added = a.draw.entrants.find((e) => e.id === id) as Entrant;
      return ok({ entrant: entrantView(added) }, 201);
    });
  });

  route('PATCH', '/api/entrants/:id', async (ctx) => {
    const body = ctx.json();
    return mutate(me(ctx), await tournamentOfEntrant(ctx.params['id'] as string), async (a, c) => {
      requireOrganizerPowers(a);
      assertNotStarted(a.draw.tournament);
      const id = ctx.params['id'] as string;
      const userId = await accountFor(c, a, body['username'], id);
      await c.query('UPDATE entrants SET user_id = $2 WHERE id = $1', [id, userId]);
      await recordFieldChange(c, a);
      return ok({ entrant: entrantView(a.draw.entrants.find((e) => e.id === id) as Entrant) });
    });
  });

  route('DELETE', '/api/entrants/:id', async (ctx) =>
    mutate(me(ctx), await tournamentOfEntrant(ctx.params['id'] as string), async (a, c) => {
      requireOrganizerPowers(a);
      assertNotStarted(a.draw.tournament);
      const gone = a.draw.entrants.find((e) => e.id === ctx.params['id']) as Entrant;
      await c.query('DELETE FROM entrants WHERE id = $1', [gone.id]);
      await c.query('UPDATE entrants SET seed = seed - 1 WHERE tournament_id = $1 AND seed > $2', [a.draw.tournament.id, gone.seed]);
      await recordFieldChange(c, a);
      return noContent();
    }));

  route('PUT', '/api/tournaments/:id/seeding', async (ctx) => {
    const body = ctx.json();
    return mutate(me(ctx), ctx.params['id'] as string, async (a, c) => {
      requireOrganizerPowers(a);
      assertNotStarted(a.draw.tournament);
      const order = body['order'];
      const version = body['seeding_version'];
      if (!Array.isArray(order) || !order.every((id) => typeof id === 'string') || typeof version !== 'number') {
        fail('validation', MSG.checkFields, { fields: { order: 'List every entrant once.' } });
      }
      const t = a.draw.tournament;
      const same = order.length === a.draw.entrants.length && a.draw.entrants.every((e) => order.includes(e.id));
      if (version !== t.seedingVersion || !same) {
        fail('stale_seeding', MSG.staleSeeding(t.seedingUpdatedBy ?? t.organizerUsername),
          { entrants: a.draw.entrants.map(entrantView) });
      }
      for (const [index, id] of (order as string[]).entries()) await c.query('UPDATE entrants SET seed = $2 WHERE id = $1', [id, index + 1]);
      await recordFieldChange(c, a);
      const reply: SeedingResult = { entrants: a.draw.entrants.map(entrantView), seeding_version: t.seedingVersion };
      return ok(reply);
    });
  });
}
