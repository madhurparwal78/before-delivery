import type {
  BarReason,
  CommentaryItem,
  MatchState,
  MatchStatus,
  Scorecard,
  ScorecardInnings,
  TeamRef,
} from '../shared/types.js';
import {
  INNINGS_BREAK_HEADING,
  RESULT_TIED,
  batterText,
  bowlerFigures,
  breakText,
  chaseText,
  dismissalText,
  DISMISSAL_NOT_OUT,
  DISMISSAL_RETIRED_HURT,
  extrasText,
  fallOfWicketsText,
  oversText,
  ratioFixed,
  resultByRuns,
  resultByWickets,
  resultSuperOver,
  resultTiedAfterSuperOvers,
  runRateText,
  scoreboardText,
  superOverHeading,
  superOverStartText,
  totalShort,
  totalText,
} from '../shared/messages.js';
import {
  type BallEvent,
  type InningsComputed,
  type PlayerRef,
  overLimitFor,
  replayInnings,
} from './engine.js';

export interface InningsRecord {
  id: string;
  key: string;
  striker: string;
  non_striker: string;
  events: BallEvent[];
}

export interface MatchInput {
  id: string;
  overs: number;
  players_per_side: number;
  super_over: boolean;
  super_over_max: number;
  home: { id: string; name: string };
  away: { id: string; name: string };
  batting_first: string;
  played_on: string | null;
  xi: Map<string, PlayerRef[]>;
  innings: InningsRecord[];
  viewer_link: boolean;
  viewer_code: string;
  has_logo: Set<string>;
  tournament_id: string | null;
  summary: MatchSummary | null;
}

export interface MatchSummary {
  first: { runs: number; wickets: number; balls: number; all_out: boolean };
  second: { runs: number; wickets: number; balls: number; all_out: boolean };
  winner: string | null;
}

export interface InningsPlan {
  key: string;
  battingTeamId: string;
  bowlingTeamId: string;
  target: number | null;
  oversQuota: number;
  superOver: boolean;
  superOverNumber: number;
  half: 1 | 2;
}

export interface PlayedInnings {
  plan: InningsPlan;
  record: InningsRecord;
  computed: InningsComputed;
}

export interface MatchComputed {
  input: MatchInput;
  played: PlayedInnings[];
  status: MatchStatus;
  result: string | null;
  breakInfo: { heading: string; text: string } | null;
  nextPlan: InningsPlan | null;
  winnerTeamId: string | null;
}

function otherTeam(input: MatchInput, teamId: string): string {
  return teamId === input.home.id ? input.away.id : input.home.id;
}

function teamName(input: MatchInput, teamId: string): string {
  return teamId === input.home.id ? input.home.name : input.away.name;
}

function planAfter(input: MatchInput, played: PlayedInnings[]): InningsPlan {
  if (played.length === 0) {
    return {
      key: '1',
      battingTeamId: input.batting_first,
      bowlingTeamId: otherTeam(input, input.batting_first),
      target: null,
      oversQuota: input.overs,
      superOver: false,
      superOverNumber: 0,
      half: 1,
    };
  }
  const last = played[played.length - 1];
  if (last.plan.key === '1') {
    const batting = otherTeam(input, last.plan.battingTeamId);
    return {
      key: '2',
      battingTeamId: batting,
      bowlingTeamId: last.plan.battingTeamId,
      target: last.computed.runs + 1,
      oversQuota: input.overs,
      superOver: false,
      superOverNumber: 0,
      half: 2,
    };
  }
  if (last.plan.half === 1 && last.plan.superOver) {
    return {
      key: `so${last.plan.superOverNumber}-2`,
      battingTeamId: last.plan.bowlingTeamId,
      bowlingTeamId: last.plan.battingTeamId,
      target: last.computed.runs + 1,
      oversQuota: 1,
      superOver: true,
      superOverNumber: last.plan.superOverNumber,
      half: 2,
    };
  }
  const number = last.plan.superOverNumber + 1;
  return {
    key: `so${number}-1`,
    battingTeamId: last.plan.battingTeamId,
    bowlingTeamId: last.plan.bowlingTeamId,
    target: null,
    oversQuota: 1,
    superOver: true,
    superOverNumber: number,
    half: 1,
  };
}

