import { config } from './config.js';
import { now, setNow, today } from './clock.js';
import { tx } from './db.js';
import { wicketAllowed } from '../shared/laws.js';
import { type BallEvent, type PlayerRef, type WicketInput, replayInnings, overLimitFor } from './engine.js';
import { HttpError } from './errors.js';
import { type Ctx, sendJson } from './http.js';
import { type InningsRecord, type MatchInput, type MatchSummary, computeMatch } from './match.js';
import { hashPassword, newId, randomToken, userByEmail, viewerCode } from './store.js';
import type { Extra, WicketKind } from '../shared/types.js';

interface SeedUser {
  key: string;
  email: string;
  display_name: string;
  password: string;
}

interface SeedTeam {
  key: string;
  organiser: string;
  name: string;
  players: { key: string; name: string; short_name?: string }[];
}

interface SeedTournament {
  key: string;
  organiser: string;
  name: string;
  overs: number;
  players_per_side: number;
  super_over: boolean;
  groups: { name: string; teams: string[] }[];
}

interface SeedWicket {
  ball: string;
  out: WicketKind;
  fielder?: string;
  batter_out?: 'striker' | 'non-striker';
  new_batter?: string;
}

interface SeedInnings {
  striker: string;
  non_striker: string;
  bowlers: string[];
  deliveries?: (string | SeedWicket)[];
  retirements?: { before_seq: number; batter: string; new_batter: string }[];
}

interface SeedMatch {
  key: string;
  organiser: string;
  home: string;
  away: string;
  overs: number;
  players_per_side: number;
  super_over: boolean;
  batting_first: string;
  tournament?: string | null;
  xi: Record<string, string[]>;
  scorers?: string[];
  viewer_link?: boolean;
  played_on?: string;
  innings?: SeedInnings[];
  summary?: {
    first: { runs: number; wickets: number; balls: number; all_out: boolean };
    second: { runs: number; wickets: number; balls: number; all_out: boolean };
    winner?: string | null;
  } | null;
}

interface SeedInvitation {
  key: string;
  match: string;
  email: string;
  sent_at?: string;
}

function invalid(message: string): HttpError {
  return new HttpError(422, 'SEED_INVALID', message);
}

function parseToken(token: string): { extra: Extra; runs: number } | null {
  if (/^[0-6]$/.test(token)) return { extra: 'none', runs: Number(token) };
  const match = token.match(/^([DNBL])([0-6])$/);
  if (!match) return null;
  const runs = Number(match[2]);
  switch (match[1]) {
    case 'D':
      return { extra: 'wide', runs };
    case 'N':
      return { extra: 'no-ball', runs };
    case 'B':
      return { extra: 'bye', runs };
    default:
      return { extra: 'leg-bye', runs };
  }
}

export async function handleGrading(ctx: Ctx, path: string[]): Promise<boolean> {
  if (ctx.req.headers['x-grading-key'] !== config.gradingKey) return false;

  if (path[0] === 'clock' && ctx.method === 'POST') {
    const value = (ctx.parsed ?? {}).now;
    const instant = setNow(value === null || value === undefined ? null : String(value));
    sendJson(ctx.res, 200, { now: instant.toISOString() });
    return true;
  }

  if (path[0] === 'seed' && ctx.method === 'POST') {
    sendJson(ctx.res, 201, await seed(ctx.parsed ?? {}));
    return true;
  }

  return false;
}

interface BuiltMatch {
  id: string;
  row: {
    organiser: string;
    home: string;
    away: string;
    overs: number;
    players_per_side: number;
    super_over: boolean;
    batting_first: string;
    tournament: string | null;
    viewer_code: string;
    viewer_link: boolean;
    played_on: string | null;
    summary: MatchSummary | null;
  };
  xi: { teamId: string; playerId: string; position: number }[];
  scorers: string[];
  innings: { id: string; key: string; striker: string; non_striker: string; events: BallEvent[] }[];
}

