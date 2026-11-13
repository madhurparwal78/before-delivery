import { copy } from '../../shared/copy.js';
import { BALLS_PER_OVER, MAX_RUNS, MAX_RUN_OUT_RUNS, PENALTY_RUNS, isLegal, needsRuns, runsPart, wicketAllowed } from '../../shared/rules.js';
import type { BarReason, BarredBowler, CommentaryItem, Extra } from '../../shared/wire.js';
import { oversText, runsPhrase } from './format.js';
import type {
  BatterRow, BowlerRow, EndReason, FallOfWicket, InningsSpec, LogEntry, OverRecord, Player, Wicket,
} from './types.js';
import { LawViolation } from './types.js';

const chipOf = (extra: Extra, runs: number, hasWicket: boolean): string => {
  const base = extra === 'none' ? `${runs}`
    : extra === 'wide' ? `${runs + 1}wd`
      : extra === 'no-ball' ? `${runs + 1}nb`
        : extra === 'bye' ? `${runs}b` : `${runs}lb`;
  if (!hasWicket) return base;
  return base === '0' ? 'W' : `${base}W`;
};

const newBatter = (player: Player): BatterRow => ({ player, runs: 0, balls: 0, fours: 0, sixes: 0, dismissal: null, retired: false });

/** A batter who can come in: a player yet to bat, or a retired-hurt batter who continues their row. */
interface Entrant { player: Player; returning: BatterRow | null }

/** Replays one innings' log, entry by entry, and holds every figure derived from it. */
export class InningsReplay {
  runs = 0;
  wickets = 0;
  legalBalls = 0;
  lastSeq = 0;
  striker: BatterRow;
  nonStriker: BatterRow;
  readonly battingOrder: BatterRow[];
  readonly bowlers: BowlerRow[] = [];
  readonly overs: OverRecord[] = [];
  readonly items: CommentaryItem[] = [];
  readonly fallOfWickets: FallOfWicket[] = [];
  readonly extras = { b: 0, lb: 0, w: 0, nb: 0 };
  freeHit = false;
  ended: EndReason | null = null;
  private waiting: Player[];
  private retiredHurt: BatterRow[] = [];
  private entries = 0;
  private readonly fielding: Map<string, Player>;

  constructor(readonly spec: InningsSpec) {
    this.fielding = new Map(spec.bowlingTeam.xi.map((player) => [player.id, player]));
    const opening = spec.battingTeam.xi.filter((player) => player.id === spec.striker || player.id === spec.nonStriker);
    this.waiting = spec.battingTeam.xi.filter((player) => !opening.includes(player));
    this.battingOrder = opening.map(newBatter);
    // The openers were checked against the batting XI before the innings could start.
    this.striker = this.battingOrder.find((row) => row.player.id === spec.striker)!;
    this.nonStriker = this.battingOrder.find((row) => row.player.id === spec.nonStriker)!;
  }

  /** The over in progress, or the last one when it is complete. */
  get currentOver(): OverRecord | null {
    return this.overs.at(-1) ?? null;
  }

  get needsBowler(): boolean {
    return this.ended === null && (this.currentOver === null || this.currentOver.legalBalls === BALLS_PER_OVER);
  }

  /** Players who can still come in; empty when the next wicket would end the innings. */
  get yetToBat(): { player: Player; retiredHurt: boolean }[] {
    if (this.wickets + 1 >= this.spec.maxWickets) return [];
    return [
      ...this.waiting.map((player) => ({ player, retiredHurt: false })),
      ...this.retiredHurt.map((row) => ({ player: row.player, retiredHurt: true })),
    ];
  }

  get allOut(): boolean {
    return this.ended === 'all-out';
  }

  /** `<runs>/<wickets>`, or `<runs> all out`. */
  get totalText(): string {
    return this.allOut ? `${this.runs} all out` : `${this.runs}/${this.wickets}`;
  }

  apply(entry: LogEntry): void {
    switch (entry.kind) {
      case 'over': this.startOver(entry.bowler); break;
      case 'delivery': this.recordDelivery(entry.extra, entry.runs, entry.wicket); break;
      case 'retirement': this.retire(entry.batter, entry.newBatter); break;
    }
    this.entries += 1;
  }

