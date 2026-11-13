import type { CheckinResult, OpenCheckinBody } from '../../shared/api.js';
import type { User } from '../auth.js';
import { entrantsMessage, mutate, requireOrganizerPowers, tournamentMessage } from '../access.js';
import { serverNow } from '../clock.js';
import { pool, type Client } from '../db.js';
import { runDeadlines } from '../deadlines.js';
import { assertCanBackToDraft, assertCanCloseCheckin, assertCanOpenCheckin, assertCheckinOpen } from '../domain/lifecycle.js';
import { fail } from '../errors.js';
import { ok, route, type Ctx } from '../http.js';
import { publish } from '../live.js';
import { config } from '../config.js';
import { FIELD, MSG } from '../messages.js';
import { saveTournament } from '../repo.js';
import { entrantView, tournamentForViewer, tournamentView } from '../views.js';
import type { Access } from '../access.js';
import type { Entrant } from '../domain/types.js';

const me = (ctx: Ctx): User => ctx.user as User;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

function closeTime(raw: unknown, now: number): number {
  if (raw === undefined || raw === null) return now + config.checkinDefaultMs;
  const at = typeof raw === 'string' && ISO.test(raw) ? Date.parse(raw) : NaN;
  if (Number.isNaN(at)) fail('validation', MSG.checkFields, { fields: { closes_at: FIELD.closeFormat } });
  if (at <= now) fail('validation', MSG.checkFields, { fields: { closes_at: FIELD.closeAfterNow } });
  return at;
}

const viewOf = (a: Access) => ({ tournament: tournamentForViewer(tournamentView(a.draw, a.coOrganizers, a.role), a.role) });

async function setCheckedIn(c: Client, a: Access, entrant: Entrant, checkedIn: boolean): Promise<CheckinResult> {
  if (entrant.checkedIn !== checkedIn) {
    entrant.checkedIn = checkedIn;
    await c.query('UPDATE entrants SET checked_in = $2 WHERE id = $1', [entrant.id, checkedIn]);
    const count = a.draw.entrants.filter((e) => e.checkedIn).length;
    await publish(c, a.draw.tournament.id, a.draw.now, [
      { type: 'checkin.updated', data: { checked_in_count: count, entrant: { name: entrant.name, checked_in: checkedIn } } },
      ...(checkedIn ? [{ type: 'announcement' as const, data: { text: `${entrant.name} checked in` } }] : [])]);
  }
  return { entrant: entrantView(entrant), checked_in_count: a.draw.entrants.filter((e) => e.checkedIn).length };
}

export function registerCheckin(): void {
  route('POST', '/api/tournaments/:id/checkin/open', async (ctx) => {
    const body = ctx.json() as OpenCheckinBody;
    return mutate(me(ctx), ctx.params['id'] as string, async (a, c) => {
      requireOrganizerPowers(a);
      const t = a.draw.tournament;
      assertCanOpenCheckin(t);
      t.checkinClosesAt = closeTime(body.closes_at, a.draw.now);
      t.state = 'checkin_open';
      await saveTournament(c, t);
      await publish(c, t.id, a.draw.now, [tournamentMessage(a.draw, a.coOrganizers)]);
      return ok(viewOf(a));
    });
  });

  route('POST', '/api/tournaments/:id/checkin/close', async (ctx) =>
    mutate(me(ctx), ctx.params['id'] as string, async (a, c) => {
      requireOrganizerPowers(a);
      const t = a.draw.tournament;
      assertCanCloseCheckin(t);
      t.state = 'checkin_closed';
      await saveTournament(c, t);
      await publish(c, t.id, a.draw.now, [tournamentMessage(a.draw, a.coOrganizers),
        { type: 'announcement', data: { text: MSG.checkinClosed } }]);
      return ok(viewOf(a));
    }));

  route('POST', '/api/tournaments/:id/draft', async (ctx) =>
    mutate(me(ctx), ctx.params['id'] as string, async (a, c) => {
      requireOrganizerPowers(a);
      const t = a.draw.tournament;
      assertCanBackToDraft(t);
      t.state = 'draft';
      t.checkinClosesAt = null;
      a.draw.entrants.forEach((e) => { e.checkedIn = false; });
      await c.query('UPDATE entrants SET checked_in = false WHERE tournament_id = $1', [t.id]);
      await saveTournament(c, t);
      await publish(c, t.id, a.draw.now, [entrantsMessage(a.draw), tournamentMessage(a.draw, a.coOrganizers)]);
      return ok(viewOf(a));
    }));

  route('POST', '/api/tournaments/:id/checkin', async (ctx) => {
    await runDeadlines();
    return mutate(me(ctx), ctx.params['id'] as string, async (a, c) => {
      if (!a.myEntrant) fail('forbidden', MSG.cannotChange);
      assertCheckinOpen(a.draw.tournament, a.draw.now);
      return ok(await setCheckedIn(c, a, a.myEntrant, true));
    });
  });

  route('PUT', '/api/entrants/:id/checkin', async (ctx) => {
    const body = ctx.json();
    await runDeadlines();
    const { rows } = await pool.query<{ tournament_id: string }>('SELECT tournament_id FROM entrants WHERE id = $1', [ctx.params['id']]);
    const tournamentId = rows[0]?.tournament_id ?? fail('not_found', MSG.tournamentNotFound);
    return mutate(me(ctx), tournamentId, async (a, c) => {
      requireOrganizerPowers(a);
      assertCheckinOpen(a.draw.tournament, await serverNow());
      const entrant = a.draw.entrants.find((e) => e.id === ctx.params['id']) as Entrant;
      return ok(await setCheckedIn(c, a, entrant, body['checked_in'] === true));
    });
  });
}
