import { randomBytes, randomUUID } from 'node:crypto';
import type { CreateTournamentBody, HistoryRow, MeBody, PreviewMatch, RoundResult, StandingsView, StartResult, TournamentView } from '../../shared/api.js';
import { FILLS, FORMATS, type Fill, type Format } from '../../shared/api.js';
import type { User } from '../auth.js';
import { entrantsMessage, emitDraw, mutate, read, requireOrganizer, requireOrganizerPowers, tournamentMessage } from '../access.js';
import { serverNow } from '../clock.js';
import { pool } from '../db.js';
import { newDraw } from '../domain/draw.js';
import { generateBracket } from '../domain/bracket.js';
import { assertNotStarted, pairNextSwissRound, startTournament } from '../domain/lifecycle.js';
import { computeStandings } from '../domain/standings.js';
import { isDecided, isElimination, type Draw, type Match } from '../domain/types.js';
import { fail } from '../errors.js';
import { noContent, ok, route, type Ctx } from '../http.js';
import { closeShareSockets, publish } from '../live.js';
import { FIELD, MSG } from '../messages.js';
import { saveDraw, saveTournament } from '../repo.js';
import { validTimeZone } from '../time.js';
import { entrantForViewer, entrantView, forViewer, matchView, tournamentForViewer, tournamentView } from '../views.js';

const me = (ctx: Ctx): User => ctx.user as User;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

function checkTournamentFields(body: Record<string, unknown>, creating: boolean): { name?: string; format?: Format; time_zone?: string; fill?: Fill } {
  const fields: Record<string, string> = {};
  const out: { name?: string; format?: Format; time_zone?: string; fill?: Fill } = {};
  if (creating || 'name' in body) {
    const name = text(body['name']).trim();
    if ([...name].length < 1 || [...name].length > 60) fields['name'] = FIELD.tournamentName;
    else out.name = name;
  }
  if (creating) {
    if (FORMATS.includes(body['format'] as Format)) out.format = body['format'] as Format;
    else fields['format'] = FIELD.format;
  }
  if (creating || 'fill' in body) {
    if (FILLS.includes(body['fill'] as Fill)) out.fill = body['fill'] as Fill;
    else fields['fill'] = FIELD.fill;
  }
  if (creating || 'time_zone' in body) {
    if (validTimeZone(text(body['time_zone']))) out.time_zone = body['time_zone'] as string;
    else fields['time_zone'] = FIELD.timeZone;
  }
  if (Object.keys(fields).length) fail('validation', MSG.checkFields, { fields });
  return out;
}

async function viewsFor(user: User, ids: string[]): Promise<TournamentView[]> {
  const now = await serverNow();
  const views: TournamentView[] = [];
  for (const id of ids) {
    const a = await read(user, id);
    views.push(tournamentForViewer(tournamentView({ ...a.draw, now }, a.coOrganizers, a.role), a.role));
  }
  return views;
}

// A tournament's next match for an entrant: the earliest match they are in that has no result yet.
function nextMatchFor(draw: Draw, entrantId: string): Match | null {
  const mine = draw.matches.filter((m) => [m.upper, m.lower].some((s) => s.kind === 'entrant' && s.entrantId === entrantId)
    && !isDecided(m.state) && m.state !== 'bye' && m.state !== 'not_needed');
  return mine[0] ?? null;
}