interface Built {
  users: Map<string, { id: string; email: string; display_name: string; password: string; session: string }>;
  teams: Map<
    string,
    { id: string; organiser: string; name: string; players: { key: string; id: string; name: string; short_name: string }[] }
  >;
  tournaments: Map<string, SeedTournament & { id: string }>;
  matches: Map<string, BuiltMatch>;
  invitations: Map<string, { id: string; match: string; email: string; token: string; sent_at: string; organiser: string }>;
}

async function seed(data: Record<string, unknown>): Promise<unknown> {
  const built: Built = {
    users: new Map(),
    teams: new Map(),
    tournaments: new Map(),
    matches: new Map(),
    invitations: new Map(),
  };

  for (const user of (data.users as SeedUser[] | undefined) ?? []) {
    const email = user.email.toLowerCase();
    const taken =
      [...built.users.values()].some((other) => other.email === email) ||
      (await userByEmail(email)) !== null;
    if (taken) throw invalid(`user ${user.key}: an account with this email already exists`);
    built.users.set(user.key, {
      id: newId(),
      email: user.email.toLowerCase(),
      display_name: user.display_name,
      password: user.password,
      session: randomToken(32),
    });
  }

  for (const team of (data.teams as SeedTeam[] | undefined) ?? []) {
    const organiser = built.users.get(team.organiser);
    if (!organiser) throw invalid(`team ${team.key}: unknown organiser ${team.organiser}`);
    built.teams.set(team.key, {
      id: newId(),
      organiser: organiser.id,
      name: team.name,
      players: team.players.map((player) => ({
        key: player.key,
        id: newId(),
        name: player.name,
        short_name: player.short_name ?? player.name.trim().split(/\s+/).slice(-1)[0],
      })),
    });
  }

  for (const tournament of (data.tournaments as SeedTournament[] | undefined) ?? []) {
    const organiser = built.users.get(tournament.organiser);
    if (!organiser) throw invalid(`tournament ${tournament.key}: unknown organiser ${tournament.organiser}`);
    built.tournaments.set(tournament.key, { ...tournament, id: newId() });
  }

  for (const match of (data.matches as SeedMatch[] | undefined) ?? []) {
    built.matches.set(match.key, buildMatch(match, built));
  }

  for (const invitation of (data.invitations as SeedInvitation[] | undefined) ?? []) {
    const match = built.matches.get(invitation.match);
    if (!match) throw invalid(`invitation ${invitation.key}: unknown match ${invitation.match}`);
    built.invitations.set(invitation.key, {
      id: newId(),
      match: match.id,
      email: invitation.email,
      token: randomToken(24),
      sent_at: invitation.sent_at ?? now().toISOString(),
      organiser: match.row.organiser,
    });
  }

  await write(built);

  return {
    users: Object.fromEntries(
      [...built.users].map(([key, user]) => [key, { id: user.id, session: user.session }]),
    ),
    teams: Object.fromEntries(
      [...built.teams].map(([key, team]) => [
        key,
        {
          id: team.id,
          players: Object.fromEntries(team.players.map((player) => [player.key, player.id])),
        },
      ]),
    ),
    tournaments: Object.fromEntries(
      [...built.tournaments].map(([key, tournament]) => [key, { id: tournament.id }]),
    ),
    matches: Object.fromEntries(
      [...built.matches].map(([key, match]) => [
        key,
        { id: match.id, viewer_code: match.row.viewer_code },
      ]),
    ),
    invitations: Object.fromEntries(
      [...built.invitations].map(([key, invitation]) => [key, { token: invitation.token }]),
    ),
  };
}

