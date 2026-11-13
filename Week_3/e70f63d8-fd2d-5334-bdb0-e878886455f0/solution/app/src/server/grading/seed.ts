import { defaultShortName, isWicketKind } from '../../shared/rules.js';
import type { BatterOut, Extra } from '../../shared/wire.js';
import { now } from '../clock.js';
import type { Db } from '../db/pool.js';
import { hashPassword, hashToken, newToken } from '../http/session.js';
import { newViewerCode } from '../viewerCode.js';
import { config } from '../config.js';
import { startingBattersError } from '../laws/corrections.js';
import type { InningsRecord, MatchSpec } from '../laws/match.js';
import { replayMatch } from '../laws/match.js';
import type { Summary } from '../laws/standings.js';
import type { LogEntry, Player, Side } from '../laws/types.js';
import { LawViolation } from '../laws/types.js';

export class SeedError extends Error {}

type Obj = Record<string, unknown>;

const obj = (value: unknown, where: string): Obj => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new SeedError(`${where} must be an object`);
  return value as Obj;
};
const list = (value: unknown, where: string): unknown[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SeedError(`${where} must be a list`);
  return value;
};
const str = (source: Obj, field: string, where: string): string => {
  const value = source[field];
  if (typeof value !== 'string' || value === '') throw new SeedError(`${where}: ${field} must be a non-empty string`);
  return value;
};
const int = (source: Obj, field: string, where: string): number => {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isInteger(value)) throw new SeedError(`${where}: ${field} must be a whole number`);
  return value;
};

interface SeededTeam { id: string; name: string; players: Map<string, Player> }

const EXTRA_TOKENS: Record<string, Extra> = { D: 'wide', N: 'no-ball', B: 'bye', L: 'leg-bye' };

interface Seeded {
  users: Map<string, { id: string; session: string }>;
  teams: Map<string, SeededTeam>;
  tournaments: Map<string, string>;
  matches: Map<string, { id: string; viewerCode: string | null; organiser: string }>;
  invitations: Map<string, string>;
}

const lookup = <T>(map: Map<string, T>, key: unknown, what: string, where: string): T => {
  const found = typeof key === 'string' ? map.get(key) : undefined;
  if (found === undefined) throw new SeedError(`${where}: unknown ${what} ${String(key)}`);
  return found;
};

