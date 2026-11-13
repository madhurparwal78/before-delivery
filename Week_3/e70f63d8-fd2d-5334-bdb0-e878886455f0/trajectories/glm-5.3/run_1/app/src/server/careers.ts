import { economyText, oversText, rate2, strikeRateText } from "./laws.js";
import { copy } from "./copy.js";
import { computeMatch, loadMatch } from "./match.js";
import { err } from "./http.js";
import type { AppDeps } from "./api.js";

// Careers derive only from finished matches with a ball log, super overs left out.

export const careersJson = async (deps: AppDeps, playerId: string, viewerId: string): Promise<unknown> => {
  const player = await deps.db.query<{ id: string; name: string; short_name: string; team_id: string; organiser: string }>(
    `SELECT p.id, p.name, p.short_name, p.team_id, t.organiser_id AS organiser FROM players p JOIN teams t ON t.id = p.team_id WHERE p.id = $1`,
    [playerId],
  );
  if (player.length === 0) throw err(404, "NOT_FOUND", copy.notFound);
  const teamId = player[0].team_id;
  const owned = await deps.db.query(`SELECT 1 FROM teams WHERE id = $1 AND organiser_id = $2`, [teamId, viewerId]);
  if (owned.length === 0) {
    const scorer = await deps.db.query(
      `SELECT 1 FROM match_scorers ms JOIN matches m ON m.id = ms.match_id WHERE ms.user_id = $1 AND (m.home_team_id = $2 OR m.away_team_id = $2)`,
      [viewerId, teamId],
    );
    if (scorer.length === 0) throw err(404, "NOT_FOUND", copy.notFound);
  }
  const team = await deps.db.query<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE id = $1`, [teamId]);

  const matches = await deps.db.query<{ id: string }>(
    `SELECT m.id FROM matches m
     WHERE (m.home_team_id = $1 OR m.away_team_id = $1) AND m.result IS NOT NULL
       AND EXISTS (SELECT 1 FROM match_xi x WHERE x.match_id = m.id AND x.player_id = $2)
     ORDER BY m.created_at`,
    [teamId, playerId],
  );

  let mat = 0;
  let innings = 0;
  let notOuts = 0;
  let runs = 0;
  let balls = 0;
  let fours = 0;
  let sixes = 0;
  let highScore = 0;
  let highScoreNotOut = false;
  let hasBatting = false;
  let bowlBalls = 0;
  let bowlRuns = 0;
  let bowlWickets = 0;
  let best: { wickets: number; runs: number } | null = null;

  for (const m of matches) {
    const loaded = await loadMatch(deps.db, m.id);
    if (!loaded) continue;
    const hasLog = [...loaded.deliveries.values()].some((d) => d.length > 0);
    if (!hasLog) continue;
    mat += 1;
    const computed = computeMatch(loaded);
    for (const inn of computed.innings) {
      if (inn.super_over_number > 0) continue;
      const replay = computed.replays.get(inn.id)!;
      const battingFigures = replay.batters.get(playerId);
      if (battingFigures && (battingFigures.balls > 0 || battingFigures.runs > 0 || battingFigures.came_in > 0)) {
        innings += 1;
        runs += battingFigures.runs;
        balls += battingFigures.balls;
        fours += battingFigures.fours;
        sixes += battingFigures.sixes;
        const notOut = !battingFigures.out;
        if (notOut) notOuts += 1;
        hasBatting = true;
        if (!hasBatting || battingFigures.runs >= highScore) {
          if (battingFigures.runs > highScore || (battingFigures.runs === highScore && notOut && !highScoreNotOut)) {
            highScore = battingFigures.runs;
            highScoreNotOut = notOut;
          }
        }
      }
      const bowlFigures = replay.bowlers.get(playerId);
      if (bowlFigures && bowlFigures.legal_balls > 0) {
        bowlBalls += bowlFigures.legal_balls;
        bowlRuns += bowlFigures.runs;
        bowlWickets += bowlFigures.wickets;
        if (!best || bowlFigures.wickets > best.wickets || (bowlFigures.wickets === best.wickets && bowlFigures.runs < best.runs)) {
          best = { wickets: bowlFigures.wickets, runs: bowlFigures.runs };
        }
      }
    }
  }

  const dismissed = innings - notOuts;
  return {
    player: {
      id: player[0].id,
      name: player[0].name,
      short_name: player[0].short_name,
      team: { id: team[0].id, name: team[0].name },
    },
    batting: {
      matches: mat,
      innings,
      not_outs: notOuts,
      runs,
      high_score: `${highScore}${highScoreNotOut ? "*" : ""}`,
      average: dismissed === 0 ? "-" : rate2(runs / dismissed),
      strike_rate: balls === 0 ? "-" : strikeRateText(runs, balls),
      fours,
      sixes,
    },
    bowling: {
      overs: oversText(bowlBalls),
      runs: bowlRuns,
      wickets: bowlWickets,
      best: best === null ? "-" : `${best.wickets}/${best.runs}`,
      economy: bowlBalls === 0 ? "-" : economyText(bowlRuns, bowlBalls),
    },
  };
};
