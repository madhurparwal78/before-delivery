import { MSG } from '../shared/messages.js';
import type { Extra, WicketKind } from '../shared/types.js';
import { today } from './clock.js';
import { isLegalDelivery, wicketAllowed } from '../shared/laws.js';
import type { BallEvent, WicketInput } from './engine.js';
import { HttpError, notFound, validation } from './errors.js';
import { type MatchComputed, type MatchInput, computeMatch, superOverBarred } from './match.js';
import {
  appendEvents,
  createInningsRecord,
  deleteEvent,
  deleteInnings,
  inningsEvents,
  setPlayedOn,
  updateEvent,
} from './store.js';

const EXTRAS: Extra[] = ['none', 'wide', 'no-ball', 'bye', 'leg-bye'];
const KINDS: WicketKind[] = ['bowled', 'caught', 'lbw', 'stumped', 'hit-wicket', 'run-out'];

export type ScoringEvent =
  | { kind: 'delivery'; seq: number }
  | { kind: 'retirement'; seq: number }
  | { kind: 'innings'; seq: number }
  | { kind: 'over'; seq: number }
  | { kind: 'change'; seq: number }
  | { kind: 'undo'; seq: number };

function lastPlayed(computed: MatchComputed) {
  return computed.played[computed.played.length - 1] ?? null;
}

function assertInProgress(computed: MatchComputed): void {
  const { status } = computed;
  if (status === 'result' || status === 'tied') {
    throw new HttpError(409, 'MATCH_OVER', MSG.matchOver);
  }
  if (status === 'innings_break' || status === 'super_over_break') {
    throw new HttpError(409, 'INNINGS_OVER', MSG.inningsOver);
  }
  if (status === 'ready') {
    throw new HttpError(409, 'NEEDS_INNINGS', MSG.needsInnings);
  }
}

function withEvents(input: MatchInput, events: BallEvent[]): MatchInput {
  const innings = input.innings.map((record, index) =>
    index === input.innings.length - 1 ? { ...record, events: [...record.events, ...events] } : record,
  );
  return { ...input, innings };
}

function withChangedDelivery(input: MatchInput, deliveryIndex: number, extra: Extra, runs: number): MatchInput {
  const innings = input.innings.map((record, index) => {
    if (index !== input.innings.length - 1) return record;
    let seen = -1;
    const events = record.events.map((event) => {
      if (event.t !== 'delivery') return event;
      seen += 1;
      return seen === deliveryIndex ? { ...event, extra, runs } : event;
    });
    return { ...record, events };
  });
  return { ...input, innings };
}

function playerIds(input: MatchInput, teamId: string): string[] {
  return (input.xi.get(teamId) ?? []).map((player) => player.id);
}

function shortName(input: MatchInput, playerId: string): string {
  for (const players of input.xi.values()) {
    const found = players.find((player) => player.id === playerId);
    if (found) return found.short_name;
  }
  return '';
}

export async function startInnings(
  input: MatchInput,
  body: { striker?: unknown; non_striker?: unknown; bowler?: unknown },
): Promise<ScoringEvent> {
  const computed = computeMatch(input);
  if (computed.status === 'result' || computed.status === 'tied') {
    throw new HttpError(409, 'MATCH_OVER', MSG.matchOver);
  }
  if (!computed.nextPlan) {
    throw new HttpError(409, 'INNINGS_IN_PROGRESS', MSG.inningsInProgress);
  }
  const plan = computed.nextPlan;
  const batting = playerIds(input, plan.battingTeamId);
  const bowling = playerIds(input, plan.bowlingTeamId);
  const striker = String(body.striker ?? '');
  const nonStriker = String(body.non_striker ?? '');
  const bowler = String(body.bowler ?? '');
  const fields: Record<string, string> = {};
  if (!batting.includes(striker)) fields.striker = MSG.newBatterInvalid;
  if (!batting.includes(nonStriker) || nonStriker === striker) fields.non_striker = MSG.newBatterInvalid;
  if (!bowling.includes(bowler)) fields.bowler = MSG.fieldErrors;
  if (Object.keys(fields).length > 0) throw validation(fields);

  if (superOverBarred(plan, computed.played).includes(bowler)) {
    throw new HttpError(422, 'BOWLER_BARRED', MSG.bowlerSuperOver(shortName(input, bowler)));
  }

  await createInningsRecord({
    matchId: input.id,
    key: plan.key,
    striker,
    nonStriker,
    bowler,
  });
  return { kind: 'innings', seq: 0 };
}

