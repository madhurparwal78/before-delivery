import { economyText, oversText, strikeRateText } from "./laws.js";
import {
  inningsOrder,
  teamName,
  type ComputedMatch,
  type LoadedMatch,
} from "./match.js";
import { matchJsonOf } from "./state.js";

// The scorecard always reconciles with the ball log.

export interface ScorecardInnings {
  innings: string;
  heading: string;
  batting: {
    player: string;
    name: string;
    dismissal: string;
    runs: number;
    balls: number;
    fours: number;
    sixes: number;
    strike_rate: string;
  }[];
  extras: { b: number; lb: number; w: number; nb: number; total: number; text: string };
  total_text: string;
  did_not_bat: string[];
  fall_of_wickets: string;
  bowling: {
    player: string;
    name: string;
    overs: string;
    maidens: number;
    runs: number;
    wickets: number;
    wides: number;
    no_balls: number;
    economy: string;
  }[];
}

export interface ScorecardJson {
  match: ReturnType<typeof matchJsonOf>;
  innings: ScorecardInnings[];
  result: string | null;
}

export const buildScorecard = (loaded: LoadedMatch, computed: ComputedMatch): ScorecardJson => {
  const inningsJson: ScorecardInnings[] = [];
  const order = inningsOrder(loaded.inningsList);
  for (const inn of order) {
    const replay = computed.replays.get(inn.id);
    if (!replay) continue;
    const battingName = teamName(loaded, inn.batting_team_id);
    const heading =
      inn.super_over_number === 0
        ? `${battingName} innings`
        : `Super over ${inn.super_over_number}: ${battingName}`;

    const batters = [...replay.batters.values()]
      .filter((b) => b.came_in > 0 || b.runs > 0 || b.balls > 0)
      .sort((a, b) => a.came_in - b.came_in)
      .map((b) => {
        const p = loaded.players.get(b.player)!;
        return {
          player: b.player,
          name: p.name,
          dismissal: b.dismissal,
          runs: b.runs,
          balls: b.balls,
          fours: b.fours,
          sixes: b.sixes,
          strike_rate: strikeRateText(b.runs, b.balls),
        };
      });

    const extrasTotal = replay.extras.b + replay.extras.lb + replay.extras.w + replay.extras.nb;
    const extras = {
      ...replay.extras,
      total: extrasTotal,
      text: `Extras ${extrasTotal} (b ${replay.extras.b}, lb ${replay.extras.lb}, w ${replay.extras.w}, nb ${replay.extras.nb})`,
    };

    const allOut = replay.ended_reason === "all-out";
    const totalText = allOut
      ? `Total ${replay.runs} all out (${oversText(replay.legal_balls)} ov)`
      : `Total ${replay.runs}/${replay.wickets} (${oversText(replay.legal_balls)} ov)`;

    const didNotBat = [...replay.yet_to_bat].map((id) => loaded.players.get(id)?.short_name ?? id);

    const fow =
      replay.fow.length === 0
        ? "Fall of wickets: none"
        : `Fall of wickets: ${replay.fow
            .map((f) => `${f.wicket}-${f.runs} (${loaded.players.get(f.player)?.short_name ?? f.player}, ${f.label})`)
            .join(", ")}`;

    const bowling = [...replay.bowlers.values()].map((b) => {
      const p = loaded.players.get(b.player)!;
      return {
        player: b.player,
        name: p.name,
        overs: oversText(b.legal_balls),
        maidens: b.maidens,
        runs: b.runs,
        wickets: b.wickets,
        wides: b.wides,
        no_balls: b.no_balls,
        economy: economyText(b.runs, b.legal_balls),
      };
    });

    inningsJson.push({
      innings: inn.super_over_number === 0 ? inn.label : `so${inn.super_over_number}-${inn.label.endsWith("-1") ? "1" : "2"}`,
      heading,
      batting: batters,
      extras,
      total_text: totalText,
      did_not_bat: didNotBat,
      fall_of_wickets: fow,
      bowling,
    });
  }

  return {
    match: matchJsonOf(loaded, computed.status),
    innings: inningsJson,
    result: computed.result,
  };
};