function buildMatch(match: SeedMatch, built: Built): BuiltMatch {
  const organiser = built.users.get(match.organiser);
  if (!organiser) throw invalid(`match ${match.key}: unknown organiser ${match.organiser}`);
  const home = built.teams.get(match.home);
  const away = built.teams.get(match.away);
  if (!home || !away) throw invalid(`match ${match.key}: unknown team`);
  const tournament = match.tournament ? built.tournaments.get(match.tournament) : null;
  if (match.tournament && !tournament) throw invalid(`match ${match.key}: unknown tournament ${match.tournament}`);
  const battingFirst = built.teams.get(match.batting_first);
  if (!battingFirst) throw invalid(`match ${match.key}: unknown batting_first ${match.batting_first}`);

  const matchId = newId();
  const xi: { teamId: string; playerId: string; position: number }[] = [];
  const xiRefs = new Map<string, PlayerRef[]>();
  for (const [teamKey, playerKeys] of Object.entries(match.xi)) {
    const team = built.teams.get(teamKey);
    if (!team) throw invalid(`match ${match.key}: unknown team ${teamKey} in xi`);
    const refs: PlayerRef[] = [];
    playerKeys.forEach((playerKey, index) => {
      const player = team.players.find((candidate) => candidate.key === playerKey);
      if (!player) throw invalid(`match ${match.key}: unknown player ${playerKey} in xi`);
      xi.push({ teamId: team.id, playerId: player.id, position: index + 1 });
      refs.push({ id: player.id, name: player.name, short_name: player.short_name });
    });
    xiRefs.set(team.id, refs);
  }

  const summary: MatchSummary | null = match.summary
    ? {
        first: match.summary.first,
        second: match.summary.second,
        winner: match.summary.winner ? built.teams.get(match.summary.winner)?.id ?? null : null,
      }
    : null;

  const input: MatchInput = {
    id: matchId,
    overs: tournament ? tournament.overs : match.overs,
    players_per_side: tournament ? tournament.players_per_side : match.players_per_side,
    super_over: tournament ? tournament.super_over : match.super_over,
    super_over_max: config.superOverMax,
    home: { id: home.id, name: home.name },
    away: { id: away.id, name: away.name },
    batting_first: battingFirst.id,
    played_on: match.played_on ?? null,
    xi: xiRefs,
    innings: [],
    viewer_link: match.viewer_link !== false,
    viewer_code: viewerCode(),
    has_logo: new Set(),
    tournament_id: tournament ? tournament.id : null,
    summary,
  };

  const inningsRecords: InningsRecord[] = [];
  const seededInnings = match.innings ?? [];
  for (const [index, seedInnings] of seededInnings.entries()) {
    const computed = computeMatch({ ...input, innings: inningsRecords });
    const plan = computed.nextPlan;
    if (!plan) throw invalid(`match ${match.key} innings ${index + 1}: the match is already over`);
    const battingXI = xiRefs.get(plan.battingTeamId) ?? [];
    const bowlingXI = xiRefs.get(plan.bowlingTeamId) ?? [];
    const findPlayer = (key: string, pool: PlayerRef[]): string => {
      for (const team of built.teams.values()) {
        const player = team.players.find((candidate) => candidate.key === key);
        if (player && pool.some((ref) => ref.id === player.id)) return player.id;
      }
      throw invalid(`match ${match.key} innings ${index + 1}: unknown player ${key}`);
    };

    const striker = findPlayer(seedInnings.striker, battingXI);
    const nonStriker = findPlayer(seedInnings.non_striker, battingXI);
    if (seedInnings.bowlers.length === 0) {
      throw invalid(`match ${match.key} innings ${index + 1}: no bowler listed for over 1`);
    }
    const events: BallEvent[] = [{ t: 'over', bowler: findPlayer(seedInnings.bowlers[0], bowlingXI) }];
    let overIndex = 0;
    const replay = (): ReturnType<typeof replayInnings> =>
      replayInnings({
        key: plan.key,
        battingTeamName: '',
        battingXI,
        bowlingXI,
        striker,
        nonStriker,
        events,
        oversQuota: plan.oversQuota,
        target: plan.target,
        superOver: plan.superOver,
        overLimit: plan.superOver ? 1 : overLimitFor(input.overs),
      });

    const retirements = seedInnings.retirements ?? [];
    const deliveries = seedInnings.deliveries ?? [];
    for (const [deliveryIndex, entry] of deliveries.entries()) {
      const seq = deliveryIndex + 1;
      for (const retirement of retirements.filter((item) => item.before_seq === seq)) {
        events.push({
          t: 'retirement',
          batter: findPlayer(retirement.batter, battingXI),
          new_batter: findPlayer(retirement.new_batter, battingXI),
        });
      }
      const where = `match ${match.key} innings ${index + 1} delivery ${seq}`;
      let state = replay();
      if (state.ended) throw invalid(`${where}: the innings has already ended`);
      if (state.needsBowler) {
        overIndex += 1;
        const bowlerKey = seedInnings.bowlers[overIndex];
        if (!bowlerKey) throw invalid(`${where}: no bowler listed for over ${overIndex + 1}`);
        events.push({ t: 'over', bowler: findPlayer(bowlerKey, bowlingXI) });
        state = replay();
      }
      const token = typeof entry === 'string' ? entry : entry.ball;
      const parsed = parseToken(token);
      if (!parsed) throw invalid(`${where}: unknown delivery token ${token}`);
      if ((parsed.extra === 'bye' || parsed.extra === 'leg-bye') && parsed.runs < 1) {
        throw invalid(`${where}: byes need at least 1 run`);
      }
      let wicket: WicketInput | null = null;
      if (typeof entry !== 'string') {
        if (!wicketAllowed(entry.out, parsed.extra, state.freeHit)) {
          throw invalid(
            `${where}: ${entry.out} cannot happen on ${state.freeHit ? 'a free hit' : 'this delivery'}`,
          );
        }
        const fielder = entry.fielder ? findPlayer(entry.fielder, bowlingXI) : null;
        const waiting = state.yetToBat.map((player) => player.player);
        let newBatter: string | null = null;
        if (entry.new_batter) newBatter = findPlayer(entry.new_batter, battingXI);
        else newBatter = waiting[0] ?? null;
        wicket = {
          kind: entry.out,
          fielder,
          batter_out: entry.batter_out === 'non-striker' ? 'non-striker' : 'striker',
          new_batter: newBatter,
        };
      }
      events.push({ t: 'delivery', extra: parsed.extra, runs: parsed.runs, wicket });
    }

    const finalState = replay();
    if (!finalState.ended && finalState.needsBowler && seedInnings.bowlers[overIndex + 1]) {
      events.push({ t: 'over', bowler: findPlayer(seedInnings.bowlers[overIndex + 1], bowlingXI) });
    }

    inningsRecords.push({ id: newId(), key: plan.key, striker, non_striker: nonStriker, events });
  }

  const anyDelivery = inningsRecords.some((record) =>
    record.events.some((event) => event.t === 'delivery'),
  );

  return {
    id: matchId,
    row: {
      organiser: organiser.id,
      home: home.id,
      away: away.id,
      overs: input.overs,
      players_per_side: input.players_per_side,
      super_over: input.super_over,
      batting_first: battingFirst.id,
      tournament: input.tournament_id,
      viewer_code: input.viewer_code,
      viewer_link: input.viewer_link,
      played_on: match.played_on ?? (anyDelivery || summary ? today() : null),
      summary,
    },
    xi,
    scorers: (match.scorers ?? []).map((scorerKey) => {
      const user = built.users.get(scorerKey);
      if (!user) throw invalid(`match ${match.key}: unknown scorer ${scorerKey}`);
      return user.id;
    }),
    innings: inningsRecords.map((record) => ({
      id: record.id,
      key: record.key,
      striker: record.striker,
      non_striker: record.non_striker,
      events: record.events,
    })),
  };
}

