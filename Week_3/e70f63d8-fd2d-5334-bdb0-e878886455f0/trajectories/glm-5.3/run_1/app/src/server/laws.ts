// One laws engine decides every rule by replaying a ball log. The browser only renders.

export type Extra = "none" | "wide" | "no-ball" | "bye" | "leg-bye";
export type WicketKind = "bowled" | "caught" | "lbw" | "stumped" | "hit-wicket" | "run-out";

export interface Delivery {
  seq: number;
  over: number;
  ball: number; // legal ball number this delivery belongs to
  striker: string;
  bowler: string;
  extra: Extra;
  runs: number; // the `n` of the delivery table
  wicket: null | {
    kind: WicketKind;
    fielder: string | null;
    batter_out: "striker" | "non-striker";
    new_batter: string | null;
  };
}

export interface InningsSpec {
  innings: string; // "1", "2", "so1-1", ...
  batting_team: string; // the batting team's name
  batting_team_id: string;
  bowling_team: string;
  bowling_team_id: string;
  super_over_number: number; // 0 for match innings
  overs_quota: number; // overs in this innings (1 for a super over)
  max_wickets: number;
  batting_xi: string[];
  bowling_xi: string[];
}

export interface LogEntry {
  kind: "delivery" | "retirement";
  seq: number;
  delivery?: Delivery;
  retirement?: { batter: string; new_batter: string };
}

export interface BatterFigures {
  player: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  out: boolean;
  retired_hurt: boolean;
  came_in: number; // order batters came in
  dismissal: string; // "not out", "retired hurt", or dismissal text
  came_back_after_retirement: boolean;
}

export interface BowlerFigures {
  player: string;
  legal_balls: number;
  maidens: number;
  runs: number;
  wickets: number;
  wides: number;
  no_balls: number;
}

export interface FowEntry {
  wicket: number;
  runs: number;
  player: string;
  label: string;
}

export interface CommentaryItem {
  kind: "delivery" | "over-end" | "retirement";
  seq?: number;
  over: number;
  ball?: number;
  label?: string;
  runs?: number;
  bat_runs?: number;
  extra?: Extra;
  extra_runs?: number;
  wicket?: string | null;
  free_hit?: boolean;
  striker?: string;
  bowler?: string;
  player?: string;
  line: string;
}

export interface Replay {
  runs: number;
  wickets: number;
  legal_balls: number;
  batters: Map<string, BatterFigures>;
  striker: string | null;
  non_striker: string | null;
  bowlers: Map<string, BowlerFigures>;
  over_bowlers: string[];
  commentary: CommentaryItem[];
  extras: { b: number; lb: number; w: number; nb: number };
  fow: FowEntry[];
  yet_to_bat: string[];
  retired_hurt: string[];
  innings_ended: boolean;
  ended_reason: "quota" | "all-out" | "target" | null;
  last_seq: number | null;
  free_hit: boolean;
  over_runs: Map<number, number>;
}

export const roundHalfAwayFromZero = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  const scaled = Math.abs(value) * factor;
  const rounded = Math.floor(scaled + 0.5) / factor;
  return value < 0 ? -rounded : rounded;
};

export const rate2 = (value: number): string => {
  if (!Number.isFinite(value)) return "-";
  const v = roundHalfAwayFromZero(value, 2);
  return v.toFixed(2);
};

export const rate3signed = (value: number): string => {
  const v = roundHalfAwayFromZero(value, 3);
  return `${v > 0 ? "+" : v < 0 ? "-" : ""}${Math.abs(v).toFixed(3)}`;
};

export const oversText = (legalBalls: number): string => {
  const completed = Math.floor(legalBalls / 6);
  const balls = legalBalls % 6;
  if (balls === 0) return `${completed}`;
  return `${completed}.${balls}`;
};

export const figuresText = (legalBalls: number, maidens: number, runs: number, wickets: number): string =>
  `${oversText(legalBalls)}-${maidens}-${runs}-${wickets}`;

export const runRateText = (runs: number, legalBalls: number): string =>
  legalBalls === 0 ? "-" : rate2((runs * 6) / legalBalls);

export const strikeRateText = (runs: number, balls: number): string =>
  balls === 0 ? "-" : rate2((runs * 100) / balls);

export const economyText = (runs: number, legalBalls: number): string =>
  legalBalls === 0 ? "-" : rate2((runs * 6) / legalBalls);

const runsWording = (n: number): string =>
  n === 0 ? "no run" : n === 1 ? "1 run" : n === 4 ? "FOUR" : n === 6 ? "SIX" : `${n} runs`;

