import type { Db } from "./db.js";
import { replayInnings, type Extra, type LogEntry, type WicketKind } from "./laws.js";
import { copy } from "./copy.js";
import { config } from "./config.js";

export type MatchStatus = "ready" | "innings_1" | "innings_break" | "innings_2" | "super_over_break" | "super_over" | "result" | "tied";

export interface PlayerRow {
  id: string;
  team_id: string;
  name: string;
  short_name: string;
  batting_order: number;
}

export interface TeamRow {
  id: string;
  name: string;
  organiser_id: string;
  logo_key: string | null;
  logo_upload_count: number;
}

export interface InningsRow {
  id: string;
  match_id: string;
  label: string;
  batting_team_id: string;
  bowling_team_id: string;
  striker: string | null;
  non_striker: string | null;
  bowler: string | null;
  super_over_number: number;
  started_at: string | null;
  ended: boolean;
  seq: number;
}

export interface MatchRow {
  id: string;
  organiser_id: string;
  home_team_id: string;
  away_team_id: string;
  tournament_id: string | null;
  overs: number;
  players_per_side: number;
  super_over: boolean;
  batting_first: string;
  viewer_link: boolean;
  viewer_code: string;
  status: string;
  result: string | null;
  played_on: string | null;
  summary_first_runs: number | null;
  summary_first_wickets: number | null;
  summary_first_balls: number | null;
  summary_first_all_out: boolean | null;
  summary_second_runs: number | null;
  summary_second_wickets: number | null;
  summary_second_balls: number | null;
  summary_second_all_out: boolean | null;
  summary_winner: string | null;
}

export interface LoadedMatch {
  match: MatchRow;
  home: TeamRow;
  away: TeamRow;
  xi: Map<string, PlayerRow[]>; // team id -> players in batting order
  players: Map<string, PlayerRow>;
  inningsList: InningsRow[];
  deliveries: Map<string, DeliveryRow[]>;
  retirements: Map<string, RetirementRow[]>;
  overStarts: Map<string, { over_number: number; bowler: string }[]>;
}

export interface DeliveryRow {
  seq: number;
  striker: string;
  bowler: string;
  extra: string;
  runs: number;
  wicket_kind: string | null;
  wicket_fielder: string | null;
  wicket_batter_out: string | null;
  wicket_new_batter: string | null;
}

export interface RetirementRow {
  seq: number;
  batter: string;
  new_batter: string;
}

export const loadMatch = async (db: Db, matchId: string): Promise<LoadedMatch | null> => {
  const matchRows = await db.query<MatchRow>(
    `SELECT * FROM matches WHERE id = $1`,
    [matchId],
  );
  if (matchRows.length === 0) return null;
  const match = matchRows[0];
  const teamRows = await db.query<TeamRow>(`SELECT * FROM teams WHERE id = ANY($1)`, [[match.home_team_id, match.away_team_id]]);
  const home = teamRows.find((t) => t.id === match.home_team_id)!;
  const away = teamRows.find((t) => t.id === match.away_team_id)!;
  const xiRows = await db.query<PlayerRow>(
    `SELECT p.* FROM match_xi x JOIN players p ON p.id = x.player_id WHERE x.match_id = $1 ORDER BY x.team_id, x.batting_order`,
    [matchId],
  );
  const xi = new Map<string, PlayerRow[]>();
  const players = new Map<string, PlayerRow>();
  for (const p of xiRows) {
    if (!xi.has(p.team_id)) xi.set(p.team_id, []);
    xi.get(p.team_id)!.push(p);
    players.set(p.id, p);
  }
  const inningsRows = await db.query<InningsRow>(
    `SELECT * FROM innings WHERE match_id = $1 ORDER BY seq`,
    [matchId],
  );
  const deliveries = new Map<string, DeliveryRow[]>();
  const retirements = new Map<string, RetirementRow[]>();
  const overStarts = new Map<string, { over_number: number; bowler: string }[]>();
  for (const inn of inningsRows) {
    const ds = await db.query<DeliveryRow>(
      `SELECT seq, striker, bowler, extra, runs, wicket_kind, wicket_fielder, wicket_batter_out, wicket_new_batter
       FROM deliveries WHERE innings_id = $1 ORDER BY seq`,
      [inn.id],
    );
    deliveries.set(inn.id, ds);
    const rs = await db.query<RetirementRow>(
      `SELECT seq, batter, new_batter FROM retirements WHERE innings_id = $1 ORDER BY seq`,
      [inn.id],
    );
    retirements.set(inn.id, rs);
    const os = await db.query<{ over_number: number; bowler: string }>(
      `SELECT over_number, bowler FROM over_starts WHERE innings_id = $1 ORDER BY over_number`,
      [inn.id],
    );
    overStarts.set(inn.id, os);
  }
  return { match, home, away, xi, players, inningsList: inningsRows, deliveries, retirements, overStarts };
};