const seedUsers = async (db: Db, input: unknown[], seeded: Seeded): Promise<void> => {
  for (const raw of input) {
    const user = obj(raw, 'user');
    const key = str(user, 'key', 'user');
    const rows = await db.query<{ id: string }>(
      'INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [str(user, 'email', `user ${key}`), str(user, 'display_name', `user ${key}`), await hashPassword(str(user, 'password', `user ${key}`))]);
    const id = rows[0].id;
    const session = newToken();
    await db.query('INSERT INTO sessions (token_hash, user_id) VALUES ($1, $2)', [hashToken(session), id]);
    seeded.users.set(key, { id, session });
  }
};

const seedTeams = async (db: Db, input: unknown[], seeded: Seeded): Promise<void> => {
  for (const raw of input) {
    const team = obj(raw, 'team');
    const key = str(team, 'key', 'team');
    const where = `team ${key}`;
    const organiser = lookup(seeded.users, team['organiser'], 'user', where);
    const name = str(team, 'name', where);
    const rows = await db.query<{ id: string }>('INSERT INTO teams (organiser_id, name) VALUES ($1, $2) RETURNING id', [organiser.id, name]);
    const id = rows[0].id;
    const players = new Map<string, Player>();
    for (const [position, rawPlayer] of list(team['players'], `${where} players`).entries()) {
      const player = obj(rawPlayer, `${where} player`);
      const playerName = str(player, 'name', where);
      const shortName = typeof player['short_name'] === 'string' && player['short_name'] !== '' ? player['short_name'] : defaultShortName(playerName);
      const stored = await db.query<{ id: string }>(
        'INSERT INTO players (team_id, name, short_name, position) VALUES ($1, $2, $3, $4) RETURNING id', [id, playerName, shortName, position]);
      const playerId = stored[0].id;
      if (playerId === undefined) throw new SeedError(`${where}: player was not stored`);
      players.set(str(player, 'key', where), { id: playerId, name: playerName, shortName });
    }
    seeded.teams.set(key, { id, name, players });
  }
};

const seedTournaments = async (db: Db, input: unknown[], seeded: Seeded): Promise<void> => {
  for (const raw of input) {
    const tournament = obj(raw, 'tournament');
    const key = str(tournament, 'key', 'tournament');
    const where = `tournament ${key}`;
    const organiser = lookup(seeded.users, tournament['organiser'], 'user', where);
    const rows = await db.query<{ id: string }>(
      'INSERT INTO tournaments (organiser_id, name, overs, players_per_side, super_over) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [organiser.id, str(tournament, 'name', where), int(tournament, 'overs', where), int(tournament, 'players_per_side', where), tournament['super_over'] === true]);
    const id = rows[0].id;
    for (const [position, rawGroup] of list(tournament['groups'], `${where} groups`).entries()) {
      const group = obj(rawGroup, `${where} group`);
      const stored = await db.query<{ id: string }>(
        'INSERT INTO tournament_groups (tournament_id, name, position) VALUES ($1, $2, $3) RETURNING id', [id, str(group, 'name', where), position]);
      for (const teamKey of list(group['teams'], `${where} group teams`)) {
        const team = lookup(seeded.teams, teamKey, 'team', where);
        await db.query('INSERT INTO group_teams (group_id, tournament_id, team_id) VALUES ($1, $2, $3)', [stored[0].id, id, team.id]);
      }
    }
    seeded.tournaments.set(key, id);
  }
};

const playerOf = (teams: SeededTeam[], key: unknown, where: string): Player => {
  for (const team of teams) {
    const found = typeof key === 'string' ? team.players.get(key) : undefined;
    if (found) return found;
  }
  throw new SeedError(`${where}: unknown player ${String(key)}`);
};

/** A delivery token (`4`, `D1`, `N4`, `B2`, `L1`) or an object that adds a wicket to one. */
const deliveryOf = (raw: unknown, teams: SeededTeam[], where: string, newBatterDefault: () => string | null): LogEntry => {
  const source = typeof raw === 'string' ? { ball: raw } : obj(raw, where);
  const token = str(source, 'ball', where);
  const extra = EXTRA_TOKENS[token.charAt(0)] ?? 'none';
  const runs = Number(extra === 'none' ? token : token.slice(1));
  if (!Number.isInteger(runs)) throw new SeedError(`${where}: ${token} is not a delivery`);
  if (source['out'] === undefined) return { kind: 'delivery', extra, runs, wicket: null };
  const kind = source['out'];
  if (!isWicketKind(kind)) throw new SeedError(`${where}: ${String(kind)} is not a kind of wicket`);
  const fielder = source['fielder'] === undefined ? null : playerOf(teams, source['fielder'], where).id;
  const newBatter = source['new_batter'] === undefined ? newBatterDefault() : playerOf(teams, source['new_batter'], where).id;
  const batterOut: BatterOut = source['batter_out'] === 'non-striker' ? 'non-striker' : 'striker';
  return { kind: 'delivery', extra, runs, wicket: { kind, fielder, batterOut, newBatter } };
};

/** Plays a seeded match's innings through the laws, entry by entry, exactly as if they had been scored. */
const playInnings = (
  spec: MatchSpec, records: InningsRecord[], source: Obj, teams: SeededTeam[], number: number, key: string,
): void => {
  const where = `match ${key} innings ${number}`;
  const view = replayMatch(spec, records);
  if (view.next === null) throw new SeedError(`${where}: the previous innings has not ended`);
  const striker = playerOf(teams, source['striker'], where).id;
  const nonStriker = playerOf(teams, source['non_striker'], where).id;
  if (Object.keys(startingBattersError(view.next, striker, nonStriker)).length > 0) throw new SeedError(`${where}: the starting batters are not two batters of ${view.next.battingTeam.name}`);
  const bowlers = list(source['bowlers'], `${where} bowlers`).map((bowler) => playerOf(teams, bowler, where).id);
  const first = bowlers[0];
  if (first === undefined) throw new SeedError(`${where}: no bowler`);
  const record: InningsRecord = { striker, nonStriker, log: [{ kind: 'over', bowler: first }] };
  records.push(record);
  let nextBowler = 1;
  let delivery = 0;
  const push = (entry: LogEntry): void => {
    record.log.push(entry);
    try {
      replayMatch(spec, records);
    } catch (error) {
      if (!(error instanceof LawViolation)) throw error;
      const detail = error.onFreeHit && error.wicketKind ? `${error.wicketKind} cannot happen on a free hit` : error.message;
      throw new SeedError(`${where} delivery ${delivery}: ${detail}`);
    }
  };
  const current = () => {
    return replayMatch(spec, records).played[records.length - 1].replay;
  };
  const retirements = list(source['retirements'], `${where} retirements`).map((raw) => {
    const retirement = obj(raw, where);
    return { before: int(retirement, 'before_seq', where), batter: playerOf(teams, retirement['batter'], where).id, newBatter: playerOf(teams, retirement['new_batter'], where).id };
  }).sort((a, b) => a.before - b.before);
  const retireUntil = (limit: number): void => {
    while (retirements[0] && retirements[0].before <= limit) {
      const next = retirements.shift();
      if (next) push({ kind: 'retirement', batter: next.batter, newBatter: next.newBatter });
    }
  };
  for (const raw of list(source['deliveries'], `${where} deliveries`)) {
    delivery += 1;
    retireUntil(delivery);
    const replay = current();
    const upcoming = bowlers[nextBowler];
    if (replay.needsBowler && upcoming !== undefined) {
      nextBowler += 1;
      push({ kind: 'over', bowler: upcoming });
    }
    push(deliveryOf(raw, teams, `${where} delivery ${delivery}`, () => current().yetToBat[0]?.player.id ?? null));
  }
  retireUntil(Number.MAX_SAFE_INTEGER);
  const upcoming = bowlers[nextBowler];
  if (upcoming !== undefined && current().needsBowler) {
    nextBowler += 1;
    push({ kind: 'over', bowler: upcoming });
  }
  if (nextBowler < bowlers.length) throw new SeedError(`${where}: more bowlers than overs`);
};

const seedMatches = async (db: Db, input: unknown[], seeded: Seeded): Promise<void> => {
  for (const raw of input) {
    const source = obj(raw, 'match');
    const key = str(source, 'key', 'match');
    const where = `match ${key}`;
    const organiser = lookup(seeded.users, source['organiser'], 'user', where);
    const home = lookup(seeded.teams, source['home'], 'team', where);
    const away = lookup(seeded.teams, source['away'], 'team', where);
    const first = lookup(seeded.teams, source['batting_first'], 'team', where);
    const tournamentKey = source['tournament'];
    const tournament = tournamentKey === null || tournamentKey === undefined ? null : lookup(seeded.tournaments, tournamentKey, 'tournament', where);
    const overs = int(source, 'overs', where);
    const perSide = int(source, 'players_per_side', where);
    const xiSource = obj(source['xi'], `${where} xi`);
    const xiOf = (team: SeededTeam, teamKey: string): Player[] =>
      list(xiSource[teamKey], `${where} xi`).map((player) => playerOf([team], player, where));
    const side = (team: SeededTeam, teamKey: string): Side => ({ id: team.id, name: team.name, xi: xiOf(team, teamKey) });
    const spec: MatchSpec = {
      home: side(home, str(source, 'home', where)), away: side(away, str(source, 'away', where)), overs, playersPerSide: perSide,
      superOver: source['super_over'] === true, superOverMax: config.superOverMax, battingFirst: first.id,
    };
    const viewerLink = source['viewer_link'] !== false;
    const code = viewerLink ? newViewerCode() : null;
    const summarySource = source['summary'] === null || source['summary'] === undefined ? null : obj(source['summary'], `${where} summary`);
    const innings = list(source['innings'], `${where} innings`);
    const summary: Summary | null = summarySource && innings.length === 0 ? {
      first: summaryInnings(obj(summarySource['first'], where)), second: summaryInnings(obj(summarySource['second'], where)),
      winner: summarySource['winner'] === null ? null : lookup(seeded.teams, summarySource['winner'], 'team', where).id,
    } : null;
    const rows = await db.query<{ id: string }>(
      `INSERT INTO matches (organiser_id, home_team_id, away_team_id, batting_first_team_id, tournament_id, overs, players_per_side, super_over,
                            viewer_link, viewer_code, played_on, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
      [organiser.id, home.id, away.id, first.id, tournament, overs, perSide, spec.superOver, viewerLink, code,
        typeof source['played_on'] === 'string' ? source['played_on'] : null, summary && JSON.stringify(summary)]);
    const id = rows[0].id;
    for (const [team, teamSide] of [[home, spec.home], [away, spec.away]] as const) {
      for (const [position, player] of teamSide.xi.entries()) {
        await db.query('INSERT INTO match_xi (match_id, team_id, player_id, position) VALUES ($1, $2, $3, $4)', [id, team.id, player.id, position]);
      }
    }
    for (const scorer of list(source['scorers'], `${where} scorers`)) {
      await db.query('INSERT INTO match_scorers (match_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, lookup(seeded.users, scorer, 'user', where).id]);
    }
    const records: InningsRecord[] = [];
    const teams = [home, away];
    for (const [index, rawInnings] of innings.entries()) playInnings(spec, records, obj(rawInnings, where), teams, index + 1, key);
    const at = now();
    for (const [index, record] of records.entries()) {
      const stored = await db.query<{ id: string }>(
        'INSERT INTO innings (match_id, ordinal, striker_id, non_striker_id) VALUES ($1, $2, $3, $4) RETURNING id', [id, index + 1, record.striker, record.nonStriker]);
      for (const [position, entry] of record.log.entries()) {
        await db.query('INSERT INTO ball_log (innings_id, position, entry, recorded_at) VALUES ($1, $2, $3, $4)', [stored[0].id, position, JSON.stringify(entry), at]);
      }
    }
    seeded.matches.set(key, { id, viewerCode: code, organiser: organiser.id });
  }
};

const summaryInnings = (source: Obj): Summary['first'] => ({
  runs: int(source, 'runs', 'summary'), wickets: int(source, 'wickets', 'summary'), balls: int(source, 'balls', 'summary'),
  allOut: source['all_out'] === true,
});

const seedInvitations = async (db: Db, input: unknown[], seeded: Seeded): Promise<void> => {
  for (const raw of input) {
    const invitation = obj(raw, 'invitation');
    const key = str(invitation, 'key', 'invitation');
    const where = `invitation ${key}`;
    const match = lookup(seeded.matches, invitation['match'], 'match', where);
    const sentAt = new Date(str(invitation, 'sent_at', where));
    if (Number.isNaN(sentAt.getTime())) throw new SeedError(`${where}: sent_at is not a time`);
    const token = newToken();
    await db.query(
      'INSERT INTO invitations (match_id, organiser_id, email, token_hash, sent_at) VALUES ($1, $2, $3, $4, $5)',
      [match.id, match.organiser, str(invitation, 'email', where), hashToken(token), sentAt]);
    seeded.invitations.set(key, token);
  }
};

/** Stores everything a seed describes, or throws SeedError naming the first problem; the caller rolls back. */
export const applySeed = async (db: Db, body: Obj): Promise<unknown> => {
  const seeded: Seeded = { users: new Map(), teams: new Map(), tournaments: new Map(), matches: new Map(), invitations: new Map() };
  await seedUsers(db, list(body['users'], 'users'), seeded);
  await seedTeams(db, list(body['teams'], 'teams'), seeded);
  await seedTournaments(db, list(body['tournaments'], 'tournaments'), seeded);
  await seedMatches(db, list(body['matches'], 'matches'), seeded);
  await seedInvitations(db, list(body['invitations'], 'invitations'), seeded);
  const out = <T, V>(map: Map<string, T>, value: (item: T) => V): Record<string, V> => Object.fromEntries([...map].map(([key, item]) => [key, value(item)]));
  return {
    users: out(seeded.users, (user) => ({ id: user.id, session: user.session })),
    teams: out(seeded.teams, (team) => ({ id: team.id, players: out(team.players, (player) => player.id) })),
    tournaments: out(seeded.tournaments, (id) => ({ id })),
    matches: out(seeded.matches, (match) => ({ id: match.id, viewer_code: match.viewerCode })),
    invitations: out(seeded.invitations, (token) => ({ token })),
  };
};
