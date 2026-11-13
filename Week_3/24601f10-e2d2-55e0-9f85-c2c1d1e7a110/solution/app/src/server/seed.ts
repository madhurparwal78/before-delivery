import { randomBytes, randomUUID } from 'node:crypto';
import type { Client } from './db.js';
import { createUser, type User } from './auth.js';
import { isStarted } from '../shared/rules.js';
import { config } from './config.js';
import { entrantSide, applyAction, type Actor, type MatchAction } from './domain/match.js';
import { match as matchOf } from './domain/draw.js';
import { pairNextSwissRound, startTournament } from './domain/lifecycle.js';
import type { Draw, Entrant } from './domain/types.js';
import { ApiError, fail } from './errors.js';
import { FIELD, MSG } from './messages.js';
import { loadDraw, saveDraw, saveTournament } from './repo.js';
import type { SeedBody, SeedResult, SeedStep, SeedTournament } from '../shared/api.js';

// The grading seed: users and tournaments created in one transaction, and steps applied through the live rules.
async function userId(c: Client, username: string): Promise<string> {
  const { rows } = await c.query<{ id: string }>('SELECT id FROM users WHERE username = $1', [username.toLowerCase()]);
  return rows[0]?.id ?? fail('validation', FIELD.noAccount(username));
}

function applyStep(draw: Draw, spec: SeedTournament, step: SeedStep): void {
  const organizer = (username: string): Actor => ({ username, organizer: true, entrantId: null });
  const player = (entrant: Entrant): Actor => ({ username: entrant.username ?? spec.organizer, organizer: false, entrantId: entrant.id });
  const act = (actor: Actor, action: { kind: MatchAction['kind']; games?: unknown }, label: string): void => {
    const m = draw.matches.find((x) => x.label === label);
    if (!m) return fail('validation', `Unknown match "${label}".`);
    draw.actor = actor.username;
    applyAction(draw, m, { ...action, version: m.version } as MatchAction, actor);
  };
  const games = { upper_games: step.upper_games, lower_games: step.lower_games };
  const entrantNamed = (name: string | undefined): Entrant =>
    draw.entrants.find((e) => e.name === name) ?? fail('validation', `Unknown entrant "${name}".`);
  const opponentOf = (label: string, entrant: Entrant): Entrant => {
    const m = matchOf(draw, (draw.matches.find((x) => x.label === label) ?? fail('validation', `Unknown match "${label}".`)).id);
    const other = entrantSide(m, entrant.id) === 'upper' ? m.lower : m.upper;
    return other.kind === 'entrant' ? draw.entrantById.get(other.entrantId) as Entrant : fail('validation', MSG.notReady);
  };
  const label = step.match ?? '';
  switch (step.action) {
    case 'called':
      return act(organizer(spec.organizer), { kind: 'call' }, label);
    case 'reported':
      return act(player(entrantNamed(step.by)), { kind: 'report', games }, label);
    case 'disputed': {
      const by = entrantNamed(step.by);
      act(player(by), { kind: 'report', games }, label);
      return act(player(opponentOf(label, by)), { kind: 'dispute', games: step.counter }, label);
    }
    case 'confirmed': {
      if (!step.by) return act(organizer(spec.organizer), { kind: 'result', games }, label);
      const by = entrantNamed(step.by);
      act(player(by), { kind: 'report', games }, label);
      return act(player(opponentOf(label, by)), { kind: 'confirm' }, label);
    }
    case 'resolved':
      return act(organizer(step.resolver ?? spec.organizer), { kind: 'resolve', games }, label);
    case 'next_round':
      draw.actor = spec.organizer;
      pairNextSwissRound(draw);
  }
}

async function seedTournament(c: Client, spec: SeedTournament, now: number): Promise<SeedResult['tournaments'][string]> {
  const id = randomUUID();
  const organizerId = await userId(c, spec.organizer);
  await c.query(
    `INSERT INTO tournaments (id, name, format, time_zone, fill, state, organizer_id, share_code, created_at)
     VALUES ($1,$2,$3,$4,$5,'draft',$6,$7,$8)`,
    [id, spec.name, spec.format, spec.time_zone, spec.fill, organizerId, randomBytes(16).toString('base64url'), now]);
  for (const username of spec.co_organizers ?? []) {
    await c.query('INSERT INTO co_organizers (tournament_id, user_id) VALUES ($1,$2)', [id, await userId(c, username)]);
  }
  for (const entrant of [...spec.entrants].sort((a, b) => a.seed - b.seed)) {
    await c.query('INSERT INTO entrants (id, tournament_id, name, seed, user_id, checked_in) VALUES ($1,$2,$3,$4,$5,$6)',
      [randomUUID(), id, entrant.name, entrant.seed, entrant.username ? await userId(c, entrant.username) : null, entrant.checked_in ?? false]);
  }
  const draw = await loadDraw(c, id, spec.organizer, now) as Draw;
  const t = draw.tournament;
  const closesAt = spec.checkin_closes_at ? Date.parse(spec.checkin_closes_at) : null;
  if (spec.state === 'checkin_open' || spec.state === 'checkin_closed') {
    t.state = spec.state;
    t.checkinClosesAt = closesAt ?? (spec.state === 'checkin_open' ? now + config.checkinDefaultMs : now);
  }
  if (isStarted(spec.state)) {
    startTournament(draw);
    await saveDraw(c, draw);
    draw.created.clear();
    try {
      for (const step of spec.steps ?? []) applyStep(draw, spec, step);
    } catch (error) {
      if (error instanceof ApiError) fail('validation', error.message);
      throw error;
    }
    if (spec.state === 'finished' && !draw.finished) fail('validation', 'Seed steps do not finish the tournament.');
  }
  await saveDraw(c, draw);
  await saveTournament(c, t);
  return { id, share_code: t.shareCode, entrants: Object.fromEntries(draw.entrants.map((e) => [e.name, e.id])),
    matches: Object.fromEntries(draw.matches.map((m) => [m.label, m.id])) };
}

export async function seedWorld(c: Client, body: SeedBody, now: number): Promise<SeedResult> {
  const users: SeedResult['users'] = {};
  for (const credentials of body.users ?? []) {
    const user: User = await createUser(c, credentials.username, credentials.password, now);
    users[user.username] = { id: user.id };
  }
  const tournaments: SeedResult['tournaments'] = {};
  for (const spec of body.tournaments ?? []) tournaments[spec.key] = await seedTournament(c, spec, now);
  return { users, tournaments };
}