// The innings list in play order: match innings then super overs.
export const inningsOrder = (rows: InningsRow[]): InningsRow[] =>
  [...rows].sort((a, b) => {
    const keyOf = (r: InningsRow): number => (r.super_over_number === 0 ? (r.label === "1" ? 0 : 1) : 2 + (r.super_over_number - 1) * 2 + (r.label.endsWith("-1") ? 0 : 1));
    return keyOf(a) - keyOf(b);
  });

export const specOf = (loaded: { match: MatchRow; home: TeamRow; away: TeamRow }, inn: InningsRow, battingXi: string[], bowlingXi: string[]): {
  innings: string;
  batting_team: string;
  batting_team_id: string;
  bowling_team: string;
  bowling_team_id: string;
  super_over_number: number;
  overs_quota: number;
  max_wickets: number;
  batting_xi: string[];
  bowling_xi: string[];
} => ({
  innings: inn.label,
  batting_team: teamNameOf(loaded, inn.batting_team_id),
  batting_team_id: inn.batting_team_id,
  bowling_team: teamNameOf(loaded, inn.bowling_team_id),
  bowling_team_id: inn.bowling_team_id,
  super_over_number: inn.super_over_number,
  overs_quota: inn.super_over_number === 0 ? loaded.match.overs : 1,
  max_wickets: inn.super_over_number === 0 ? loaded.match.players_per_side - 1 : Math.min(2, loaded.match.players_per_side - 1),
  batting_xi: battingXi,
  bowling_xi: bowlingXi,
});

export const entriesOf = (loaded: LoadedMatch, inn: InningsRow): LogEntry[] => {
  const deliveries = loaded.deliveries.get(inn.id) ?? [];
  const retirements = loaded.retirements.get(inn.id) ?? [];
  const all: LogEntry[] = [
    ...deliveries.map((d): LogEntry => ({
      kind: "delivery",
      seq: d.seq,
      delivery: {
        seq: d.seq,
        over: 0,
        ball: 0,
        striker: d.striker,
        bowler: d.bowler,
        extra: d.extra as Extra,
        runs: d.runs,
        wicket: d.wicket_kind
          ? {
              kind: d.wicket_kind as WicketKind,
              fielder: d.wicket_fielder,
              batter_out: (d.wicket_batter_out as "striker" | "non-striker") ?? "striker",
              new_batter: d.wicket_new_batter,
            }
          : null,
      },
    })),
    ...retirements.map((r): LogEntry => ({ kind: "retirement", seq: r.seq, retirement: { batter: r.batter, new_batter: r.new_batter } })),
  ];
  return all.sort((a, b) => a.seq - b.seq);
};

export interface ComputedInnings {
  innings: InningsRow;
  replay: ReturnType<typeof replayInnings>;
  target: number | undefined;
}

export interface ComputedMatch {
  status: MatchStatus;
  innings: InningsRow[];
  current: InningsRow | null;
  previous: InningsRow | null;
  first: InningsRow | null;
  second: InningsRow | null;
  superOverNumber: number;
  replays: Map<string, ReturnType<typeof replayInnings>>;
  firstRuns: number | null;
  firstWickets: number | null;
  firstLegalBalls: number | null;
  result: string | null;
  target: number | null;
}