export function registerTournaments(): void {
  route('GET', '/api/tournaments', async (ctx) => {
    const user = me(ctx);
    const { rows } = await pool.query<{ id: string }>(
      `SELECT t.id FROM tournaments t WHERE t.organizer_id = $1
         OR EXISTS (SELECT 1 FROM co_organizers c WHERE c.tournament_id = t.id AND c.user_id = $1)
         OR (t.state <> 'draft' AND EXISTS (SELECT 1 FROM entrants e WHERE e.tournament_id = t.id AND e.user_id = $1))
       ORDER BY t.created_at DESC`, [user.id]);
    return ok({ tournaments: await viewsFor(user, rows.map((r) => r.id)) });
  });

  route('POST', '/api/tournaments', async (ctx) => {
    const user = me(ctx);
    const body = checkTournamentFields(ctx.json(), true) as Required<CreateTournamentBody> & { format: Format; fill: Fill };
    const id = randomUUID();
    await pool.query(
      `INSERT INTO tournaments (id, name, format, time_zone, fill, state, organizer_id, share_code, created_at)
       VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8)`,
      [id, body.name, body.format, body.time_zone, body.fill, user.id, randomBytes(16).toString('base64url'), await serverNow()]);
    const [view] = await viewsFor(user, [id]);
    return ok({ tournament: view }, 201);
  });

  route('GET', '/api/tournaments/:id', async (ctx) => {
    const a = await read(me(ctx), ctx.params['id'] as string);
    return ok({ tournament: tournamentForViewer(tournamentView(a.draw, a.coOrganizers, a.role), a.role) });
  });

  route('PATCH', '/api/tournaments/:id', async (ctx) => {
    const body = ctx.json();
    return mutate(me(ctx), ctx.params['id'] as string, async (a, c) => {
      requireOrganizerPowers(a);
      const fields = checkTournamentFields(body, false);
      const t = a.draw.tournament;
      t.name = fields.name ?? t.name;
      t.timeZone = fields.time_zone ?? t.timeZone;
      t.fill = fields.fill ?? t.fill;
      await saveTournament(c, t);
      await publish(c, t.id, a.draw.now, [tournamentMessage(a.draw, a.coOrganizers)]);
      return ok({ tournament: tournamentForViewer(tournamentView(a.draw, a.coOrganizers, a.role), a.role) });
    });
  });

  route('DELETE', '/api/tournaments/:id', async (ctx) =>
    mutate(me(ctx), ctx.params['id'] as string, async (a, c) => {
      requireOrganizer(a);
      assertNotStarted(a.draw.tournament);
      await c.query('DELETE FROM tournaments WHERE id = $1', [a.draw.tournament.id]);
      return noContent();
    }));

  route('POST', '/api/tournaments/:id/co-organizers', async (ctx) => {
    const username = text(ctx.json()['username']).trim().toLowerCase();
    return mutate(me(ctx), ctx.params['id'] as string, async (a, c) => {
      requireOrganizer(a);
      const { rows } = await c.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [username]);
      const found = rows[0];
      const problem = !found ? FIELD.noAccount(username) : found.id === a.draw.tournament.organizerId ? FIELD.organizerAsCo
        : a.coOrganizers.includes(username) ? FIELD.repeatCoOrganizer(username) : null;
      if (problem || !found) fail('validation', MSG.checkFields, { fields: { username: problem as string } });
      await c.query('INSERT INTO co_organizers (tournament_id, user_id) VALUES ($1,$2)', [a.draw.tournament.id, found.id]);
      const names = [...a.coOrganizers, username].sort();
      await publish(c, a.draw.tournament.id, a.draw.now, [tournamentMessage(a.draw, names)]);
      return ok({ co_organizers: names }, 201);
    });
  });

  route('DELETE', '/api/tournaments/:id/co-organizers/:username', async (ctx) =>
    mutate(me(ctx), ctx.params['id'] as string, async (a, c) => {
      requireOrganizer(a);
      const username = (ctx.params['username'] as string).toLowerCase();
      await c.query(`DELETE FROM co_organizers WHERE tournament_id = $1 AND user_id = (SELECT id FROM users WHERE username = $2)`,
        [a.draw.tournament.id, username]);
      await publish(c, a.draw.tournament.id, a.draw.now, [tournamentMessage(a.draw, a.coOrganizers.filter((n) => n !== username))]);
      return noContent();
    }));

  route('GET', '/api/tournaments/:id/preview', async (ctx) => {
    const a = await read(me(ctx), ctx.params['id'] as string);
    const draw = newDraw({ ...a.draw.tournament }, a.draw.entrants, [], a.draw.now, 'system');
    generateBracket(draw);
    const matches: PreviewMatch[] = draw.matches.filter((m) => m.round === 1 && m.bracket !== 'losers')
      .map((m) => ({ number: m.number, upper: matchView(draw, m).upper, lower: matchView(draw, m).lower }));
    return ok({ matches });
  });

  route('POST', '/api/tournaments/:id/start', async (ctx) =>
    mutate(me(ctx), ctx.params['id'] as string, async (a, c) => {
      requireOrganizerPowers(a);
      const removed = startTournament(a.draw);
      if (removed.length) await c.query('DELETE FROM entrants WHERE id = ANY($1)', [removed.map((e) => e.id)]);
      for (const e of a.draw.entrants) await c.query('UPDATE entrants SET seed = $2 WHERE id = $1', [e.id, e.seed]);
      await saveDraw(c, a.draw);
      await publish(c, a.draw.tournament.id, a.draw.now, [entrantsMessage(a.draw), tournamentMessage(a.draw, a.coOrganizers),
        { type: 'announcement', data: { text: 'The tournament has started' } }]);
      const reply: StartResult = { tournament: tournamentForViewer(tournamentView(a.draw, a.coOrganizers, a.role), a.role),
        removed: removed.map((e) => e.name) };
      return ok(reply);
    }));

  route('POST', '/api/tournaments/:id/rounds', async (ctx) =>
    mutate(me(ctx), ctx.params['id'] as string, async (a, c) => {
      requireOrganizerPowers(a);
      const round = pairNextSwissRound(a.draw);
      await saveDraw(c, a.draw);
      await emitDraw(c, a.draw, a.coOrganizers, { created: true, text: `Round ${round} is paired` });
      const matches = a.draw.matches.filter((m) => m.round === round).map((m) => forViewer(matchView(a.draw, m), a.organizer));
      const reply: RoundResult = { round, matches };
      return ok(reply, 201);
    }));

  route('GET', '/api/tournaments/:id/matches', async (ctx) => {
    const a = await read(me(ctx), ctx.params['id'] as string);
    return ok({ matches: a.draw.matches.map((m) => forViewer(matchView(a.draw, m), a.organizer)) });
  });

  route('GET', '/api/tournaments/:id/standings', async (ctx) => {
    const a = await read(me(ctx), ctx.params['id'] as string);
    if (isElimination(a.draw.tournament.format)) fail('wrong_state', MSG.standingsFormat);
    return ok(computeStandings(a.draw) as StandingsView);
  });

  route('GET', '/api/tournaments/:id/me', async (ctx) => {
    const a = await read(me(ctx), ctx.params['id'] as string);
    if (!a.myEntrant) fail('not_found', MSG.tournamentNotFound);
    const next = nextMatchFor(a.draw, a.myEntrant.id);
    const reply: MeBody = { entrant: entrantForViewer(entrantView(a.myEntrant), true), checked_in: a.myEntrant.checkedIn,
      next_match: next && forViewer(matchView(a.draw, next), a.organizer) };
    return ok(reply);
  });

  route('GET', '/api/tournaments/:id/disputes', async (ctx) => {
    const a = await read(me(ctx), ctx.params['id'] as string);
    requireOrganizerPowers(a);
    return ok({ matches: a.draw.matches.filter((m) => m.state === 'disputed').map((m) => matchView(a.draw, m)) });
  });

  route('POST', '/api/tournaments/:id/share/rotate', async (ctx) =>
    mutate(me(ctx), ctx.params['id'] as string, async (a, c) => {
      requireOrganizerPowers(a);
      const old = a.draw.tournament.shareCode;
      a.draw.tournament.shareCode = randomBytes(16).toString('base64url');
      await saveTournament(c, a.draw.tournament);
      closeShareSockets(a.draw.tournament.id, old);
      return ok({ share_url: tournamentView(a.draw, a.coOrganizers, a.role).share_url });
    }));

  route('GET', '/api/users/:username/history', async (ctx) => {
    const { rows } = await pool.query<HistoryRow & { id: string }>(
      `SELECT h.tournament_id, h.tournament_name, h.place, h.field_size, h.finished_on, h.text FROM history_rows h
       JOIN users u ON u.id = h.user_id WHERE u.username = $1 ORDER BY h.finished_at DESC, h.tournament_name`,
      [(ctx.params['username'] as string).toLowerCase()]);
    if (!rows.length && !(await pool.query('SELECT 1 FROM users WHERE username = $1', [(ctx.params['username'] as string).toLowerCase()])).rowCount) {
      fail('not_found', MSG.tournamentNotFound);
    }
    return ok({ rows });
  });
}