  /** Bowlers who may not start the next over, with the reason. */
  barredBowlers(): BarredBowler[] {
    return this.spec.bowlingTeam.xi.flatMap((player) => {
      const reason = this.barReason(player.id);
      return reason === null ? [] : [{ player: player.id, reason }];
    });
  }

  /** Why a bowler may not start the next over; consecutive overs are checked before the limit. */
  private barReason(bowler: string): BarReason | null {
    if (this.spec.barredBowlers.includes(bowler)) return 'super-over';
    if (this.currentOver?.bowler.player.id === bowler) return 'consecutive';
    return this.completedOvers(bowler) >= this.spec.bowlerOverLimit ? 'limit' : null;
  }

  /** `<overs>-<maidens>-<runs charged>-<wickets>` for one bowler. */
  figures(row: BowlerRow): string {
    return `${oversText(row.legalBalls)}-${row.maidens}-${row.runs}-${row.wickets}`;
  }

  private violation(code: ConstructorParameters<typeof LawViolation>[0], message: string, seq: number | null = null,
    extra: { kind?: Wicket['kind']; freeHit?: boolean; fields?: Record<string, string> } = {}): LawViolation {
    return new LawViolation(code, message, this.entries, seq, extra.kind ?? null, extra.freeHit ?? false, extra.fields ?? {});
  }

  private completedOvers(bowler: string): number {
    return this.overs.filter((over) => over.bowler.player.id === bowler && over.legalBalls === BALLS_PER_OVER).length;
  }

  private swapEnds(): void {
    [this.striker, this.nonStriker] = [this.nonStriker, this.striker];
  }

  private startOver(bowler: string): void {
    if (this.ended) throw this.violation('INNINGS_OVER', copy.inningsOver);
    const open = this.currentOver;
    if (open && open.legalBalls < BALLS_PER_OVER) throw this.violation('OVER_IN_PROGRESS', copy.overInProgress);
    const player = this.fielding.get(bowler);
    if (!player) throw this.violation('VALIDATION', copy.fieldErrors, null, { fields: { bowler: copy.fieldErrors } });
    const barred = this.barReason(bowler);
    if (barred === 'super-over') throw this.violation('BOWLER_BARRED', copy.bowledLastSuperOver(player.shortName));
    if (barred === 'consecutive') throw this.violation('BOWLER_CONSECUTIVE', copy.bowledLastOver(player.shortName));
    if (barred === 'limit') throw this.violation('BOWLER_LIMIT', copy.bowlerAtLimit(player.shortName, this.spec.bowlerOverLimit));
    let row = this.bowlers.find((candidate) => candidate.player.id === bowler);
    if (!row) {
      row = { player, legalBalls: 0, maidens: 0, runs: 0, wickets: 0, wides: 0, noBalls: 0 };
      this.bowlers.push(row);
    }
    this.overs.push({ number: this.overs.length + 1, bowler: row, legalBalls: 0, teamRuns: 0, charged: 0, chips: [] });
  }