async function write(built: Built): Promise<void> {
  const hashes = new Map<string, string>();
  for (const [key, user] of built.users) hashes.set(key, await hashPassword(user.password));

  await tx(async (client) => {
    for (const [key, user] of built.users) {
      await client.query(
        'insert into users (id, email, password_hash, display_name) values ($1, $2, $3, $4)',
        [user.id, user.email, hashes.get(key), user.display_name],
      );
      await client.query('insert into sessions (id, user_id) values ($1, $2)', [
        user.session,
        user.id,
      ]);
    }
    for (const team of built.teams.values()) {
      await client.query('insert into teams (id, organiser_id, name) values ($1, $2, $3)', [
        team.id,
        team.organiser,
        team.name,
      ]);
      for (const [index, player] of team.players.entries()) {
        await client.query(
          'insert into players (id, team_id, name, short_name, position) values ($1, $2, $3, $4, $5)',
          [player.id, team.id, player.name, player.short_name, index + 1],
        );
      }
    }
    for (const tournament of built.tournaments.values()) {
      const organiser = built.users.get(tournament.organiser)!;
      await client.query(
        'insert into tournaments (id, organiser_id, name, overs, players_per_side, super_over) values ($1, $2, $3, $4, $5, $6)',
        [
          tournament.id,
          organiser.id,
          tournament.name,
          tournament.overs,
          tournament.players_per_side,
          tournament.super_over,
        ],
      );
      for (const [index, group] of tournament.groups.entries()) {
        const groupId = newId();
        await client.query(
          'insert into groups (id, tournament_id, name, position) values ($1, $2, $3, $4)',
          [groupId, tournament.id, group.name, index + 1],
        );
        for (const [teamIndex, teamKey] of group.teams.entries()) {
          const team = built.teams.get(teamKey);
          if (!team) throw invalid(`tournament ${tournament.key}: unknown team ${teamKey}`);
          await client.query(
            'insert into group_teams (group_id, team_id, position) values ($1, $2, $3)',
            [groupId, team.id, teamIndex + 1],
          );
        }
      }
    }
    for (const match of built.matches.values()) {
      await client.query(
        `insert into matches (id, organiser_id, home_team_id, away_team_id, overs, players_per_side,
           super_over, batting_first, tournament_id, viewer_code, viewer_link, played_on, summary)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          match.id,
          match.row.organiser,
          match.row.home,
          match.row.away,
          match.row.overs,
          match.row.players_per_side,
          match.row.super_over,
          match.row.batting_first,
          match.row.tournament,
          match.row.viewer_code,
          match.row.viewer_link,
          match.row.played_on,
          match.row.summary ? JSON.stringify(match.row.summary) : null,
        ],
      );
      for (const entry of match.xi) {
        await client.query(
          'insert into match_xi (match_id, team_id, player_id, position) values ($1, $2, $3, $4)',
          [match.id, entry.teamId, entry.playerId, entry.position],
        );
      }
      for (const userId of match.scorers) {
        await client.query('insert into match_scorers (match_id, user_id) values ($1, $2)', [
          match.id,
          userId,
        ]);
      }
      for (const [index, innings] of match.innings.entries()) {
        await client.query(
          'insert into innings (id, match_id, idx, key, striker, non_striker) values ($1, $2, $3, $4, $5, $6)',
          [innings.id, match.id, index + 1, innings.key, innings.striker, innings.non_striker],
        );
        for (const [ord, event] of innings.events.entries()) {
          await client.query(
            'insert into ball_events (innings_id, ord, type, data) values ($1, $2, $3, $4)',
            [innings.id, ord + 1, event.t, JSON.stringify(event)],
          );
        }
      }
    }
    for (const invitation of built.invitations.values()) {
      await client.query(
        'insert into invitations (id, match_id, organiser_id, email, token, sent_at) values ($1, $2, $3, $4, $5, $6)',
        [
          invitation.id,
          invitation.match,
          invitation.organiser,
          invitation.email,
          invitation.token,
          invitation.sent_at,
        ],
      );
    }
  });
}
