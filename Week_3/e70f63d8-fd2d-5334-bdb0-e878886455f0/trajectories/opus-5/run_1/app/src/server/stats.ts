import { dateText, oversText, ratioFixed, signedFixed } from '../shared/messages.js';
import type { Career, GroupView, TableRow, TournamentView } from '../shared/types.js';
import { type MatchComputed, computeMatch } from './match.js';
import {
  type MatchRow,
  type PlayerRow,
  groupTeams,
  loadMatchInput,
  playerMatches,
  teamMatches,
  tournamentGroups,
  tournamentMatches,
} from './store.js';

export function isFinished(computed: MatchComputed): boolean {
  return computed.status === 'result' || computed.status === 'tied';
}

export function hasBallLog(computed: MatchComputed): boolean {
  return computed.played.some((played) => played.computed.deliveryCount > 0);
}

export interface SideFigures {
  teamId: string;
  runs: number;
  balls: number;
  allOut: boolean;
}

export function matchSides(computed: MatchComputed): SideFigures[] | null {
  const { input } = computed;
  if (input.summary) {
    const secondTeamId = input.batting_first === input.home.id ? input.away.id : input.home.id;
    return [
      {
        teamId: input.batting_first,
        runs: input.summary.first.runs,
        balls: input.summary.first.balls,
        allOut: input.summary.first.all_out,
      },
      {
        teamId: secondTeamId,
        runs: input.summary.second.runs,
        balls: input.summary.second.balls,
        allOut: input.summary.second.all_out,
      },
    ];
  }
  const sides: SideFigures[] = [];
  for (const played of computed.played) {
    if (played.plan.superOver) continue;
    sides.push({
      teamId: played.plan.battingTeamId,
      runs: played.computed.runs,
      balls: played.computed.legalBalls,
      allOut: played.computed.allOut,
    });
  }
  return sides.length === 2 ? sides : null;
}

export async function loadComputedMatch(row: MatchRow): Promise<MatchComputed> {
  const input = await loadMatchInput(row);
  return computeMatch(input);
}

export function historyLine(computed: MatchComputed): string {
  const { input } = computed;
  const date = input.played_on ? dateText(input.played_on) : '';
  return `${input.home.name} v ${input.away.name}, ${date}: ${computed.result ?? ''}`;
}

export async function teamHistory(
  teamId: string,
): Promise<{ id: string; line: string; scorecard_url: string | null }[]> {
  const rows = await teamMatches(teamId);
  const history: { id: string; line: string; scorecard_url: string | null }[] = [];
  for (const row of rows) {
    const computed = await loadComputedMatch(row);
    if (!isFinished(computed)) continue;
    history.push({
      id: row.id,
      line: historyLine(computed),
      scorecard_url: hasBallLog(computed) ? `/matches/${row.id}/scorecard` : null,
    });
  }
  return history;
}

interface TeamTally {
  teamId: string;
  name: string;
  p: number;
  w: number;
  l: number;
  t: number;
  scored: number;
  ballsFaced: number;
  conceded: number;
  ballsBowled: number;
}

export async function buildTournamentView(
  tournament: { id: string; name: string; overs: number; players_per_side: number; super_over: boolean },
): Promise<TournamentView> {
  const groups = await tournamentGroups(tournament.id);
  const matchRows = await tournamentMatches(tournament.id);
  const computedMatches = new Map<string, MatchComputed>();
  for (const row of matchRows) computedMatches.set(row.id, await loadComputedMatch(row));

  const groupViews: GroupView[] = [];
  for (const group of groups) {
    const teams = await groupTeams(group.id);
    const ids = new Set(teams.map((team) => team.id));
    const tallies = new Map<string, TeamTally>();
    for (const team of teams) {
      tallies.set(team.id, {
        teamId: team.id,
        name: team.name,
        p: 0,
        w: 0,
        l: 0,
        t: 0,
        scored: 0,
        ballsFaced: 0,
        conceded: 0,
        ballsBowled: 0,
      });
    }
    const groupMatches = matchRows.filter(
      (row) => ids.has(row.home_team_id) && ids.has(row.away_team_id),
    );
    const headToHead = new Map<string, string>();

    for (const row of groupMatches) {
      const computed = computedMatches.get(row.id)!;
      if (!isFinished(computed)) continue;
      const home = tallies.get(row.home_team_id)!;
      const away = tallies.get(row.away_team_id)!;
      home.p += 1;
      away.p += 1;
      if (computed.winnerTeamId) {
        const winner = tallies.get(computed.winnerTeamId)!;
        const loser = computed.winnerTeamId === row.home_team_id ? away : home;
        winner.w += 1;
        loser.l += 1;
        headToHead.set([row.home_team_id, row.away_team_id].sort().join('|'), computed.winnerTeamId);
      } else {
        home.t += 1;
        away.t += 1;
      }
      const sides = matchSides(computed);
      if (!sides) continue;
      const quotaBalls = computed.input.overs * 6;
      for (const side of sides) {
        const other = sides.find((candidate) => candidate.teamId !== side.teamId)!;
        const tally = tallies.get(side.teamId)!;
        tally.scored += side.runs;
        tally.ballsFaced += side.allOut ? quotaBalls : side.balls;
        tally.conceded += other.runs;
        tally.ballsBowled += other.allOut ? quotaBalls : other.balls;
      }
    }

    const nrrValue = (tally: TeamTally): number => {
      const scoredRate = tally.ballsFaced > 0 ? (tally.scored * 6) / tally.ballsFaced : 0;
      const concededRate = tally.ballsBowled > 0 ? (tally.conceded * 6) / tally.ballsBowled : 0;
      return scoredRate - concededRate;
    };

    const rows = [...tallies.values()];
    const levelCount = (tally: TeamTally): number =>
      rows.filter(
        (other) =>
          other.w * 2 + other.t === tally.w * 2 + tally.t &&
          other.w === tally.w &&
          nrrValue(other) === nrrValue(tally),
      ).length;

    rows.sort((a, b) => {
      const pointsA = a.w * 2 + a.t;
      const pointsB = b.w * 2 + b.t;
      if (pointsA !== pointsB) return pointsB - pointsA;
      if (a.w !== b.w) return b.w - a.w;
      const nrrA = nrrValue(a);
      const nrrB = nrrValue(b);
      if (nrrA !== nrrB) return nrrB - nrrA;
      if (levelCount(a) === 2 && levelCount(b) === 2) {
        const winner = headToHead.get([a.teamId, b.teamId].sort().join('|'));
        if (winner === a.teamId) return -1;
        if (winner === b.teamId) return 1;
      }
      return a.name.localeCompare(b.name);
    });

    const table: TableRow[] = rows.map((tally) => ({
      team: { id: tally.teamId, name: tally.name },
      p: tally.p,
      w: tally.w,
      l: tally.l,
      t: tally.t,
      pts: tally.w * 2 + tally.t,
      nrr: nrrText(tally),
    }));

    groupViews.push({
      name: group.name,
      table,
      matches: groupMatches.map((row) => {
        const computed = computedMatches.get(row.id)!;
        return {
          id: row.id,
          home: computed.input.home.name,
          away: computed.input.away.name,
          status: computed.status,
          result: computed.result,
        };
      }),
    });
  }

  return {
    id: tournament.id,
    name: tournament.name,
    overs: tournament.overs,
    players_per_side: tournament.players_per_side,
    super_over: tournament.super_over,
    groups: groupViews,
  };
}