export async function startOver(input: MatchInput, body: { bowler?: unknown }): Promise<ScoringEvent> {
  const computed = computeMatch(input);
  assertInProgress(computed);
  const played = lastPlayed(computed)!;
  if (!played.computed.needsBowler) {
    throw new HttpError(409, 'OVER_IN_PROGRESS', MSG.overInProgress);
  }
  const bowler = String(body.bowler ?? '');
  if (!playerIds(input, played.plan.bowlingTeamId).includes(bowler)) {
    throw validation({ bowler: MSG.fieldErrors });
  }
  const previousOver = [...played.computed.overs].reverse().find((over) => over.complete);
  if (previousOver && previousOver.bowler === bowler) {
    throw new HttpError(422, 'BOWLER_CONSECUTIVE', MSG.bowlerConsecutive(shortName(input, bowler)));
  }
  const stat = played.computed.bowlers.find((b) => b.player === bowler);
  if (stat && stat.completedOvers >= played.computed.overLimit) {
    throw new HttpError(
      422,
      'BOWLER_LIMIT',
      MSG.bowlerLimit(shortName(input, bowler), played.computed.overLimit),
    );
  }
  await appendEvents(played.record.id, [{ t: 'over', bowler }]);
  return { kind: 'over', seq: played.computed.lastSeq };
}

export function checkExpectedSeq(input: MatchInput, expected: unknown): void {
  const computed = computeMatch(input);
  const played = lastPlayed(computed);
  const lastSeq = played ? played.computed.lastSeq : 0;
  if (expected !== lastSeq + 1) {
    throw new HttpError(409, 'STALE_DELIVERY', MSG.staleDelivery, { seq: lastSeq });
  }
}

export async function recordDelivery(
  input: MatchInput,
  body: {
    extra?: unknown;
    runs?: unknown;
    wicket?: unknown;
  },
): Promise<ScoringEvent> {
  const computed = computeMatch(input);
  assertInProgress(computed);
  const played = lastPlayed(computed)!;
  if (played.computed.needsBowler) {
    throw new HttpError(409, 'NEEDS_BOWLER', MSG.needsBowler);
  }

  const extra = body.extra === undefined ? 'none' : (body.extra as Extra);
  const runs = body.runs;
  if (!EXTRAS.includes(extra)) throw validation({ extra: MSG.fieldErrors });
  if (typeof runs !== 'number' || !Number.isInteger(runs) || runs < 0 || runs > 6) {
    throw validation({ runs: MSG.runsField });
  }
  if ((extra === 'bye' || extra === 'leg-bye') && runs < 1) {
    throw new HttpError(422, 'BYES_NEED_RUNS', MSG.byesNeedRuns);
  }

  let wicket: WicketInput | null = null;
  if (body.wicket !== null && body.wicket !== undefined) {
    const raw = body.wicket as {
      kind?: unknown;
      fielder?: unknown;
      batter_out?: unknown;
      new_batter?: unknown;
    };
    const kind = raw.kind as WicketKind;
    if (!KINDS.includes(kind)) throw validation({ kind: MSG.fieldErrors });
    if (!wicketAllowed(kind, extra, played.computed.freeHit)) {
      throw new HttpError(
        422,
        'WICKET_NOT_ALLOWED',
        played.computed.freeHit ? MSG.freeHitWicket : MSG.wicketNotAllowed(kind),
      );
    }
    const fielders = playerIds(input, played.plan.bowlingTeamId);
    const fielder = raw.fielder === undefined || raw.fielder === null ? null : String(raw.fielder);
    if (kind === 'caught' || kind === 'stumped' || kind === 'run-out') {
      if (!fielder || !fielders.includes(fielder)) throw validation({ fielder: MSG.fieldErrors });
    }
    if (kind === 'run-out') {
      if (runs > 3) throw validation({ runs: MSG.runsField });
    } else if (runs !== 0) {
      throw validation({ runs: MSG.runsField });
    }
    const batterOut = raw.batter_out === 'non-striker' ? 'non-striker' : 'striker';
    wicket = {
      kind,
      fielder: kind === 'bowled' || kind === 'lbw' || kind === 'hit-wicket' ? null : fielder,
      batter_out: kind === 'run-out' ? batterOut : 'striker',
      new_batter: null,
    };

    const trial = computeMatch(withEvents(input, [{ t: 'delivery', extra, runs, wicket }]));
    const trialInnings = lastPlayed(trial)!.computed;
    if (!trialInnings.ended) {
      const available = played.computed.yetToBat.map((player) => player.player);
      const newBatter =
        raw.new_batter === undefined || raw.new_batter === null ? null : String(raw.new_batter);
      if (!newBatter || !available.includes(newBatter)) {
        throw new HttpError(422, 'NEW_BATTER_INVALID', MSG.newBatterInvalid);
      }
      wicket.new_batter = newBatter;
    }
  }

  await appendEvents(played.record.id, [{ t: 'delivery', extra, runs, wicket }]);
  if (!input.played_on) await setPlayedOn(input.id, today());
  return { kind: 'delivery', seq: played.computed.lastSeq + 1 };
}