export const runsPart = (extra: Extra, runs: number): string => {
  switch (extra) {
    case "none":
      return runsWording(runs);
    case "wide":
      return `${1 + runs} ${runs === 0 ? "wide" : "wides"}`;
    case "no-ball":
      return `no-ball, ${runsWording(runs)}`;
    case "bye":
      return `${runs} ${runs === 1 ? "bye" : "byes"}`;
    case "leg-bye":
      return `${runs} ${runs === 1 ? "leg bye" : "leg byes"}`;
  }
};

export const isLegal = (extra: Extra): boolean => extra === "none" || extra === "bye" || extra === "leg-bye";

export const teamRunsOf = (d: Pick<Delivery, "extra" | "runs">): number => {
  switch (d.extra) {
    case "none":
    case "bye":
    case "leg-bye":
      return d.runs;
    case "wide":
    case "no-ball":
      return 1 + d.runs;
  }
};

export const extraRunsOf = (d: Pick<Delivery, "extra" | "runs">): number => {
  switch (d.extra) {
    case "none":
      return 0;
    case "wide":
      return 1 + d.runs;
    case "no-ball":
      return 1;
    case "bye":
    case "leg-bye":
      return d.runs;
  }
};

export const extrasBucketOf = (d: Pick<Delivery, "extra" | "runs">): { key: "b" | "lb" | "w" | "nb"; value: number } | null => {
  switch (d.extra) {
    case "bye":
      return { key: "b", value: d.runs };
    case "leg-bye":
      return { key: "lb", value: d.runs };
    case "wide":
      return { key: "w", value: 1 + d.runs };
    case "no-ball":
      return { key: "nb", value: 1 };
    default:
      return null;
  }
};

export const chargedToBowler = (d: Pick<Delivery, "extra" | "runs">): number => {
  switch (d.extra) {
    case "none":
      return d.runs;
    case "wide":
    case "no-ball":
      return 1 + d.runs;
    case "bye":
    case "leg-bye":
      return 0;
  }
};

export const batRunsOf = (d: Pick<Delivery, "extra" | "runs">): number =>
  d.extra === "none" || d.extra === "no-ball" ? d.runs : 0;

export const ballsFacedOf = (d: Pick<Delivery, "extra">): number => (d.extra === "wide" ? 0 : 1);

export const allowedWicketsOn = (extra: Extra, freeHit: boolean): readonly WicketKind[] => {
  if (freeHit) return ["run-out"];
  switch (extra) {
    case "none":
      return ["bowled", "caught", "lbw", "stumped", "hit-wicket", "run-out"];
    case "wide":
      return ["stumped", "run-out"];
    default:
      return ["run-out"];
  }
};

export const dismissalText = (
  kind: WicketKind,
  bowlerShort: string,
  fielderShort: string | null,
): string => {
  switch (kind) {
    case "bowled":
      return `b ${bowlerShort}`;
    case "caught":
      return fielderShort === bowlerShort ? `c & b ${bowlerShort}` : `c ${fielderShort} b ${bowlerShort}`;
    case "lbw":
      return `lbw b ${bowlerShort}`;
    case "stumped":
      return `st ${fielderShort} b ${bowlerShort}`;
    case "hit-wicket":
      return `hit wicket b ${bowlerShort}`;
    case "run-out":
      return `run out (${fielderShort})`;
  }
};

export const chipOf = (d: Pick<Delivery, "extra" | "runs" | "wicket">, teamRuns: number): string => {
  let base: string;
  switch (d.extra) {
    case "none":
      base = `${d.runs}`;
      break;
    case "wide":
      base = `${teamRuns}wd`;
      break;
    case "no-ball":
      base = `${teamRuns}nb`;
      break;
    case "bye":
      base = `${d.runs}b`;
      break;
    case "leg-bye":
      base = `${d.runs}lb`;
      break;
  }
  return d.wicket ? (base === "0" ? "W" : `${base}W`) : base;
};