export function superOverBarred(plan: InningsPlan, played: PlayedInnings[]): string[] {
  if (!plan.superOver || plan.superOverNumber < 2) return [];
  const previous = played.find(
    (p) => p.plan.superOver && p.plan.superOverNumber === plan.superOverNumber - 1 && p.plan.bowlingTeamId === plan.bowlingTeamId,
  );
  if (!previous) return [];
  return previous.computed.bowlers.map((b) => b.player);
}

export function computeMatch(input: MatchInput): MatchComputed {
  const played: PlayedInnings[] = [];
  for (const record of input.innings) {
    const plan = planAfter(input, played);
    const battingXI = input.xi.get(plan.battingTeamId) ?? [];
    const bowlingXI = input.xi.get(plan.bowlingTeamId) ?? [];
    const computed = replayInnings({
      key: plan.key,
      battingTeamName: teamName(input, plan.battingTeamId),
      battingXI,
      bowlingXI,
      striker: record.striker,
      nonStriker: record.non_striker,
      events: record.events,
      oversQuota: plan.oversQuota,
      target: plan.target,
      superOver: plan.superOver,
      overLimit: plan.superOver ? 1 : overLimitFor(input.overs),
    });
    played.push({ plan, record, computed });
  }

  let status: MatchStatus = 'ready';
  let result: string | null = null;
  let breakInfo: { heading: string; text: string } | null = null;
  let nextPlan: InningsPlan | null = null;
  let winnerTeamId: string | null = null;

  if (played.length === 0 && input.summary) {
    const { first, second } = input.summary;
    const secondTeamId = otherTeam(input, input.batting_first);
    if (second.runs > first.runs) {
      status = 'result';
      winnerTeamId = secondTeamId;
      result = resultByWickets(
        teamName(input, secondTeamId),
        input.players_per_side - 1 - second.wickets,
        input.overs * 6 - second.balls,
      );
    } else if (second.runs < first.runs) {
      status = 'result';
      winnerTeamId = input.batting_first;
      result = resultByRuns(teamName(input, input.batting_first), first.runs - second.runs);
    } else if (input.summary.winner) {
      status = 'result';
      winnerTeamId = input.summary.winner;
      result = resultSuperOver(teamName(input, input.summary.winner));
    } else {
      status = 'tied';
      result = RESULT_TIED;
    }
  } else if (played.length === 0) {
    status = 'ready';
    nextPlan = planAfter(input, played);
  } else {
    const last = played[played.length - 1];
    if (!last.computed.ended) {
      status = last.plan.superOver ? 'super_over' : last.plan.key === '1' ? 'innings_1' : 'innings_2';
    } else if (last.plan.key === '1') {
      status = 'innings_break';
      nextPlan = planAfter(input, played);
      breakInfo = {
        heading: INNINGS_BREAK_HEADING,
        text: breakText({
          team: last.computed.battingTeamName,
          total: totalShort(last.computed.runs, last.computed.wickets, last.computed.allOut),
          overs: oversText(last.computed.legalBalls),
          chasing: teamName(input, nextPlan.battingTeamId),
          target: nextPlan.target ?? 0,
          balls: input.overs * 6,
        }),
      };
    } else if (last.plan.key === '2') {
      const target = last.plan.target ?? 0;
      if (last.computed.runs >= target) {
        status = 'result';
        winnerTeamId = last.plan.battingTeamId;
        result = resultByWickets(
          last.computed.battingTeamName,
          input.players_per_side - 1 - last.computed.wickets,
          input.overs * 6 - last.computed.legalBalls,
        );
      } else if (last.computed.runs < target - 1) {
        status = 'result';
        winnerTeamId = last.plan.bowlingTeamId;
        result = resultByRuns(teamName(input, last.plan.bowlingTeamId), target - 1 - last.computed.runs);
      } else if (input.super_over) {
        status = 'super_over_break';
        nextPlan = planAfter(input, played);
        breakInfo = {
          heading: superOverHeading(nextPlan.superOverNumber),
          text: superOverStartText(teamName(input, nextPlan.battingTeamId), nextPlan.superOverNumber),
        };
      } else {
        status = 'tied';
        result = RESULT_TIED;
      }
    } else if (last.plan.half === 1) {
      status = 'super_over_break';
      nextPlan = planAfter(input, played);
      breakInfo = {
        heading: superOverHeading(last.plan.superOverNumber),
        text: breakText({
          team: last.computed.battingTeamName,
          total: totalShort(last.computed.runs, last.computed.wickets, last.computed.allOut),
          overs: oversText(last.computed.legalBalls),
          chasing: teamName(input, nextPlan.battingTeamId),
          target: nextPlan.target ?? 0,
          balls: 6,
        }),
      };
    } else {
      const first = played[played.length - 2];
      if (last.computed.runs > first.computed.runs) {
        status = 'result';
        winnerTeamId = last.plan.battingTeamId;
        result = resultSuperOver(last.computed.battingTeamName);
      } else if (last.computed.runs < first.computed.runs) {
        status = 'result';
        winnerTeamId = first.plan.battingTeamId;
        result = resultSuperOver(first.computed.battingTeamName);
      } else if (last.plan.superOverNumber < input.super_over_max) {
        status = 'super_over_break';
        nextPlan = planAfter(input, played);
        breakInfo = {
          heading: superOverHeading(nextPlan.superOverNumber),
          text: superOverStartText(teamName(input, nextPlan.battingTeamId), nextPlan.superOverNumber),
        };
      } else {
        status = 'tied';
        result = resultTiedAfterSuperOvers(last.plan.superOverNumber);
      }
    }
  }

  return { input, played, status, result, breakInfo, nextPlan, winnerTeamId };
}