export async function retireBatter(
  input: MatchInput,
  body: { batter?: unknown; new_batter?: unknown },
): Promise<ScoringEvent> {
  const computed = computeMatch(input);
  assertInProgress(computed);
  const played = lastPlayed(computed)!;
  const batter = String(body.batter ?? '');
  if (batter !== played.computed.striker && batter !== played.computed.nonStriker) {
    throw validation({ batter: MSG.newBatterInvalid });
  }
  const available = played.computed.yetToBat.map((player) => player.player);
  if (available.length === 0) {
    throw new HttpError(422, 'NO_BATTER_LEFT', MSG.noBatterLeft);
  }
  const newBatter = String(body.new_batter ?? '');
  if (!available.includes(newBatter)) {
    throw new HttpError(422, 'NEW_BATTER_INVALID', MSG.newBatterInvalid);
  }
  await appendEvents(played.record.id, [{ t: 'retirement', batter, new_batter: newBatter }]);
  return { kind: 'retirement', seq: played.computed.lastSeq };
}

export async function changeDelivery(
  input: MatchInput,
  seq: number,
  body: { extra?: unknown; runs?: unknown },
): Promise<ScoringEvent> {
  const computed = computeMatch(input);
  const played = lastPlayed(computed);
  if (!played) throw notFound();
  const delivery = played.computed.deliveries.find((item) => item.seq === seq);
  if (!delivery) throw notFound();

  const extra = body.extra === undefined ? 'none' : (body.extra as Extra);
  const runs = body.runs;
  if (!EXTRAS.includes(extra)) throw validation({ extra: MSG.fieldErrors });
  if (typeof runs !== 'number' || !Number.isInteger(runs) || runs < 0 || runs > 6) {
    throw validation({ runs: MSG.runsField });
  }
  if (isLegalDelivery(extra) !== isLegalDelivery(delivery.extra)) {
    throw new HttpError(422, 'CHANGE_MOVES_OVERS', MSG.changeMovesOvers);
  }
  if ((extra === 'bye' || extra === 'leg-bye') && runs < 1) {
    throw new HttpError(422, 'BYES_NEED_RUNS', MSG.byesNeedRuns);
  }
  if (delivery.wicket !== 'none' && !wicketAllowed(delivery.wicket, extra, delivery.free_hit)) {
    throw new HttpError(422, 'CHANGE_BREAKS_WICKET', MSG.changeBreaksWicket(delivery.wicket));
  }

  const deliveryIndex = played.computed.deliveries.findIndex((item) => item.seq === seq);
  const trial = computeMatch(withChangedDelivery(input, deliveryIndex, extra, runs));
  const trialInnings = lastPlayed(trial)!.computed;
  const broken = trialInnings.deliveries.find(
    (item) => item.free_hit && item.wicket !== 'none' && item.wicket !== 'run-out',
  );
  if (broken) {
    throw new HttpError(
      422,
      'CHANGE_BREAKS_WICKET',
      MSG.changeBreaksLaterWicket(broken.seq, broken.wicket),
    );
  }

  const events = await inningsEvents(played.record.id);
  const deliveryRows = events.filter((row) => row.type === 'delivery');
  const row = deliveryRows[deliveryIndex];
  const current = row.data as { t: 'delivery'; extra: Extra; runs: number; wicket: WicketInput | null };
  await updateEvent(row.id, { ...current, extra, runs });
  return { kind: 'change', seq };
}

export async function undoLast(input: MatchInput): Promise<ScoringEvent & { short?: string }> {
  const emptyInnings: string[] = [];
  for (let index = input.innings.length - 1; index >= 0; index -= 1) {
    const record = input.innings[index];
    const events = await inningsEvents(record.id);
    const trailingOvers: string[] = [];
    let target: { id: string; type: string; data: BallEvent; position: number } | null = null;
    for (let position = events.length - 1; position >= 0; position -= 1) {
      const row = events[position];
      if (row.type === 'over') {
        trailingOvers.push(row.id);
        continue;
      }
      target = { ...row, position };
      break;
    }
    if (!target) {
      emptyInnings.push(record.id);
      continue;
    }
    const found = target;
    for (const id of emptyInnings) await deleteInnings(id);
    if (found.type === 'retirement') {
      await deleteEvent(found.id);
      const data = found.data as { t: 'retirement'; batter: string };
      const seq = events.filter((event) => event.type === 'delivery').length;
      return { kind: 'undo', seq, short: shortName(input, data.batter) };
    }
    for (const id of trailingOvers) await deleteEvent(id);
    await deleteEvent(found.id);
    return {
      kind: 'undo',
      seq: events.filter((event, order) => event.type === 'delivery' && order <= found.position).length,
    };
  }
  throw new HttpError(409, 'NOTHING_TO_UNDO', MSG.nothingToUndo);
}
