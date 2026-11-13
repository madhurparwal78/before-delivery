import { copy } from '../../shared/copy.js';
import { BALLS_PER_OVER } from '../../shared/rules.js';
import type { MatchStatus } from '../../shared/wire.js';
import { ballsPhrase, oversText, runsPhrase, wicketsPhrase } from './format.js';
import { InningsReplay } from './engine.js';
import type { InningsPlan, LogEntry, Side } from './types.js';

const SUPER_OVER_WICKETS = 2;
const OVERS_PER_BOWLER_DIVISOR = 5;

export interface MatchSpec {
  home: Side;
  away: Side;
  overs: number;
  playersPerSide: number;
  superOver: boolean;
  superOverMax: number;
  battingFirst: string;
}

/** What is stored of one innings: who opened, and the log (opening over first). */
export interface InningsRecord { striker: string; nonStriker: string; log: LogEntry[] }

export interface PlayedInnings { plan: InningsPlan; replay: InningsReplay }
export interface MatchResult { text: string; winner: string | null }

export interface MatchView {
  spec: MatchSpec;
  played: PlayedInnings[];
  status: MatchStatus;
  result: MatchResult | null;
  inningsBreak: { heading: string; text: string } | null;
  next: InningsPlan | null;
}

export interface Totals { runs: number; wickets: number; balls: number }
type MainOutcome = { kind: 'chased' | 'defended'; winner: string; text: string } | { kind: 'level' };

/** A side has at most one wicket fewer than its players to lose. */
export const mainMaxWickets = (playersPerSide: number): number => playersPerSide - 1;

/** The result law for a two-innings match: who won, by what, or level. */
export const decideMain = (
  first: Totals & { team: string; name: string }, second: Totals & { team: string; name: string },
  overs: number, maxWickets: number,
): MainOutcome => {
  if (second.runs > first.runs) {
    const wicketsLeft = maxWickets - second.wickets;
    const ballsLeft = overs * BALLS_PER_OVER - second.balls;
    const tail = ballsLeft > 0 ? ` (${ballsLeft} ${ballsLeft === 1 ? 'ball' : 'balls'} left)` : '';
    return { kind: 'chased', winner: second.team, text: `${second.name} won by ${wicketsPhrase(wicketsLeft)}${tail}` };
  }
  if (second.runs < first.runs) {
    return { kind: 'defended', winner: first.team, text: `${first.name} won by ${runsPhrase(first.runs - second.runs)}` };
  }
  return { kind: 'level' };
};

/** A level match is a tie, unless a super over decided it. */
export const levelResult = (superOverWinner: Side | null): MatchResult =>
  superOverWinner ? { text: `${superOverWinner.name} won the super over`, winner: superOverWinner.id } : { text: 'Match tied', winner: null };

const otherSide = (spec: MatchSpec, team: Side): Side => (team.id === spec.home.id ? spec.away : spec.home);

const sideById = (spec: MatchSpec, id: string): Side => (spec.home.id === id ? spec.home : spec.away);

const bowlerOverLimit = (overs: number): number => Math.ceil(overs / OVERS_PER_BOWLER_DIVISOR);

const totalText = (innings: InningsReplay): string => `${innings.spec.battingTeam.name} ${innings.totalText} (${oversText(innings.legalBalls)} ov)`;

/** The innings that comes after those already played (the previous one must have ended). */
const planNext = (spec: MatchSpec, played: PlayedInnings[]): InningsPlan => {
  const first = sideById(spec, spec.battingFirst);
  const second = otherSide(spec, first);
  const index = played.length;
  const previous = played[index - 1];
  if (index < 2) {
    const batting = index === 0 ? first : second;
    const bowling = index === 0 ? second : first;
    return {
      key: `${index + 1}`, superNumber: 0, half: 0, battingTeam: batting, bowlingTeam: bowling,
      quotaBalls: spec.overs * BALLS_PER_OVER, bowlerOverLimit: bowlerOverLimit(spec.overs), maxWickets: mainMaxWickets(spec.playersPerSide),
      target: index === 1 ? previous.replay.runs + 1 : null, barredBowlers: [], heading: `${batting.name} innings`,
    };
  }
  const superNumber = Math.floor((index - 2) / 2) + 1;
  const half = (index - 2) % 2 === 0 ? 1 : 2;
  const firstBatting = superNumber % 2 === 1 ? second : first;
  const batting = half === 1 ? firstBatting : otherSide(spec, firstBatting);
  const bowling = otherSide(spec, batting);
  const lastBowled = superNumber > 1 ? played.find((innings) => innings.plan.superNumber === superNumber - 1 && innings.plan.bowlingTeam.id === bowling.id) : undefined;
  const barred = lastBowled?.replay.overs[0].bowler.player.id;
  return {
    key: `so${superNumber}-${half}`, superNumber, half, battingTeam: batting, bowlingTeam: bowling, quotaBalls: BALLS_PER_OVER,
    bowlerOverLimit: 1, maxWickets: Math.min(SUPER_OVER_WICKETS, spec.playersPerSide - 1),
    target: half === 2 ? previous.replay.runs + 1 : null, barredBowlers: barred ? [barred] : [],
    heading: `Super over ${superNumber}: ${batting.name}`,
  };
};