export interface ViewContext {
  logoUrl: (teamId: string) => string | null;
}

function teamRef(input: MatchInput, teamId: string, ctx: ViewContext): TeamRef {
  return { id: teamId, name: teamName(input, teamId), logo_url: ctx.logoUrl(teamId) };
}

export function matchHeader(computed: MatchComputed, ctx: ViewContext) {
  const { input } = computed;
  return {
    id: input.id,
    title: `${input.home.name} v ${input.away.name}`,
    status: computed.status,
    overs: input.overs,
    players_per_side: input.players_per_side,
    super_over: input.super_over,
    home: teamRef(input, input.home.id, ctx),
    away: teamRef(input, input.away.id, ctx),
    played_on: input.played_on,
  };
}

export function barredBowlers(computed: MatchComputed): { player: string; reason: BarReason }[] {
  const last = computed.played[computed.played.length - 1];
  if (last && last.computed.needsBowler) {
    const previousOver = [...last.computed.overs].reverse().find((over) => over.complete);
    const barred: { player: string; reason: BarReason }[] = [];
    for (const player of last.computed.bowlingXI) {
      if (previousOver && previousOver.bowler === player.id) {
        barred.push({ player: player.id, reason: 'consecutive' });
        continue;
      }
      const stat = last.computed.bowlers.find((b) => b.player === player.id);
      if (stat && stat.completedOvers >= last.computed.overLimit) {
        barred.push({ player: player.id, reason: 'limit' });
      }
    }
    return barred;
  }
  if (computed.nextPlan && computed.nextPlan.superOver) {
    return superOverBarred(computed.nextPlan, computed.played).map((player) => ({
      player,
      reason: 'super-over' as BarReason,
    }));
  }
  return [];
}

