import type { CommentaryItem, DeliveryItem, Extra, WicketKind } from '../shared/types.js';
import { isLegalDelivery } from '../shared/laws.js';
import {
  chipText,
  deliveryLine,
  dismissalText,
  overEndLine,
  retirementLine,
} from '../shared/messages.js';

export interface PlayerRef {
  id: string;
  name: string;
  short_name: string;
}

export interface WicketInput {
  kind: WicketKind;
  fielder: string | null;
  batter_out: 'striker' | 'non-striker';
  new_batter: string | null;
}

export type BallEvent =
  | { t: 'over'; bowler: string }
  | { t: 'delivery'; extra: Extra; runs: number; wicket: WicketInput | null }
  | { t: 'retirement'; batter: string; new_batter: string };

export interface InningsInput {
  key: string;
  battingTeamName: string;
  battingXI: PlayerRef[];
  bowlingXI: PlayerRef[];
  striker: string;
  nonStriker: string;
  events: BallEvent[];
  oversQuota: number;
  target: number | null;
  superOver: boolean;
  overLimit: number;
}

export interface BatterStat {
  player: string;
  name: string;
  short_name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  out: { kind: WicketKind; fielder: string | null; bowler: string } | null;
  retired: boolean;
  order: number;
}

export interface BowlerStat {
  player: string;
  name: string;
  short_name: string;
  legalBalls: number;
  completedOvers: number;
  maidens: number;
  runs: number;
  wickets: number;
  wides: number;
  noBalls: number;
}

export interface OverState {
  number: number;
  bowler: string;
  legalBalls: number;
  teamRuns: number;
  chargedRuns: number;
  chips: string[];
  complete: boolean;
}

export interface FowEntry {
  w: number;
  runs: number;
  short: string;
  label: string;
}

export interface InningsComputed {
  key: string;
  battingTeamName: string;
  battingXI: PlayerRef[];
  bowlingXI: PlayerRef[];
  runs: number;
  wickets: number;
  legalBalls: number;
  extras: { b: number; lb: number; w: number; nb: number };
  batters: BatterStat[];
  bowlers: BowlerStat[];
  commentary: CommentaryItem[];
  deliveries: DeliveryItem[];
  overs: OverState[];
  fow: FowEntry[];
  thisOver: string[];
  freeHit: boolean;
  striker: string | null;
  nonStriker: string | null;
  needsBowler: boolean;
  currentBowler: string | null;
  yetToBat: { player: string; short_name: string; retired_hurt: boolean }[];
  ended: boolean;
  allOut: boolean;
  target: number | null;
  oversQuota: number;
  superOver: boolean;
  overLimit: number;
  lastSeq: number;
  eventCount: number;
  deliveryCount: number;
}

export function overLimitFor(overs: number): number {
  return Math.ceil(overs / 5);
}

export function teamRunsOf(extra: Extra, runs: number): number {
  return extra === 'wide' || extra === 'no-ball' ? 1 + runs : runs;
}

export function batRunsOf(extra: Extra, runs: number): number {
  return extra === 'none' || extra === 'no-ball' ? runs : 0;
}

export function chargedRunsOf(extra: Extra, runs: number): number {
  if (extra === 'none') return runs;
  if (extra === 'wide' || extra === 'no-ball') return 1 + runs;
  return 0;
}

export function extraRunsOf(extra: Extra, runs: number): number {
  switch (extra) {
    case 'none':
      return 0;
    case 'wide':
      return 1 + runs;
    case 'no-ball':
      return 1;
    default:
      return runs;
  }
}