export const computeMatch = (loaded: LoadedMatch): ComputedMatch => {
  const { match, xi, players } = loaded;
  const list = inningsOrder(loaded.inningsList);
  const replays = new Map<string, ReturnType<typeof replayInnings>>();

  let firstInn: InningsRow | null = null;
  let secondInn: InningsRow | null = null;
  let firstRuns: number | null = null;
  let firstWickets: number | null = null;
  let firstLegalBalls: number | null = null;
  let target: number | null = null;
  const superOvers = list.filter((i) => i.super_over_number > 0);
  const superOverNumber = superOvers.length > 0 ? superOvers[superOvers.length - 1].super_over_number : 0;

  let status: MatchStatus = "ready";
  let result: string | null = match.result;

  for (const inn of list) {
    const battingXi = (xi.get(inn.batting_team_id) ?? []).map((p) => p.id);
    const bowlingXi = (xi.get(inn.bowling_team_id) ?? []).map((p) => p.id);
    const spec = specOf(loaded, inn, battingXi, bowlingXi);
    const entries = entriesOf(loaded, inn);
    const isSecondOfPair = inn.label === "2" || inn.label.endsWith("-2");
    // A chase ends when it reaches its target: the match's for innings 2, the
    // first half's total plus one for a super over's second half.
    let chaseTarget: number | null = null;
    if (isSecondOfPair) {
      if (inn.super_over_number === 0) {
        chaseTarget = target;
      } else {
        const firstHalf = list.find((i) => i.super_over_number === inn.super_over_number && i.label.endsWith("-1"));
        const firstHalfReplay = firstHalf ? replays.get(firstHalf.id) : undefined;
        if (firstHalfReplay) chaseTarget = firstHalfReplay.runs + 1;
      }
    }
    const replay = replayInnings(
      spec,
      entries,
      new Map([...players].map(([id, p]) => [id, { short_name: p.short_name, name: p.name }])),
      chaseTarget !== null ? { target: chaseTarget } : {},
    );
    // An innings with no log yet still has its opening batters.
    if (entries.length === 0 && inn.striker && inn.non_striker) {
      const sf = replay.batters.get(inn.striker);
      const nf = replay.batters.get(inn.non_striker);
      if (sf) {
        sf.came_in = 1;
      }
      if (nf) {
        nf.came_in = 2;
      }
      replay.striker = inn.striker;
      replay.non_striker = inn.non_striker;
      const j = replay.yet_to_bat.indexOf(inn.non_striker);
      if (j >= 0) replay.yet_to_bat.splice(j, 1);
    }
    replays.set(inn.id, replay);
    if (inn.label === "1") {
      firstInn = inn;
      firstRuns = replay.runs;
      firstWickets = replay.wickets;
      firstLegalBalls = replay.legal_balls;
      target = replay.runs + 1;
    }
    if (inn.label === "2") secondInn = inn;
  }

  const started = list.length > 0;
  const current = started ? list[list.length - 1] : null;
  const previous = list.length > 1 ? list[list.length - 2] : null;
  const currentReplay = current ? replays.get(current.id) : undefined;

  if (!started) {
    status = "ready";
  } else if (result !== null) {
    status = "result";
  } else {
    const lastReplay = currentReplay!;
    const isSuperOver = current!.super_over_number > 0;
    if (lastReplay.innings_ended) {
      const isSecondHalf = current!.label === "2" || current!.label.endsWith("-2");
      if (isSuperOver) {
        // decide the super over
        const firstHalf = list.find((i) => i.super_over_number === current!.super_over_number && i.label.endsWith("-1"))!;
        const firstHalfReplay = replays.get(firstHalf.id)!;
        if (isSecondHalf && lastReplay.runs !== firstHalfReplay.runs) {
          const winner = lastReplay.runs > firstHalfReplay.runs ? current!.batting_team_id : firstHalf.batting_team_id;
          const winnerName = winner === loaded.home.id ? loaded.home.name : loaded.away.name;
          result = copy.resultSuperOver(winnerName);
          status = "result";
        } else if (isSecondHalf && lastReplay.runs === firstHalfReplay.runs) {
          if (current!.super_over_number >= config.superOverMax) {
            result = copy.resultTiedAfterSuperOvers(current!.super_over_number);
            status = "tied";
          } else {
            status = "super_over_break";
          }
        } else if (!isSecondHalf) {
          status = "super_over_break";
        }
      } else if (current!.label === "1") {
        status = "innings_break";
      } else if (current!.label === "2") {
        const chaseRuns = lastReplay.runs;
        if (chaseRuns >= target!) {
          const ballsLeft = match.overs * 6 - lastReplay.legal_balls;
          const wicketsInHand = match.players_per_side - 1 - lastReplay.wickets;
          const winnerName = teamName(loaded, current!.batting_team_id);
          result = copy.resultChasingWins(winnerName, wicketsInHand, ballsLeft);
          status = "result";
        } else if (chaseRuns === firstRuns! && lastReplay.ended_reason !== "target") {
          if (match.super_over) {
            status = "super_over_break";
          } else {
            result = copy.resultTied;
            status = "tied";
          }
        } else {
          const winnerName = teamName(loaded, current!.bowling_team_id);
          result = copy.resultDefendingWins(winnerName, firstRuns! - chaseRuns);
          status = "result";
        }
      }
    } else {
      status = isSuperOver ? "super_over" : current!.label === "1" ? "innings_1" : "innings_2";
    }
  }

  return {
    status,
    innings: list,
    current,
    previous,
    first: firstInn,
    second: secondInn,
    superOverNumber,
    replays,
    firstRuns,
    firstWickets,
    firstLegalBalls,
    result,
    target,
  };
};

const teamNameOf = (loaded: { home: TeamRow; away: TeamRow }, teamId: string): string =>
  teamId === loaded.home.id ? loaded.home.name : loaded.away.name;

export const teamName = (loaded: LoadedMatch, teamId: string): string =>
  teamId === loaded.home.id ? loaded.home.name : loaded.away.name;

export const teamOf = (loaded: LoadedMatch, teamId: string): TeamRow =>
  teamId === loaded.home.id ? loaded.home : loaded.away;