export function buildState(computed: MatchComputed, ctx: ViewContext): MatchState {
  const { input } = computed;
  const last = computed.played[computed.played.length - 1] ?? null;
  const header = matchHeader(computed, ctx);

  if (!last) {
    const battingTeamId = input.batting_first;
    return {
      match: header,
      innings: null,
      batting_team: teamRef(input, battingTeamId, ctx),
      bowling_team: teamRef(input, otherTeam(input, battingTeamId), ctx),
      runs: 0,
      wickets: 0,
      legal_balls: 0,
      overs_text: '0',
      scoreboard: scoreboardText(teamName(input, battingTeamId), 0, 0, '0'),
      batters: [],
      bowler: null,
      next_bowler_needed: false,
      barred_bowlers: [],
      free_hit: false,
      run_rate: runRateText('-'),
      chase: null,
      this_over: [],
      commentary: [],
      yet_to_bat: (input.xi.get(battingTeamId) ?? []).map((p) => ({
        player: p.id,
        short_name: p.short_name,
        retired_hurt: false,
      })),
      innings_break: null,
      result: null,
      last_seq: 0,
    };
  }

  const innings = last.computed;
  const overs = oversText(innings.legalBalls);
  const atCrease = [innings.striker, innings.nonStriker]
    .map((id) => innings.batters.find((b) => b.player === id))
    .filter((b): b is NonNullable<typeof b> => Boolean(b))
    .filter((b) => !innings.ended || (b.out === null && !b.retired));

  const bowlerStat = innings.currentBowler
    ? innings.bowlers.find((b) => b.player === innings.currentBowler) ?? null
    : null;
  const figures = bowlerStat
    ? bowlerFigures({
        overs: oversText(bowlerStat.legalBalls),
        maidens: bowlerStat.maidens,
        runs: bowlerStat.runs,
        wickets: bowlerStat.wickets,
      })
    : null;

  const ballsLeft = last.plan.oversQuota * 6 - innings.legalBalls;
  const need = (last.plan.target ?? 0) - innings.runs;
  const requiredRate = ratioFixed(need * 6, ballsLeft, 2);
  const chase =
    last.plan.target !== null && !innings.ended
      ? {
          target: last.plan.target,
          need,
          balls_left: ballsLeft,
          required_rate: requiredRate,
          text: chaseText(need, ballsLeft, requiredRate),
        }
      : null;

  const commentary: CommentaryItem[] = [...innings.commentary].reverse();

  return {
    match: header,
    innings: last.plan.key,
    batting_team: teamRef(input, last.plan.battingTeamId, ctx),
    bowling_team: teamRef(input, last.plan.bowlingTeamId, ctx),
    runs: innings.runs,
    wickets: innings.wickets,
    legal_balls: innings.legalBalls,
    overs_text: overs,
    scoreboard: scoreboardText(innings.battingTeamName, innings.runs, innings.wickets, overs),
    batters: atCrease.map((b) => ({
      player: b.player,
      short_name: b.short_name,
      runs: b.runs,
      balls: b.balls,
      on_strike: b.player === innings.striker,
      text: batterText(b.short_name, b.player === innings.striker, b.runs, b.balls),
    })),
    bowler:
      bowlerStat && figures
        ? {
            player: bowlerStat.player,
            short_name: bowlerStat.short_name,
            figures,
            text: `${bowlerStat.short_name} ${figures}`,
          }
        : null,
    next_bowler_needed: innings.needsBowler,
    barred_bowlers: barredBowlers(computed),
    free_hit: innings.ended ? false : innings.freeHit,
    run_rate: runRateText(ratioFixed(innings.runs * 6, innings.legalBalls, 2)),
    chase,
    this_over: innings.thisOver,
    commentary,
    yet_to_bat: innings.yetToBat,
    innings_break: computed.breakInfo,
    result: computed.result,
    last_seq: innings.lastSeq,
  };
}

export function inningsHeading(played: PlayedInnings): string {
  return played.plan.superOver
    ? `${superOverHeading(played.plan.superOverNumber)}: ${played.computed.battingTeamName}`
    : `${played.computed.battingTeamName} innings`;
}

export function buildScorecardInnings(played: PlayedInnings): ScorecardInnings {
  const innings = played.computed;
  const extras = {
    ...innings.extras,
    total: innings.extras.b + innings.extras.lb + innings.extras.w + innings.extras.nb,
    text: '',
  };
  extras.text = extrasText(extras);
  const dismissalFor = (batter: (typeof innings.batters)[number]): string => {
    if (batter.out) {
      return dismissalText({ kind: batter.out.kind, fielder: batter.out.fielder, bowler: batter.out.bowler });
    }
    return batter.retired ? DISMISSAL_RETIRED_HURT : DISMISSAL_NOT_OUT;
  };
  return {
    innings: played.plan.key,
    heading: inningsHeading(played),
    batting: innings.batters.map((b) => ({
      player: b.player,
      name: b.name,
      dismissal: dismissalFor(b),
      runs: b.runs,
      balls: b.balls,
      fours: b.fours,
      sixes: b.sixes,
      strike_rate: ratioFixed(b.runs * 100, b.balls, 2),
    })),
    extras,
    total_text: totalText(innings.runs, innings.wickets, innings.allOut, oversText(innings.legalBalls)),
    did_not_bat: innings.battingXI
      .filter((p) => !innings.batters.some((b) => b.player === p.id))
      .map((p) => p.short_name),
    fall_of_wickets: fallOfWicketsText(innings.fow),
    bowling: innings.bowlers.map((b) => ({
      player: b.player,
      name: b.name,
      overs: oversText(b.legalBalls),
      maidens: b.maidens,
      runs: b.runs,
      wickets: b.wickets,
      wides: b.wides,
      no_balls: b.noBalls,
      economy: ratioFixed(b.runs * 6, b.legalBalls, 2),
    })),
  };
}

export function buildScorecard(computed: MatchComputed, ctx: ViewContext): Scorecard {
  return {
    match: matchHeader(computed, ctx),
    innings: computed.played.map((played) => buildScorecardInnings(played)),
    result: computed.result,
  };
}
