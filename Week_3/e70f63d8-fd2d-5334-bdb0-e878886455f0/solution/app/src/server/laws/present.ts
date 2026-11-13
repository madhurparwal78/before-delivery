import { BALLS_PER_OVER } from '../../shared/rules.js';
import type {
  BattingRow, BowlingRow, ChaseState, InningsCard, MatchInfo, MatchState, Scorecard, TeamRef, YetToBat,
} from '../../shared/wire.js';
import type { InningsReplay } from './engine.js';
import { ballsPhrase, oversText, ratio } from './format.js';
import type { MatchView, PlayedInnings } from './match.js';

export interface PresentContext { matchId: string; playedOn: string | null; home: TeamRef; away: TeamRef }

const teamRef = (ctx: PresentContext, id: string): TeamRef => (ctx.home.id === id ? ctx.home : ctx.away);

const matchInfo = (view: MatchView, ctx: PresentContext): MatchInfo => ({
  id: ctx.matchId,
  title: `${ctx.home.name} v ${ctx.away.name}`,
  status: view.status,
  overs: view.spec.overs,
  players_per_side: view.spec.playersPerSide,
  super_over: view.spec.superOver,
  home: ctx.home,
  away: ctx.away,
  played_on: ctx.playedOn,
});

const chaseOf = (innings: InningsReplay): ChaseState | null => {
  const target = innings.spec.target;
  if (target === null || innings.ended) return null;
  const need = target - innings.runs;
  const ballsLeft = innings.spec.quotaBalls - innings.legalBalls;
  const requiredRate = ratio(need * BALLS_PER_OVER, ballsLeft);
  return {
    target, need, balls_left: ballsLeft, required_rate: requiredRate,
    text: `Need ${need} from ${ballsPhrase(ballsLeft)}. Required rate ${requiredRate}`,
  };
};

const yetToBatOf = (innings: InningsReplay): YetToBat[] =>
  innings.yetToBat.map((entry) => ({ player: entry.player.id, short_name: entry.player.shortName, retired_hurt: entry.retiredHurt }));

/** The state of a match as every page shows it, from the replayed views. */
export const buildState = (view: MatchView, ctx: PresentContext): MatchState => {
  const info = matchInfo(view, ctx);
  const current: PlayedInnings | undefined = view.played[view.played.length - 1];
  if (!current) {
    const batting = teamRef(ctx, view.spec.battingFirst);
    const bowling = batting.id === ctx.home.id ? ctx.away : ctx.home;
    return {
      match: info, innings: null, batting_team: batting, bowling_team: bowling, runs: 0, wickets: 0, legal_balls: 0,
      overs_text: '0', scoreboard: `${batting.name} 0/0 (0 ov)`, batters: [], bowler: null, next_bowler_needed: false,
      barred_bowlers: [], free_hit: false, run_rate: 'Run rate -', chase: null, this_over: [], commentary: [], yet_to_bat: [],
      innings_break: null, result: null, last_seq: 0,
    };
  }
  const innings = current.replay;
  const overs = oversText(innings.legalBalls);
  const atCrease = [innings.striker, innings.nonStriker].sort((a, b) => innings.battingOrder.indexOf(a) - innings.battingOrder.indexOf(b));
  const lastOver = innings.currentOver;
  const chipsOver = [...innings.overs].reverse().find((over) => over.chips.length > 0);
  const barredNext = view.next && view.status === 'super_over_break'
    ? view.next.barredBowlers.map((player) => ({ player, reason: 'super-over' as const }))
    : [];
  return {
    match: info,
    innings: current.plan.key,
    batting_team: teamRef(ctx, innings.spec.battingTeam.id),
    bowling_team: teamRef(ctx, innings.spec.bowlingTeam.id),
    runs: innings.runs,
    wickets: innings.wickets,
    legal_balls: innings.legalBalls,
    overs_text: overs,
    scoreboard: `${innings.spec.battingTeam.name} ${innings.runs}/${innings.wickets} (${overs} ov)`,
    batters: atCrease.map((row) => {
      const onStrike = row === innings.striker && innings.ended === null;
      return {
        player: row.player.id, short_name: row.player.shortName, runs: row.runs, balls: row.balls, on_strike: onStrike,
        text: `${row.player.shortName}${onStrike ? '*' : ''} ${row.runs} (${row.balls})`,
      };
    }),
    bowler: lastOver ? {
      player: lastOver.bowler.player.id, short_name: lastOver.bowler.player.shortName, figures: innings.figures(lastOver.bowler),
      text: `${lastOver.bowler.player.shortName} ${innings.figures(lastOver.bowler)}`,
    } : null,
    next_bowler_needed: innings.needsBowler,
    barred_bowlers: innings.ended === null ? innings.barredBowlers() : barredNext,
    free_hit: innings.freeHit && innings.ended === null,
    run_rate: `Run rate ${ratio(innings.runs * BALLS_PER_OVER, innings.legalBalls)}`,
    chase: chaseOf(innings),
    this_over: chipsOver ? [...chipsOver.chips] : [],
    commentary: [...innings.items].reverse(),
    yet_to_bat: yetToBatOf(innings),
    innings_break: view.inningsBreak,
    result: view.result?.text ?? null,
    last_seq: innings.lastSeq,
  };
};

const cardOf = (played: PlayedInnings): InningsCard => {
  const innings = played.replay;
  const rows: BattingRow[] = innings.battingOrder.map((row) => ({
    player: row.player.id, name: row.player.name, dismissal: row.dismissal ?? (row.retired ? 'retired hurt' : 'not out'), runs: row.runs,
    balls: row.balls, fours: row.fours, sixes: row.sixes, strike_rate: ratio(row.runs * 100, row.balls),
  }));
  const { b, lb, w, nb } = innings.extras;
  const bowling: BowlingRow[] = innings.bowlers.map((row) => ({
    player: row.player.id, name: row.player.name, overs: oversText(row.legalBalls), maidens: row.maidens, runs: row.runs,
    wickets: row.wickets, wides: row.wides, no_balls: row.noBalls, economy: ratio(row.runs * BALLS_PER_OVER, row.legalBalls),
  }));
  const fall = innings.fallOfWickets.map((entry) => `${entry.wicketNumber}-${entry.teamRuns} (${entry.short}, ${entry.label})`);
  return {
    innings: played.plan.key,
    heading: played.plan.heading,
    batting: rows,
    extras: { b, lb, w, nb, total: b + lb + w + nb, text: `Extras ${b + lb + w + nb} (b ${b}, lb ${lb}, w ${w}, nb ${nb})` },
    total_text: `Total ${innings.totalText} (${oversText(innings.legalBalls)} ov)`,
    did_not_bat: innings.spec.battingTeam.xi.filter((player) => !innings.battingOrder.some((row) => row.player === player)).map((player) => player.shortName),
    fall_of_wickets: `Fall of wickets: ${fall.length === 0 ? 'none' : fall.join(', ')}`,
    bowling,
  };
};

export const buildScorecard = (view: MatchView, ctx: PresentContext): Scorecard => ({
  match: matchInfo(view, ctx),
  innings: view.played.map(cardOf),
  result: view.result?.text ?? null,
});
