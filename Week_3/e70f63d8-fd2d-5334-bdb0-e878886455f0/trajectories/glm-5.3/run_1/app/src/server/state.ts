import {
  chipOf,
  figuresText,
  oversText,
  rate2,
  runRateText,
} from "./laws.js";
import { copy } from "./copy.js";
import {
  teamName,
  teamOf,
  type ComputedMatch,
  type InningsRow,
  type LoadedMatch,
} from "./match.js";

// Builds the published state and scorecard bodies. Every value derives from the replay.

export interface TeamJson {
  id: string;
  name: string;
  logo_url: string | null;
}

export interface MatchJson {
  id: string;
  title: string;
  status: string;
  overs: number;
  players_per_side: number;
  super_over: boolean;
  home: TeamJson;
  away: TeamJson;
  played_on: string | null;
}

export interface BatterJson {
  player: string;
  short_name: string;
  runs: number;
  balls: number;
  on_strike: boolean;
  text: string;
}

export interface BowlerJson {
  player: string;
  short_name: string;
  figures: string;
  text: string;
}

export interface ChaseJson {
  target: number;
  need: number;
  balls_left: number;
  required_rate: string;
  text: string;
}

export interface CommentaryJson {
  kind: "delivery" | "over-end" | "retirement";
  seq?: number;
  over?: number;
  ball?: number;
  label?: string;
  runs?: number;
  bat_runs?: number;
  extra?: string;
  extra_runs?: number;
  wicket?: string | null;
  free_hit?: boolean;
  striker?: string;
  bowler?: string;
  player?: string;
  line: string;
}

export interface StateJson {
  match: MatchJson;
  innings: string | null;
  batting_team: TeamJson | null;
  bowling_team: TeamJson | null;
  runs: number;
  wickets: number;
  legal_balls: number;
  overs_text: string;
  scoreboard: string;
  batters: BatterJson[];
  bowler: BowlerJson | null;
  next_bowler_needed: boolean;
  barred_bowlers: { player: string; reason: "consecutive" | "limit" | "super-over" }[];
  free_hit: boolean;
  run_rate: string;
  chase: ChaseJson | null;
  this_over: string[];
  commentary: CommentaryJson[];
  yet_to_bat: { player: string; short_name: string; retired_hurt: boolean }[];
  innings_break: { heading: string; text: string } | null;
  result: string | null;
  last_seq: number;
}

const logoUrl = (team: { id: string; logo_key: string | null }): string | null =>
  team.logo_key ? `/api/teams/${team.id}/logo` : null;

export const teamJsonOf = (team: { id: string; name: string; logo_key: string | null }): TeamJson => ({
  id: team.id,
  name: team.name,
  logo_url: logoUrl(team),
});

export const matchJsonOf = (loaded: LoadedMatch, status: string): MatchJson => ({
  id: loaded.match.id,
  title: `${loaded.home.name} v ${loaded.away.name}`,
  status,
  overs: loaded.match.overs,
  players_per_side: loaded.match.players_per_side,
  super_over: loaded.match.super_over,
  home: teamJsonOf(loaded.home),
  away: teamJsonOf(loaded.away),
  played_on: loaded.match.played_on,
});

const inningsLabelValue = (inn: InningsRow): string =>
  inn.super_over_number === 0 ? inn.label : `so${inn.super_over_number}-${inn.label.endsWith("-1") ? "1" : "2"}`;