  private recordDelivery(extra: Extra, runs: number, wicket: Wicket | null): void {
    const seq = this.lastSeq + 1;
    if (this.ended) throw this.violation('INNINGS_OVER', copy.inningsOver);
    const over = this.currentOver;
    if (over === null || over.legalBalls === BALLS_PER_OVER) throw this.violation('NEEDS_BOWLER', copy.chooseBowlerFirst);
    if (!Number.isInteger(runs) || runs < 0 || runs > MAX_RUNS) {
      throw this.violation('VALIDATION', copy.fieldErrors, seq, { fields: { runs: copy.runs } });
    }
    if (needsRuns(extra) && runs < 1) throw this.violation('BYES_NEED_RUNS', copy.byesNeedRuns, seq);

    const striker = this.striker;
    const bowler = over.bowler;
    const legal = isLegal(extra);
    const teamRuns = extra === 'wide' || extra === 'no-ball' ? runs + PENALTY_RUNS : runs;
    const batRuns = extra === 'none' || extra === 'no-ball' ? runs : 0;
    const charged = extra === 'wide' || extra === 'no-ball' ? runs + PENALTY_RUNS : extra === 'none' ? runs : 0;
    const freeHit = this.freeHit;
    const ball = over.legalBalls + 1;
    const label = `${this.overs.length - 1}.${ball}`;
    const runsAfter = this.runs + teamRuns;

    const target = this.spec.target;
    const targetReached = target !== null && runsAfter >= target;
    const quotaReached = legal && this.legalBalls + 1 >= this.spec.quotaBalls;
    const dismissed = wicket === null ? null : this.dismissalOf(wicket, extra, runs, seq, freeHit, bowler.player);
    const wicketEndsInnings = dismissed !== null && this.wickets + 1 >= this.spec.maxWickets;
    const endsInnings = targetReached || quotaReached || wicketEndsInnings;
    const entrant = wicket !== null && !endsInnings ? this.entrantFor(wicket.newBatter) : null;
    if (wicket !== null && !endsInnings && entrant === null) throw this.violation('NEW_BATTER_INVALID', copy.newBatterInvalid, seq);

    if (extra !== 'wide') striker.balls += 1;
    striker.runs += batRuns;
    if (extra === 'none' || extra === 'no-ball') {
      if (batRuns === 4) striker.fours += 1;
      if (batRuns === 6) striker.sixes += 1;
    }
    this.runs = runsAfter;
    this.extras.w += extra === 'wide' ? teamRuns : 0;
    this.extras.nb += extra === 'no-ball' ? PENALTY_RUNS : 0;
    this.extras.b += extra === 'bye' ? runs : 0;
    this.extras.lb += extra === 'leg-bye' ? runs : 0;
    bowler.runs += charged;
    bowler.wides += extra === 'wide' ? 1 : 0;
    bowler.noBalls += extra === 'no-ball' ? 1 : 0;
    over.teamRuns += teamRuns;
    over.charged += charged;
    if (legal) {
      over.legalBalls += 1;
      bowler.legalBalls += 1;
      this.legalBalls += 1;
    }
    this.freeHit = extra === 'no-ball' ? true : extra === 'wide' ? freeHit : false;

    if (runs % 2 === 1 && wicket === null) this.swapEnds();
    if (dismissed !== null && wicket !== null) {
      if (wicket.kind === 'run-out' && runs % 2 === 1) this.swapEnds();
      const atStrikerEnd = this.striker === dismissed.out;
      dismissed.out.dismissal = dismissed.text;
      this.wickets += 1;
      if (wicket.kind !== 'run-out') bowler.wickets += 1;
      this.fallOfWickets.push({ wicketNumber: this.wickets, teamRuns: this.runs, short: dismissed.out.player.shortName, label });
      if (entrant) {
        const incoming = this.bringIn(entrant);
        if (atStrikerEnd) this.striker = incoming; else this.nonStriker = incoming;
      }
    }
    const overComplete = legal && over.legalBalls === BALLS_PER_OVER;
    if (overComplete) this.swapEnds();

    over.chips.push(chipOf(extra, runs, wicket !== null));
    const part = runsPart(extra, runs);
    const outPart = dismissed === null ? `, ${part}` : part === 'no run' ? `, OUT! ${dismissed.text}` : `, ${part}, OUT! ${dismissed.text}`;
    const line = `${label} ${bowler.player.shortName} to ${striker.player.shortName}${outPart}${freeHit ? ' (free hit)' : ''}`;
    this.items.push({
      kind: 'delivery', seq, over: over.number, ball, label, runs: teamRuns, bat_runs: batRuns, extra_runs: teamRuns - batRuns, extra,
      wicket: wicket?.kind ?? 'none', free_hit: freeHit, striker: striker.player.id, bowler: bowler.player.id, line,
    });
    if (overComplete) {
      if (over.charged === 0) bowler.maidens += 1;
      this.items.push({
        kind: 'over-end', over: over.number,
        line: `End of over ${over.number}: ${runsPhrase(over.teamRuns)}. ${this.spec.battingTeam.name} ${this.runs}/${this.wickets}`,
      });
    }
    this.lastSeq = seq;
    if (targetReached) this.ended = 'target';
    else if (wicketEndsInnings) this.ended = 'all-out';
    else if (quotaReached) this.ended = 'overs';
  }