function nrrText(tally: TeamTally): string {
  if (tally.ballsFaced === 0 && tally.ballsBowled === 0) return '0.000';
  if (tally.ballsBowled === 0) return signedFixed(tally.scored * 6, tally.ballsFaced, 3);
  if (tally.ballsFaced === 0) return signedFixed(-tally.conceded * 6, tally.ballsBowled, 3);
  const numerator = tally.scored * 6 * tally.ballsBowled - tally.conceded * 6 * tally.ballsFaced;
  return signedFixed(numerator, tally.ballsFaced * tally.ballsBowled, 3);
}

export async function buildCareer(
  player: PlayerRow & { team_name: string },
): Promise<Career> {
  const rows = await playerMatches(player.id);
  let matches = 0;
  let innings = 0;
  let notOuts = 0;
  let runs = 0;
  let balls = 0;
  let fours = 0;
  let sixes = 0;
  let highScore = -1;
  let highNotOut = false;
  let bowlLegalBalls = 0;
  let bowlRuns = 0;
  let wickets = 0;
  let best: { wickets: number; runs: number } | null = null;

  for (const row of rows) {
    const computed = await loadComputedMatch(row);
    if (!isFinished(computed) || !hasBallLog(computed)) continue;
    matches += 1;
    for (const played of computed.played) {
      if (played.plan.superOver) continue;
      const batting = played.computed.batters.find((batter) => batter.player === player.id);
      if (batting) {
        innings += 1;
        const out = batting.out !== null;
        if (!out) notOuts += 1;
        runs += batting.runs;
        balls += batting.balls;
        fours += batting.fours;
        sixes += batting.sixes;
        if (batting.runs > highScore || (batting.runs === highScore && !out && !highNotOut)) {
          highScore = batting.runs;
          highNotOut = !out;
        }
      }
      const bowling = played.computed.bowlers.find((bowler) => bowler.player === player.id);
      if (bowling) {
        bowlLegalBalls += bowling.legalBalls;
        bowlRuns += bowling.runs;
        wickets += bowling.wickets;
        if (
          bowling.wickets > 0 &&
          (!best ||
            bowling.wickets > best.wickets ||
            (bowling.wickets === best.wickets && bowling.runs < best.runs))
        ) {
          best = { wickets: bowling.wickets, runs: bowling.runs };
        }
      }
    }
  }

  const dismissals = innings - notOuts;
  return {
    player: {
      id: player.id,
      name: player.name,
      short_name: player.short_name,
      team: { id: player.team_id, name: player.team_name },
    },
    batting: {
      matches,
      innings,
      not_outs: notOuts,
      runs,
      high_score: highScore < 0 ? '-' : `${highScore}${highNotOut ? '*' : ''}`,
      average: dismissals > 0 ? ratioFixed(runs, dismissals, 2) : '-',
      strike_rate: ratioFixed(runs * 100, balls, 2),
      fours,
      sixes,
    },
    bowling: {
      overs: oversText(bowlLegalBalls),
      runs: bowlRuns,
      wickets,
      best: best ? `${best.wickets}/${best.runs}` : '-',
      economy: ratioFixed(bowlRuns * 6, bowlLegalBalls, 2),
    },
  };
}