export const buildState = (loaded: LoadedMatch, computed: ComputedMatch): StateJson => {
  const { match } = loaded;
  const current = computed.current;
  const replay = current ? computed.replays.get(current.id) : undefined;
  const status = computed.status;

  // Before the first innings starts, the scoreboard names the side batting first at 0/0.
  const battingTeamId =
    current ? current.batting_team_id : match.batting_first;
  const battingTeam = teamOf(loaded, battingTeamId);
  const bowlingTeam = teamOf(loaded, battingTeamId === loaded.home.id ? loaded.away.id : loaded.home.id);

  const runs = replay ? replay.runs : 0;
  const wickets = replay ? replay.wickets : 0;
  const legalBalls = replay ? replay.legal_balls : 0;
  const oversTextValue = oversText(legalBalls);

  const strikerId = replay?.striker ?? null;
  const nonStrikerId = replay?.non_striker ?? null;
  const batters: BatterJson[] = [strikerId, nonStrikerId]
    .filter((id): id is string => id !== null)
    .map((id) => {
      const f = replay!.batters.get(id)!;
      const p = loaded.players.get(id)!;
      return {
        player: id,
        short_name: p.short_name,
        runs: f.runs,
        balls: f.balls,
        on_strike: id === strikerId,
        text: `${p.short_name}${id === strikerId ? "*" : ""} ${f.runs} (${f.balls})`,
      };
    });

  // Bowler: the current one, or the last one between overs.
  let bowlerJson: BowlerJson | null = null;
  if (replay) {
    let bowlerId: string | null = null;
    const overStarts = loaded.overStarts.get(current!.id) ?? [];
    const overNumber = Math.floor(legalBalls / 6) + 1;
    if (overStarts.length > 0) {
      const relevant = overStarts.filter((o) => o.over_number === overNumber);
      if (relevant.length > 0) bowlerId = relevant[relevant.length - 1].bowler;
      else bowlerId = overStarts[overStarts.length - 1].bowler;
    }
    if (bowlerId === null && replay.over_bowlers.length > 0) bowlerId = replay.over_bowlers[replay.over_bowlers.length - 1];
    if (bowlerId !== null && replay.bowlers.has(bowlerId)) {
      const bf = replay.bowlers.get(bowlerId)!;
      const p = loaded.players.get(bowlerId)!;
      const figures = figuresText(bf.legal_balls, bf.maidens, bf.runs, bf.wickets);
      bowlerJson = { player: bowlerId, short_name: p.short_name, figures, text: `${p.short_name} ${figures}` };
    }
  }

  // Next bowler: needed when an over is due and the state is in an innings.
  const overStarts = current ? loaded.overStarts.get(current.id) ?? [] : [];
  const overNumber = Math.floor(legalBalls / 6) + 1;
  const nextBowlerNeeded =
    current !== null &&
    replay !== undefined &&
    !replay.innings_ended &&
    overStarts.find((o) => o.over_number === overNumber) === undefined &&
    !(legalBalls % 6 === 0 && overStarts.find((o) => o.over_number === overNumber - 1) !== undefined && overStarts.length > 0 && legalBalls > 0 && overStarts[overStarts.length - 1].over_number === overNumber - 1 && legalBalls % 6 === 0 && overStarts.length >= overNumber);

  const bowlingXiiPlayers = current ? loaded.xi.get(current.bowling_team_id) ?? [] : [];
  const shortOf = (id: string): string => loaded.players.get(id)?.short_name ?? id;

  const barred: { player: string; reason: "consecutive" | "limit" | "super-over" }[] = [];
  if (current && replay && nextBowlerNeeded) {
    const lastBowler = overStarts.length > 0 ? overStarts[overStarts.length - 1].bowler : null;
    const limit = Math.ceil((current.super_over_number === 0 ? match.overs : 1) / 5);
    for (const p of bowlingXiiPlayers) {
      const bf = replay.bowlers.get(p.id);
      if (lastBowler === p.id) barred.push({ player: p.id, reason: "consecutive" });
      else if (bf && current.super_over_number === 0 && Math.floor(bf.legal_balls / 6) >= limit)
        barred.push({ player: p.id, reason: "limit" });
    }
  }
  if (current && current.super_over_number > 1 && replay) {
    const previousSuperOver = computed.innings.find(
      (i) => i.super_over_number === current.super_over_number - 1 && i.label.endsWith("-1"),
    );
    if (previousSuperOver) {
      const prevReplay = computed.replays.get(previousSuperOver.id);
      if (prevReplay) {
        for (const p of bowlingXiiPlayers) {
          if (prevReplay.over_bowlers.includes(p.id)) barred.push({ player: p.id, reason: "super-over" });
        }
      }
    }
  }

  // Chase line
  let chase: ChaseJson | null = null;
  const isSecondHalf =
    current !== null && (current.label === "2" || current.label.endsWith("-2"));
  if (isSecondHalf && replay) {
    const quotaBalls = (current!.super_over_number === 0 ? match.overs : 1) * 6;
    const target = current!.super_over_number === 0 ? (computed.firstRuns ?? 0) + 1 : superOverTarget(computed, current!);
    const need = Math.max(0, target - replay.runs);
    const ballsLeft = quotaBalls - replay.legal_balls;
    const requiredRate = ballsLeft === 0 ? "-" : rate2((need * 6) / ballsLeft);
    chase = {
      target,
      need,
      balls_left: ballsLeft,
      required_rate: requiredRate,
      text: copy.chaseText(need, ballsLeft, requiredRate),
    };
  }

  // This over chips: the over in progress, or the last over once it is complete.
  let thisOver: string[] = [];
  if (replay) {
    const deliveryItems = replay.commentary.filter((c) => c.kind === "delivery");
    const overEnds = replay.commentary.filter((c) => c.kind === "over-end");
    const lastOverEnd = overEnds.length > 0 ? overEnds[overEnds.length - 1].over : 0;
    const overJustEnded = replay.legal_balls % 6 === 0 && lastOverEnd > 0;
    const showOver = overJustEnded ? lastOverEnd : Math.floor(legalBalls / 6) + 1;
    thisOver = deliveryItems
      .filter((c) => c.over === showOver)
      .map((c) => chipOf({ extra: c.extra!, runs: c.runs!, wicket: null }, c.runs!));
  }

  // Commentary newest first
  const commentary: CommentaryJson[] = replay
    ? [...replay.commentary].reverse().map((c) => ({ ...c }))
    : [];

  const yetToBat = replay
    ? [...replay.yet_to_bat, ...replay.retired_hurt].map((id) => ({
        player: id,
        short_name: shortOf(id),
        retired_hurt: replay.retired_hurt.includes(id),
      }))
    : (loaded.xi.get(battingTeamId) ?? []).slice(2).map((p) => ({ player: p.id, short_name: p.short_name, retired_hurt: false }));

  // Innings break
  let inningsBreak: { heading: string; text: string } | null = null;
  if (status === "innings_break" || status === "super_over_break") {
    const ended = replay!;
    const battingName = teamName(loaded, current!.batting_team_id);
    if (current!.super_over_number === 0 && current!.label === "1") {
      const chasing = teamName(loaded, current!.bowling_team_id);
      const allOut = ended.ended_reason === "all-out";
      const total = allOut ? `${ended.runs} all out` : `${ended.runs}/${ended.wickets}`;
      const balls = match.overs * 6;
      inningsBreak = {
        heading: copy.inningsBreakHeading,
        text: `${battingName} ${total} (${oversText(ended.legal_balls)} ov). ${chasing} need ${ended.runs + 1} ${ended.runs + 1 === 1 ? "run" : "runs"} from ${balls} ${balls === 1 ? "ball" : "balls"}.`,
      };
    } else if (current!.super_over_number === 0 && current!.label === "2") {
      // The match is level: a super over follows when it is on.
      inningsBreak = {
        heading: copy.superOverBreakHeading(1),
        text: copy.superOverStartText(teamName(loaded, current!.batting_team_id), 1),
      };
    } else if (current!.super_over_number > 0) {
      const isSecondHalf = current!.label.endsWith("-2");
      const heading = copy.superOverBreakHeading(current!.super_over_number);
      if (isSecondHalf) {
        const firstHalf = computed.innings.find((i) => i.super_over_number === current!.super_over_number && i.label.endsWith("-1"))!;
        const firstHalfReplay = computed.replays.get(firstHalf.id)!;
        const allOut = ended.ended_reason === "all-out";
        const total = allOut ? `${ended.runs} all out` : `${ended.runs}/${ended.wickets}`;
        const chasing = teamName(loaded, current!.bowling_team_id);
        const balls = 6 - ended.legal_balls;
        const needTarget = firstHalfReplay.runs + 1 - ended.runs;
        inningsBreak = {
          heading,
          text: `${battingName} ${total} (${oversText(ended.legal_balls)} ov). ${chasing} need ${needTarget} ${needTarget === 1 ? "run" : "runs"} from ${balls} ${balls === 1 ? "ball" : "balls"}.`,
        };
      } else {
        // First half ended: level again or starting a new super over
        const nextSuperOver = current!.super_over_number + 1;
        const battingFirst = teamName(loaded, current!.bowling_team_id);
        inningsBreak = {
          heading,
          text: copy.superOverStartText(battingFirst, nextSuperOver),
        };
      }
    }
  }

  const scoreboard = `${battingTeam.name} ${runs}/${wickets} (${oversTextValue} ov)`;

  return {
    match: matchJsonOf(loaded, status),
    innings: current ? inningsLabelValue(current) : null,
    batting_team: teamJsonOf(battingTeam),
    bowling_team: teamJsonOf(bowlingTeam),
    runs,
    wickets,
    legal_balls: legalBalls,
    overs_text: oversTextValue,
    scoreboard,
    batters,
    bowler: bowlerJson,
    next_bowler_needed: nextBowlerNeeded,
    barred_bowlers: barred,
    free_hit: replay ? replay.free_hit : false,
    run_rate: replay ? `Run rate ${runRateText(runs, legalBalls)}` : `Run rate -`,
    chase,
    this_over: thisOver,
    commentary,
    yet_to_bat: yetToBat,
    innings_break: inningsBreak,
    result: computed.result,
    last_seq: replay ? replay.last_seq ?? 0 : 0,
  };
};

const superOverTarget = (computed: ComputedMatch, current: InningsRow): number => {
  const firstHalf = computed.innings.find(
    (i) => i.super_over_number === current.super_over_number && i.label.endsWith("-1"),
  );
  if (!firstHalf) return 1;
  const replay = computed.replays.get(firstHalf.id);
  return replay ? replay.runs + 1 : 1;
};