// Replays one innings' log from the start and derives every figure from it.
export const replayInnings = (
  spec: InningsSpec,
  entries: LogEntry[],
  players: Map<string, { short_name: string; name: string }>,
  opts: { target?: number } = {},
): Replay => {
  const shorts = new Map<string, string>();
  for (const id of spec.batting_xi) {
    const p = players.get(id);
    shorts.set(id, p ? p.short_name : id);
  }
  for (const id of spec.bowling_xi) {
    const p = players.get(id);
    shorts.set(id, p ? p.short_name : id);
  }
  const short = (id: string): string => shorts.get(id) ?? id;

  const batters = new Map<string, BatterFigures>();
  for (const id of spec.batting_xi) {
    batters.set(id, {
      player: id, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, retired_hurt: false,
      came_in: 0, dismissal: "not out", came_back_after_retirement: false,
    });
  }
  const bowlers = new Map<string, BowlerFigures>();
  const commentary: CommentaryItem[] = [];
  const overBowlerList: string[] = [];
  const overRuns = new Map<number, number>();
  const overChargedRuns = new Map<number, number>();
  const fow: FowEntry[] = [];
  const retiredHurt: string[] = [];
  const extras = { b: 0, lb: 0, w: 0, nb: 0 };

  let yetToBat: string[] = spec.batting_xi.slice(2);
  let striker: string | null = null;
  let nonStriker: string | null = null;
  let runs = 0;
  let wickets = 0;
  let legalBalls = 0;
  let freeHit = false;
  let inningsEnded = false;
  let endedReason: Replay["ended_reason"] = null;
  let lastSeq: number | null = null;
  let cameCounter = 0;

  const swapEnds = (): void => {
    const t = striker;
    striker = nonStriker;
    nonStriker = t;
  };

  const enterBatter = (id: string, atStrikerEnd: boolean): void => {
    cameCounter += 1;
    const f = batters.get(id);
    if (f && f.came_in === 0) f.came_in = cameCounter;
    if (atStrikerEnd) striker = id;
    else nonStriker = id;
  };

  const takeFromWaiting = (id: string): void => {
    if (retiredHurt.includes(id)) {
      retiredHurt.splice(retiredHurt.indexOf(id), 1);
      const f = batters.get(id);
      if (f) {
        f.retired_hurt = false;
        f.dismissal = "not out";
        f.came_back_after_retirement = true;
      }
      return;
    }
    const j = yetToBat.indexOf(id);
    if (j >= 0) yetToBat.splice(j, 1);
  };

  const ensureBowler = (id: string): BowlerFigures => {
    let f = bowlers.get(id);
    if (!f) {
      f = { player: id, legal_balls: 0, maidens: 0, runs: 0, wickets: 0, wides: 0, no_balls: 0 };
      bowlers.set(id, f);
    }
    return f;
  };

  // Opening batters: the first log entry names the striker (or the retiring batter).
  let opened = false;
  const openInnings = (strikerId: string, nonStrikerId: string): void => {
    if (opened) return;
    opened = true;
    enterBatter(strikerId, true);
    enterBatter(nonStrikerId, false);
    const j = yetToBat.indexOf(nonStrikerId);
    if (j >= 0) yetToBat.splice(j, 1);
  };

  const checkEnd = (): boolean => {
    if (inningsEnded) return true;
    if (wickets >= spec.max_wickets) {
      inningsEnded = true;
      endedReason = "all-out";
      return true;
    }
    if (legalBalls >= spec.overs_quota * 6) {
      inningsEnded = true;
      endedReason = "quota";
      return true;
    }
    if (opts.target !== undefined && runs >= opts.target) {
      inningsEnded = true;
      endedReason = "target";
      return true;
    }
    return false;
  };

  for (const entry of entries) {
    if (entry.kind === "retirement") {
      const r = entry.retirement!;
      const retiredIsStriker = r.batter === striker;
      const retired = retiredIsStriker ? striker! : nonStriker!;
      if (!opened) openInnings(strikerIdFor(entries), nonStrikerIdFor(entries, spec));
      const f = batters.get(retired)!;
      f.retired_hurt = true;
      f.dismissal = "retired hurt";
      retiredHurt.push(retired);
      takeFromWaiting(r.new_batter);
      enterBatter(r.new_batter, retiredIsStriker);
      const over = Math.floor(legalBalls / 6) + 1;
      commentary.push({
        kind: "retirement", seq: entry.seq, over, player: retired,
        line: `${short(retired)} retired hurt`,
      });
      continue;
    }

    const d = entry.delivery!;
    if (!opened) openInnings(d.striker, otherOpener(d.striker, spec.batting_xi));
    lastSeq = d.seq;

    // The striker is derived by the replay, never read from the log: a change
    // to an earlier delivery flips every later one.
    const strikerOfBall = striker ?? d.striker;

    const over = Math.floor(legalBalls / 6) + 1;
    const ballOfOver = (legalBalls % 6) + 1;
    const label = `${over - 1}.${ballOfOver}`;
    const wasFreeHit: boolean = freeHit;
    const legal = isLegal(d.extra);
    const team = teamRunsOf(d);
    const batRuns = batRunsOf(d);

    runs += team;
    const bucket = extrasBucketOf(d);
    if (bucket) extras[bucket.key] += bucket.value;
    overRuns.set(over, (overRuns.get(over) ?? 0) + team);

    const sf = batters.get(strikerOfBall)!;
    sf.runs += batRuns;
    sf.balls += ballsFacedOf(d);
    if (batRuns === 4) sf.fours += 1;
    if (batRuns === 6) sf.sixes += 1;

    const bf = ensureBowler(d.bowler);
    if (!overBowlerList.includes(d.bowler)) overBowlerList.push(d.bowler);
    const charged = chargedToBowler(d);
    const overCharged = overChargedRuns.get(over) ?? 0;
    overChargedRuns.set(over, overCharged + charged);
    bf.runs += charged;
    if (d.extra === "wide") bf.wides += 1;
    if (d.extra === "no-ball") bf.no_balls += 1;
    if (legal) {
      legalBalls += 1;
      bf.legal_balls += 1;
    }
    freeHit = d.extra === "no-ball" || (wasFreeHit && d.extra === "wide");

    const w = d.wicket;
    let outSuffix = "";
    if (w) {
      const strikerOut = w.batter_out !== "non-striker";
      const outBatter = strikerOut ? strikerOfBall : nonStriker!;
      wickets += 1;
      const of = batters.get(outBatter)!;
      of.out = true;
      of.dismissal = dismissalText(w.kind, short(d.bowler), w.fielder ? short(w.fielder) : null);
      if (w.kind !== "run-out") bf.wickets += 1;
      fow.push({ wicket: wickets, runs, player: outBatter, label });
      if (w.new_batter) {
        takeFromWaiting(w.new_batter);
        if (w.kind === "run-out") {
          // Completed runs swap ends first; then the new batter takes the end
          // of the batter who is out — whichever end that is after the swap.
          if (d.runs % 2 === 1) swapEnds();
          const outAtStrikerEnd = (strikerOut && d.runs % 2 === 0) || (!strikerOut && d.runs % 2 === 1);
          enterBatter(w.new_batter, outAtStrikerEnd);
        } else {
          // The new batter comes in at the striker's end, on strike.
          enterBatter(w.new_batter, true);
        }
      } else if (strikerOut) {
        striker = null;
      } else {
        nonStriker = null;
      }
      outSuffix = `, OUT! ${of.dismissal}`;
    }

    const part = runsPart(d.extra, d.runs);
    const fhSuffix = wasFreeHit ? " (free hit)" : "";
    const line = outSuffix
      ? `${label} ${short(d.bowler)} to ${short(strikerOfBall)}${part === "no run" ? "" : `, ${part}`}${outSuffix}${fhSuffix}`
      : `${label} ${short(d.bowler)} to ${short(strikerOfBall)}, ${part}${fhSuffix}`;
    commentary.push({
      kind: "delivery", seq: d.seq, over, ball: ballOfOver, label,
      runs: team, bat_runs: batRuns, extra: d.extra, extra_runs: bucket ? bucket.value : 0,
      wicket: w ? w.kind : null, free_hit: wasFreeHit, striker: strikerOfBall, bowler: d.bowler,
      line,
    });

    // Strike rotation: odd runs swap ends; the sixth legal ball swaps again.
    // A run out already applied its completed-runs swap above.
    const wicketEndedInnings = w !== null && w.new_batter === null;
    const runOutSwapped = w !== null && w.kind === "run-out" && w.new_batter !== null && d.runs % 2 === 1;
    if (!wicketEndedInnings && !runOutSwapped && d.runs % 2 === 1) swapEnds();

    if (legal && legalBalls % 6 === 0) {
      const runsInOver = overRuns.get(over) ?? 0;
      if ((overChargedRuns.get(over) ?? 0) === 0) bf.maidens += 1;
      const teamLabel = spec.batting_team;
      commentary.push({
        kind: "over-end", over,
        line: `End of over ${over}: ${runsInOver === 1 ? "1 run" : `${runsInOver} runs`}. ${teamLabel} ${runs}/${wickets}`,
      });
      swapEnds();
    }

    if (checkEnd()) break;
  }

  return {
    runs, wickets, legal_balls: legalBalls,
    batters, striker, non_striker: nonStriker,
    bowlers, over_bowlers: overBowlerList, commentary,
    extras, fow, yet_to_bat: yetToBat, retired_hurt: retiredHurt,
    innings_ended: inningsEnded, ended_reason: endedReason,
    last_seq: lastSeq, free_hit: freeHit, over_runs: overRuns,
  };
};

const otherOpener = (strikerId: string, xi: string[]): string => {
  const idx = xi.indexOf(strikerId);
  return idx === 0 ? xi[1] : xi[0];
};

const strikerIdFor = (entries: LogEntry[]): string => {
  const first = entries[0];
  return first.kind === "retirement" ? first.retirement!.batter : first.delivery!.striker;
};

const nonStrikerIdFor = (entries: LogEntry[], spec: InningsSpec): string => {
  const first = entries[0];
  if (first.kind === "retirement") return first.retirement!.new_batter;
  return otherOpener(first.delivery!.striker, spec.batting_xi);
};