/** Scores are level: the next super over, or a tie when the last allowed one is done. */
const levelBreak = (spec: MatchSpec, played: PlayedInnings[], number: number): Pick<MatchView, 'status' | 'inningsBreak' | 'next' | 'result'> => {
  if (number > spec.superOverMax) {
    return { status: 'tied', inningsBreak: null, next: null, result: { text: `Match tied after ${spec.superOverMax} super overs`, winner: null } };
  }
  const next = planNext(spec, played);
  return {
    status: 'super_over_break',
    inningsBreak: { heading: `Super over ${number}`, text: `Scores level. ${next.battingTeam.name} bat first in super over ${number}.` },
    next, result: null,
  };
};

/** After the last played innings has ended: the status, break, result and the innings that may start next. */
const afterEnd = (spec: MatchSpec, played: PlayedInnings[], last: PlayedInnings): Pick<MatchView, 'status' | 'inningsBreak' | 'next' | 'result'> => {
  const { plan, replay } = last;
  if (plan.key === '1') {
    const chasing = planNext(spec, played);
    return {
      status: 'innings_break', result: null, next: chasing,
      inningsBreak: {
        heading: copy.inningsBreakHeading,
        text: `${totalText(replay)}. ${chasing.battingTeam.name} need ${runsPhrase(replay.runs + 1)} from ${ballsPhrase(chasing.quotaBalls)}.`,
      },
    };
  }
  if (plan.key === '2') {
    const first = played[0].replay;
    const outcome = decideMain(
      { team: first.spec.battingTeam.id, name: first.spec.battingTeam.name, runs: first.runs, wickets: first.wickets, balls: first.legalBalls },
      { team: replay.spec.battingTeam.id, name: replay.spec.battingTeam.name, runs: replay.runs, wickets: replay.wickets, balls: replay.legalBalls },
      spec.overs, plan.maxWickets,
    );
    if (outcome.kind !== 'level') return { status: 'result', inningsBreak: null, next: null, result: { text: outcome.text, winner: outcome.winner } };
    if (!spec.superOver) return { status: 'tied', inningsBreak: null, next: null, result: levelResult(null) };
    return levelBreak(spec, played, 1);
  }
  if (plan.half === 1) {
    const chasing = planNext(spec, played);
    return {
      status: 'super_over_break', result: null, next: chasing,
      inningsBreak: {
        heading: `Super over ${plan.superNumber}`,
        text: `${totalText(replay)}. ${chasing.battingTeam.name} need ${runsPhrase(replay.runs + 1)} from ${ballsPhrase(chasing.quotaBalls)}.`,
      },
    };
  }
  const opening = played[played.length - 2].replay;
  if (replay.runs !== opening.runs) {
    const winner = replay.runs > opening.runs ? plan.battingTeam : opening.spec.battingTeam;
    return { status: 'result', inningsBreak: null, next: null, result: levelResult(winner) };
  }
  return levelBreak(spec, played, plan.superNumber + 1);
};

/** Replays every innings of a match through the laws and decides where the match stands. */
export const replayMatch = (spec: MatchSpec, records: InningsRecord[]): MatchView => {
  const played: PlayedInnings[] = [];
  for (const record of records) {
    const plan = planNext(spec, played);
    const replay = new InningsReplay({ ...plan, striker: record.striker, nonStriker: record.nonStriker });
    for (const entry of record.log) replay.apply(entry);
    played.push({ plan, replay });
  }
  const last = played[played.length - 1];
  if (!last) {
    return { spec, played, status: 'ready', result: null, inningsBreak: null, next: planNext(spec, played) };
  }
  if (last.replay.ended === null) {
    const status: MatchStatus = last.plan.key === '1' ? 'innings_1' : last.plan.key === '2' ? 'innings_2' : 'super_over';
    return { spec, played, status, result: null, inningsBreak: null, next: null };
  }
  return { spec, played, ...afterEnd(spec, played, last) };
};

/** A seeded match that is only a summary: it has no innings, and its result is already decided. */
export const summarisedView = (spec: MatchSpec, result: MatchResult): MatchView => ({
  spec, played: [], status: result.winner === null ? 'tied' : 'result', result, inningsBreak: null, next: null,
});