export function replayInnings(input: InningsInput): InningsComputed {
  const byId = new Map<string, PlayerRef>();
  for (const p of input.battingXI) byId.set(p.id, p);
  for (const p of input.bowlingXI) byId.set(p.id, p);
  const short = (id: string): string => byId.get(id)?.short_name ?? '';

  const batters = new Map<string, BatterStat>();
  const battingOrder: string[] = [];
  const bowlers = new Map<string, BowlerStat>();
  const bowlingOrder: string[] = [];
  const overs: OverState[] = [];
  const commentary: CommentaryItem[] = [];
  const deliveries: DeliveryItem[] = [];
  const fow: FowEntry[] = [];

  const comeIn = (id: string): void => {
    const player = byId.get(id);
    if (!player) return;
    const existing = batters.get(id);
    if (existing) {
      existing.retired = false;
      return;
    }
    batters.set(id, {
      player: id,
      name: player.name,
      short_name: player.short_name,
      runs: 0,
      balls: 0,
      fours: 0,
      sixes: 0,
      out: null,
      retired: false,
      order: battingOrder.length,
    });
    battingOrder.push(id);
  };

  const bowlerStat = (id: string): BowlerStat => {
    let stat = bowlers.get(id);
    if (!stat) {
      const player = byId.get(id);
      stat = {
        player: id,
        name: player?.name ?? '',
        short_name: player?.short_name ?? '',
        legalBalls: 0,
        completedOvers: 0,
        maidens: 0,
        runs: 0,
        wickets: 0,
        wides: 0,
        noBalls: 0,
      };
      bowlers.set(id, stat);
      bowlingOrder.push(id);
    }
    return stat;
  };

  let striker = input.striker;
  let nonStriker = input.nonStriker;
  comeIn(striker);
  comeIn(nonStriker);

  let runs = 0;
  let wickets = 0;
  let legalBalls = 0;
  const extras = { b: 0, lb: 0, w: 0, nb: 0 };
  let freeHit = false;
  let seq = 0;
  let allOut = false;
  let ended = false;
  let eventCount = 0;

  const available = (): string[] => {
    const waiting = input.battingXI.filter((p) => !batters.has(p.id)).map((p) => p.id);
    const returning = input.battingXI.filter((p) => batters.get(p.id)?.retired).map((p) => p.id);
    return [...waiting, ...returning];
  };

  const swap = (): void => {
    const held = striker;
    striker = nonStriker;
    nonStriker = held;
  };

  for (const event of input.events) {
    eventCount += 1;
    if (event.t === 'over') {
      overs.push({
        number: overs.length + 1,
        bowler: event.bowler,
        legalBalls: 0,
        teamRuns: 0,
        chargedRuns: 0,
        chips: [],
        complete: false,
      });
      bowlerStat(event.bowler);
      continue;
    }
    if (event.t === 'retirement') {
      const batter = batters.get(event.batter);
      if (batter) batter.retired = true;
      comeIn(event.new_batter);
      if (striker === event.batter) striker = event.new_batter;
      else nonStriker = event.new_batter;
      commentary.push({
        kind: 'retirement',
        player: event.batter,
        line: retirementLine(short(event.batter)),
      });
      continue;
    }

    const over = overs[overs.length - 1];
    const bowler = bowlerStat(over.bowler);
    const legal = isLegalDelivery(event.extra);
    const ball = over.legalBalls + 1;
    const label = `${overs.length - 1}.${ball}`;
    const strikerAtDelivery = striker;
    const nonStrikerAtDelivery = nonStriker;
    const freeHitHere = freeHit;
    seq += 1;

    const teamRuns = teamRunsOf(event.extra, event.runs);
    const batRuns = batRunsOf(event.extra, event.runs);
    const charged = chargedRunsOf(event.extra, event.runs);
    const extraRuns = extraRunsOf(event.extra, event.runs);

    runs += teamRuns;
    if (legal) legalBalls += 1;
    switch (event.extra) {
      case 'wide':
        extras.w += 1 + event.runs;
        break;
      case 'no-ball':
        extras.nb += 1;
        break;
      case 'bye':
        extras.b += event.runs;
        break;
      case 'leg-bye':
        extras.lb += event.runs;
        break;
      default:
        break;
    }

    const batter = batters.get(strikerAtDelivery);
    if (batter) {
      batter.runs += batRuns;
      if (event.extra !== 'wide') batter.balls += 1;
      if (event.extra === 'none' || event.extra === 'no-ball') {
        if (event.runs === 4) batter.fours += 1;
        if (event.runs === 6) batter.sixes += 1;
      }
    }

    bowler.runs += charged;
    if (legal) bowler.legalBalls += 1;
    if (event.extra === 'wide') bowler.wides += 1;
    if (event.extra === 'no-ball') bowler.noBalls += 1;

    over.teamRuns += teamRuns;
    over.chargedRuns += charged;
    if (legal) over.legalBalls += 1;
    over.chips.push(chipText({ extra: event.extra, runs: event.runs, wicket: event.wicket !== null }));

    let dismissal: string | null = null;
    if (event.wicket) {
      wickets += 1;
      const outPlayer =
        event.wicket.batter_out === 'non-striker' ? nonStrikerAtDelivery : strikerAtDelivery;
      const fielderShort = event.wicket.fielder ? short(event.wicket.fielder) : null;
      dismissal = dismissalText({
        kind: event.wicket.kind,
        fielder: fielderShort,
        bowler: short(over.bowler),
      });
      const outStat = batters.get(outPlayer);
      if (outStat) outStat.out = { kind: event.wicket.kind, fielder: fielderShort, bowler: short(over.bowler) };
      if (event.wicket.kind !== 'run-out') bowler.wickets += 1;
      fow.push({ w: wickets, runs, short: short(outPlayer), label });

      if (event.runs % 2 === 1) swap();

      const waiting = available();
      if (input.superOver ? wickets >= 2 : waiting.length === 0) {
        allOut = true;
      } else if (event.wicket.new_batter) {
        const incoming = event.wicket.new_batter;
        comeIn(incoming);
        if (striker === outPlayer) striker = incoming;
        else nonStriker = incoming;
      }
    } else if (event.runs % 2 === 1) {
      swap();
    }

    const item: DeliveryItem = {
      kind: 'delivery',
      seq,
      over: overs.length,
      ball,
      label,
      runs: teamRuns,
      bat_runs: batRuns,
      extra: event.extra,
      extra_runs: extraRuns,
      wicket: event.wicket ? event.wicket.kind : 'none',
      free_hit: freeHitHere,
      striker: strikerAtDelivery,
      bowler: over.bowler,
      line: deliveryLine({
        label,
        bowler: short(over.bowler),
        striker: short(strikerAtDelivery),
        extra: event.extra,
        runs: event.runs,
        dismissal,
        freeHit: freeHitHere,
      }),
    };
    deliveries.push(item);
    commentary.push(item);

    if (event.extra === 'no-ball') freeHit = true;
    else if (freeHitHere && event.extra === 'wide') freeHit = true;
    else freeHit = false;

    if (over.legalBalls === 6) {
      over.complete = true;
      bowler.completedOvers += 1;
      if (over.chargedRuns === 0) bowler.maidens += 1;
      swap();
      commentary.push({
        kind: 'over-end',
        over: over.number,
        line: overEndLine({
          over: over.number,
          runsInOver: over.teamRuns,
          team: input.battingTeamName,
          runs,
          wickets,
        }),
      });
    }

    if (input.target !== null && runs >= input.target) ended = true;
    else if (allOut) ended = true;
    else if (legalBalls >= input.oversQuota * 6) ended = true;
    if (ended) break;
  }

  const lastOverWithBall = [...overs].reverse().find((over) => over.chips.length > 0);
  const currentOver = overs[overs.length - 1] ?? null;
  const needsBowler = !ended && (currentOver === null || currentOver.complete);

  const yetToBat = [
    ...input.battingXI.filter((p) => !batters.has(p.id)).map((p) => ({
      player: p.id,
      short_name: p.short_name,
      retired_hurt: false,
    })),
    ...input.battingXI
      .filter((p) => batters.get(p.id)?.retired)
      .map((p) => ({ player: p.id, short_name: p.short_name, retired_hurt: true })),
  ];

  return {
    key: input.key,
    battingTeamName: input.battingTeamName,
    battingXI: input.battingXI,
    bowlingXI: input.bowlingXI,
    runs,
    wickets,
    legalBalls,
    extras,
    batters: battingOrder.map((id) => batters.get(id)!),
    bowlers: bowlingOrder.map((id) => bowlers.get(id)!),
    commentary,
    deliveries,
    overs,
    fow,
    thisOver: lastOverWithBall ? [...lastOverWithBall.chips] : [],
    freeHit,
    striker: ended ? null : striker,
    nonStriker: ended ? null : nonStriker,
    needsBowler,
    currentBowler: currentOver ? currentOver.bowler : null,
    yetToBat,
    ended,
    allOut,
    target: input.target,
    oversQuota: input.oversQuota,
    superOver: input.superOver,
    overLimit: input.overLimit,
    lastSeq: seq,
    eventCount,
    deliveryCount: deliveries.length,
  };
}