  /** Who is out, and the dismissal text, once the wicket's own rules have passed. */
  private dismissalOf(wicket: Wicket, extra: Extra, runs: number, seq: number, freeHit: boolean, bowler: Player): { out: BatterRow; text: string } {
    const kind = wicket.kind;
    if (!wicketAllowed(kind, extra, freeHit)) {
      throw freeHit
        ? this.violation('WICKET_NOT_ALLOWED', copy.freeHitWicket, seq, { kind, freeHit: true })
        : this.violation('WICKET_NOT_ALLOWED', copy.wicketNotAllowed(kind), seq, { kind });
    }
    if (kind === 'run-out' ? runs > MAX_RUN_OUT_RUNS : runs !== 0) {
      throw this.violation('VALIDATION', copy.fieldErrors, seq, { fields: { runs: kind === 'run-out' ? copy.runOutRuns : copy.wicketRuns } });
    }
    switch (kind) {
      case 'bowled': return { out: this.striker, text: `b ${bowler.shortName}` };
      case 'lbw': return { out: this.striker, text: `lbw b ${bowler.shortName}` };
      case 'hit-wicket': return { out: this.striker, text: `hit wicket b ${bowler.shortName}` };
      case 'caught': {
        const fielder = this.fielderOf(wicket, seq);
        return { out: this.striker, text: fielder === bowler ? `c & b ${bowler.shortName}` : `c ${fielder.shortName} b ${bowler.shortName}` };
      }
      case 'stumped': return { out: this.striker, text: `st ${this.fielderOf(wicket, seq).shortName} b ${bowler.shortName}` };
      case 'run-out': {
        const fielder = this.fielderOf(wicket, seq);
        return { out: wicket.batterOut === 'striker' ? this.striker : this.nonStriker, text: `run out (${fielder.shortName})` };
      }
    }
  }

  private fielderOf(wicket: Wicket, seq: number): Player {
    const fielder = wicket.fielder === null ? undefined : this.fielding.get(wicket.fielder);
    if (!fielder) throw this.violation('VALIDATION', copy.fieldErrors, seq, { fields: { 'wicket.fielder': copy.chooseFielder } });
    return fielder;
  }

  private entrantFor(id: string | null): Entrant | null {
    const returning = this.retiredHurt.find((row) => row.player.id === id);
    if (returning) return { player: returning.player, returning };
    const player = this.waiting.find((candidate) => candidate.id === id);
    return player ? { player, returning: null } : null;
  }

  /** The entrant takes the crease: a first-timer starts a row, a retired-hurt batter continues theirs. */
  private bringIn(entrant: Entrant): BatterRow {
    if (entrant.returning) {
      this.retiredHurt = this.retiredHurt.filter((row) => row !== entrant.returning);
      entrant.returning.retired = false;
      return entrant.returning;
    }
    this.waiting = this.waiting.filter((player) => player !== entrant.player);
    const row = newBatter(entrant.player);
    this.battingOrder.push(row);
    return row;
  }

  private retire(batter: string, incoming: string): void {
    if (this.ended) throw this.violation('INNINGS_OVER', copy.inningsOver);
    const retiring = this.striker.player.id === batter ? this.striker : this.nonStriker.player.id === batter ? this.nonStriker : null;
    if (!retiring) throw this.violation('VALIDATION', copy.fieldErrors, null, { fields: { batter: copy.fieldErrors } });
    if (this.yetToBat.length === 0) throw this.violation('NO_BATTER_LEFT', copy.noBatterLeft);
    const entrant = this.entrantFor(incoming);
    if (!entrant) throw this.violation('NEW_BATTER_INVALID', copy.newBatterInvalid);
    const atStrikerEnd = retiring === this.striker;
    const row = this.bringIn(entrant);
    retiring.retired = true;
    this.retiredHurt.push(retiring);
    if (atStrikerEnd) this.striker = row; else this.nonStriker = row;
    this.items.push({ kind: 'retirement', player: retiring.player.id, line: `${retiring.player.shortName} retired hurt` });
  }
}

export const replayInnings = (spec: InningsSpec, log: LogEntry[]): InningsReplay => {
  const replay = new InningsReplay(spec);
  for (const entry of log) replay.apply(entry);
  return replay;
};
