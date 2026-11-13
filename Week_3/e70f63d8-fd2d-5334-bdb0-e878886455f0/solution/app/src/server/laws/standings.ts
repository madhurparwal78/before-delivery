import { BALLS_PER_OVER } from '../../shared/rules.js';
import type { TableRow } from '../../shared/wire.js';
import type { MatchView, Totals } from './match.js';
import { decideMain, levelResult, mainMaxWickets } from './match.js';
import type { Side } from './types.js';

const WIN_POINTS = 2;
const TIE_POINTS = 1;

/** What a finished group match contributes to points and net run rate (super overs left out). */
export interface MatchFacts {
  home: string;
  away: string;
  winner: string | null;
  innings: { batting: string; bowling: string; runs: number; balls: number }[];
}

interface SummaryInnings extends Totals { allOut: boolean }
export interface Summary { first: SummaryInnings; second: SummaryInnings; winner: string | null }

/** A side bowled out counts as having faced its full quota of overs. */
const ballsFaced = (allOut: boolean, balls: number, overs: number): number => (allOut ? overs * BALLS_PER_OVER : balls);

/** The facts of a match played ball by ball; null until it has a result. */
export const factsOf = (view: MatchView): MatchFacts | null => {
  if (view.result === null) return null;
  const innings = view.played.filter((played) => played.plan.superNumber === 0).map((played) => ({
    batting: played.plan.battingTeam.id,
    bowling: played.plan.bowlingTeam.id,
    runs: played.replay.runs,
    balls: ballsFaced(played.replay.allOut, played.replay.legalBalls, view.spec.overs),
  }));
  return { home: view.spec.home.id, away: view.spec.away.id, winner: view.result.winner, innings };
};

/** The result text and facts of a seeded summary-only match, by the same result rule as a played one. */
export const summaryFacts = (
  summary: Summary, home: Side, away: Side, battingFirst: string, overs: number, playersPerSide: number,
): { facts: MatchFacts; result: string } => {
  const first = battingFirst === home.id ? home : away;
  const second = first.id === home.id ? away : home;
  const one = { ...summary.first, team: first.id, name: first.name };
  const two = { ...summary.second, team: second.id, name: second.name };
  const outcome = decideMain(one, two, overs, mainMaxWickets(playersPerSide));
  const level = levelResult(summary.winner === null ? null : summary.winner === home.id ? home : away);
  const decided = outcome.kind !== 'level' ? { text: outcome.text, winner: outcome.winner } : level;
  return {
    result: decided.text,
    facts: {
      home: home.id, away: away.id, winner: decided.winner,
      innings: [
        { batting: first.id, bowling: second.id, runs: summary.first.runs, balls: ballsFaced(summary.first.allOut, summary.first.balls, overs) },
        { batting: second.id, bowling: first.id, runs: summary.second.runs, balls: ballsFaced(summary.second.allOut, summary.second.balls, overs) },
      ],
    },
  };
};

interface Ledger {
  id: string;
  name: string;
  p: number;
  w: number;
  l: number;
  t: number;
  pts: number;
  runsFor: number;
  ballsFaced: number;
  runsAgainst: number;
  ballsBowled: number;
}

/** Net run rate as an exact fraction: runs per over scored minus runs per over conceded. */
const netRunRateOf = (ledger: Ledger): { num: bigint; den: bigint } => {
  if (ledger.ballsFaced === 0 || ledger.ballsBowled === 0) return { num: 0n, den: 1n };
  const faced = BigInt(ledger.ballsFaced);
  const bowled = BigInt(ledger.ballsBowled);
  return { num: BigInt(BALLS_PER_OVER) * (BigInt(ledger.runsFor) * bowled - BigInt(ledger.runsAgainst) * faced), den: faced * bowled };
};

const compareFractions = (a: { num: bigint; den: bigint }, b: { num: bigint; den: bigint }): number => {
  const left = a.num * b.den;
  const right = b.num * a.den;
  return left === right ? 0 : left > right ? 1 : -1;
};

/** Rounds half away from zero to three decimals, with a sign on non-zero values. */
const netRunRateText = (value: { num: bigint; den: bigint }): string => {
  const negative = value.num < 0n;
  const magnitude = negative ? -value.num : value.num;
  const thousandths = (2n * magnitude * 1000n + value.den) / (2n * value.den);
  if (thousandths === 0n) return '0.000';
  const text = `${thousandths / 1000n}.${String(thousandths % 1000n).padStart(3, '0')}`;
  return `${negative ? '-' : '+'}${text}`;
};

const meetings = (facts: MatchFacts[], a: string, b: string): number => {
  let balance = 0;
  for (const match of facts) {
    const played = (match.home === a && match.away === b) || (match.home === b && match.away === a);
    if (played && match.winner === a) balance += 1;
    if (played && match.winner === b) balance -= 1;
  }
  return balance;
};

/** One group's table: points, then wins, then net run rate, then head-to-head, then name. */
export const groupTable = (teams: { id: string; name: string }[], facts: MatchFacts[]): TableRow[] => {
  const ledgers: Record<string, Ledger> = Object.fromEntries(teams.map((team) => [team.id, {
    id: team.id, name: team.name, p: 0, w: 0, l: 0, t: 0, pts: 0, runsFor: 0, ballsFaced: 0, runsAgainst: 0, ballsBowled: 0,
  }]));
  for (const match of facts) {
    for (const side of [ledgers[match.home], ledgers[match.away]]) {
      side.p += 1;
      if (match.winner === null) { side.t += 1; side.pts += TIE_POINTS; }
      else if (match.winner === side.id) { side.w += 1; side.pts += WIN_POINTS; }
      else side.l += 1;
    }
    for (const innings of match.innings) {
      ledgers[innings.batting].runsFor += innings.runs;
      ledgers[innings.batting].ballsFaced += innings.balls;
      ledgers[innings.bowling].runsAgainst += innings.runs;
      ledgers[innings.bowling].ballsBowled += innings.balls;
    }
  }
  const standings = Object.values(ledgers).map((ledger) => ({ ledger, netRunRate: netRunRateOf(ledger) }));
  const byKeys = (a: typeof standings[number], b: typeof standings[number]): number =>
    b.ledger.pts - a.ledger.pts || b.ledger.w - a.ledger.w || compareFractions(b.netRunRate, a.netRunRate);
  const sorted = standings.sort((a, b) => byKeys(a, b) || a.ledger.name.localeCompare(b.ledger.name, 'en'));
  const groups: { lead: typeof standings[number]; members: typeof standings }[] = [];
  for (const entry of sorted) {
    const group = groups[groups.length - 1];
    if (group && byKeys(group.lead, entry) === 0) group.members.push(entry);
    else groups.push({ lead: entry, members: [entry] });
  }
  const ordered = groups.flatMap(({ members }) =>
    members.length === 2 && meetings(facts, members[0].ledger.id, members[1].ledger.id) < 0 ? [members[1], members[0]] : members);
  return ordered.map(({ ledger, netRunRate }) => ({
    team: { id: ledger.id, name: ledger.name }, p: ledger.p, w: ledger.w, l: ledger.l, t: ledger.t, pts: ledger.pts,
    nrr: netRunRateText(netRunRate),
  }));
};
