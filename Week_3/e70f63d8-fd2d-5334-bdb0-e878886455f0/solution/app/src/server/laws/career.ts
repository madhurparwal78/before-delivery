import { BALLS_PER_OVER } from '../../shared/rules.js';
import type { Career } from '../../shared/wire.js';
import { oversText, ratio } from './format.js';
import type { MatchView } from './match.js';
import type { Player, Side } from './types.js';

interface Tally {
  matches: number; innings: number; notOuts: number; runs: number; balls: number; fours: number; sixes: number;
  highScore: number; highScoreNotOut: boolean;
  legalBalls: number; conceded: number; wickets: number; bestWickets: number; bestRuns: number;
}

/** A player's career from the finished matches that have a ball log; super overs are left out. */
export const careerOf = (player: Player, team: Side, views: MatchView[]): Career => {
  const tally: Tally = {
    matches: 0, innings: 0, notOuts: 0, runs: 0, balls: 0, fours: 0, sixes: 0, highScore: -1, highScoreNotOut: false,
    legalBalls: 0, conceded: 0, wickets: 0, bestWickets: 0, bestRuns: 0,
  };
  for (const view of views) {
    if (view.result === null) continue;
    const sides = [view.spec.home, view.spec.away];
    if (!sides.some((side) => side.xi.some((candidate) => candidate.id === player.id))) continue;
    tally.matches += 1;
    for (const { plan, replay } of view.played) {
      if (plan.superNumber > 0) continue;
      const row = replay.battingOrder.find((candidate) => candidate.player.id === player.id);
      if (row) {
        const notOut = row.dismissal === null;
        tally.innings += 1;
        tally.notOuts += notOut ? 1 : 0;
        tally.runs += row.runs;
        tally.balls += row.balls;
        tally.fours += row.fours;
        tally.sixes += row.sixes;
        if (row.runs > tally.highScore) { tally.highScore = row.runs; tally.highScoreNotOut = notOut; }
      }
      const bowled = replay.bowlers.find((candidate) => candidate.player.id === player.id);
      if (bowled) {
        tally.legalBalls += bowled.legalBalls;
        tally.conceded += bowled.runs;
        tally.wickets += bowled.wickets;
        if (bowled.wickets > tally.bestWickets || (bowled.wickets === tally.bestWickets && bowled.wickets > 0 && bowled.runs < tally.bestRuns)) {
          tally.bestWickets = bowled.wickets;
          tally.bestRuns = bowled.runs;
        }
      }
    }
  }
  return {
    player: { id: player.id, name: player.name, short_name: player.shortName, team: { id: team.id, name: team.name } },
    batting: {
      matches: tally.matches, innings: tally.innings, not_outs: tally.notOuts, runs: tally.runs,
      high_score: tally.highScore < 0 ? '-' : `${tally.highScore}${tally.highScoreNotOut ? '*' : ''}`,
      average: ratio(tally.runs, tally.innings - tally.notOuts), strike_rate: ratio(tally.runs * 100, tally.balls),
      fours: tally.fours, sixes: tally.sixes,
    },
    bowling: {
      overs: oversText(tally.legalBalls), runs: tally.conceded, wickets: tally.wickets,
      best: tally.bestWickets === 0 ? '-' : `${tally.bestWickets}/${tally.bestRuns}`, economy: ratio(tally.conceded * BALLS_PER_OVER, tally.legalBalls),
    },
  };
};
