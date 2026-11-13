import { copy } from '../../shared/copy.js';
import type { ErrorCode } from '../../shared/copy.js';
import { isExtra, isWicketKind } from '../../shared/rules.js';
import type { EventKind, WicketBody } from '../../shared/wire.js';
import { now } from '../clock.js';
import { canSeeMatch } from '../db/lookup.js';
import type { Bundle } from '../db/matches.js';
import { finished, loadMatch, saveRecords } from '../db/matches.js';
import { transaction } from '../db/pool.js';
import { scorerState, tournamentTables, visibleBundle } from '../db/views.js';
import { ApiError, notFound, validation } from '../http/errors.js';
import { asObject, failOn, text, wholeNumber } from '../http/input.js';
import { authedUser, reply, route } from '../http/router.js';
import type { Context, Reply } from '../http/router.js';
import { changeDelivery, startingBattersError, undoLast } from '../laws/corrections.js';
import type { InningsRecord } from '../laws/match.js';
import { replayMatch } from '../laws/match.js';
import { buildState } from '../laws/present.js';
import type { LogEntry } from '../laws/types.js';
import { LawViolation } from '../laws/types.js';
import { publishState, publishTable } from '../live/hub.js';
import { currentPen } from '../live/pen.js';

const CONFLICTS: readonly ErrorCode[] = ['NEEDS_BOWLER', 'INNINGS_OVER', 'OVER_IN_PROGRESS'];

/** The published answer for a log entry the laws refused. */
const refusal = (violation: LawViolation): ApiError =>
  violation.code === 'VALIDATION'
    ? validation(violation.fields)
    : new ApiError(CONFLICTS.includes(violation.code) ? 409 : 422, violation.code, violation.message);

const guarded = <T>(work: () => T): T => {
  try {
    return work();
  } catch (error) {
    throw error instanceof LawViolation ? refusal(error) : error;
  }
};

/** The status gate every scoring call shares: an innings must be in progress (409 otherwise). */
const inProgress = (bundle: Bundle): InningsRecord => {
  const status = bundle.view.status;
  if (status === 'ready') throw new ApiError(409, 'NEEDS_INNINGS', copy.startInningsFirst);
  if (status === 'innings_break' || status === 'super_over_break') throw new ApiError(409, 'INNINGS_OVER', copy.inningsOver);
  if (finished(status)) throw new ApiError(409, 'MATCH_OVER', copy.matchOver);
  return bundle.records[bundle.records.length - 1];
};

const withLog = (bundle: Bundle, log: LogEntry[]): InningsRecord[] => {
  const last = bundle.records[bundle.records.length - 1];
  return [...bundle.records.slice(0, -1), { ...last, log }];
};

const lastSeqOf = (bundle: Bundle): number => bundle.view.played.at(-1)?.replay.lastSeq ?? 0;

const requirePen = async (ctx: Context, matchId: string): Promise<void> => {
  const held = await currentPen(matchId);
  const offered = ctx.req.headers['x-pen'];
  if (!held || offered !== held.penId) throw new ApiError(409, 'PEN_HELD', held?.name ? copy.penHeld(held.name) : copy.penFree, { holder: held?.name ?? null });
};

interface Outcome { records: InningsRecord[]; event: (after: Bundle) => { kind: EventKind; seq: number } }

/**
 * One scoring call: sign-in and visibility (404), the pen (409), then under the match lock the handler's checks and
 * writes. After the commit the new state goes out on the match's live channel, and the tournament's tables when a
 * result was or is now present.
 */
const scoringCall = async (ctx: Context, status: number, apply: (bundle: Bundle) => Outcome): Promise<Reply> => {
  const user = authedUser(ctx);
  const matchId = ctx.params['id'] ?? '';
  if (!(await canSeeMatch(user.id, matchId))) throw notFound();
  await requirePen(ctx, matchId);
  const { bundle, outcome, after } = await transaction(async (db) => {
    const locked = await loadMatch(db, matchId, true);
    const applied = apply(locked);
    await saveRecords(db, locked, applied.records, now());
    return { bundle: locked, outcome: applied, after: await loadMatch(db, matchId) };
  });
  const state = buildState(after.view, after.ctx);
  await publishState(matchId, outcome.event(after), state);
  const tournamentId = after.row.tournament_id;
  if (tournamentId && (bundle.view.result || after.view.result)) await publishTable(tournamentId, await tournamentTables(tournamentId));
  return reply(status, scorerState(after));
};

route('POST', '/api/matches/:id/innings', {}, (ctx) => scoringCall(ctx, 201, (bundle) => {
  const plan = bundle.view.next;
  if (plan === null) {
    throw finished(bundle.view.status) ? new ApiError(409, 'MATCH_OVER', copy.matchOver) : new ApiError(409, 'INNINGS_IN_PROGRESS', copy.inningsInProgress);
  }
  const input = asObject(ctx.body);
  const striker = text(input['striker']);
  const nonStriker = text(input['non_striker']);
  const bowler = text(input['bowler']);
  failOn(startingBattersError(plan, striker, nonStriker));
  const record: InningsRecord = { striker, nonStriker, log: [{ kind: 'over', bowler }] };
  const records = [...bundle.records, record];
  guarded(() => replayMatch(bundle.spec, records));
  return { records, event: () => ({ kind: 'innings', seq: 0 }) };
}));

route('POST', '/api/matches/:id/overs', {}, (ctx) => scoringCall(ctx, 201, (bundle) => {
  const record = inProgress(bundle);
  const bowler = text(asObject(ctx.body)['bowler']);
  const records = withLog(bundle, [...record.log, { kind: 'over', bowler }]);
  guarded(() => replayMatch(bundle.spec, records));
  return { records, event: (after) => ({ kind: 'over', seq: lastSeqOf(after) }) };
}));

const wicketOf = (input: unknown): { wicket: WicketBody | null; fields: Record<string, string> } => {
  if (input === null || input === undefined) return { wicket: null, fields: {} };
  const wicket = asObject(input);
  const kind = wicket['kind'];
  if (!isWicketKind(kind)) return { wicket: null, fields: { wicket: copy.fieldErrors } };
  const batterOut = wicket['batter_out'] === 'non-striker' ? 'non-striker' : 'striker';
  const nullable = (value: unknown): string | null => (typeof value === 'string' ? value : null);
  return {
    wicket: { kind, fielder: nullable(wicket['fielder']), batter_out: batterOut, new_batter: nullable(wicket['new_batter']) },
    fields: {},
  };
};

route('POST', '/api/matches/:id/deliveries', {}, (ctx) => scoringCall(ctx, 201, (bundle) => {
  const input = asObject(ctx.body);
  const expected = wholeNumber(input['expected_seq']);
  if (expected !== null && expected !== lastSeqOf(bundle) + 1) {
    throw new ApiError(409, 'STALE_DELIVERY', copy.staleDelivery, { seq: lastSeqOf(bundle) });
  }
  const record = inProgress(bundle);
  const extra = isExtra(input['extra']) ? input['extra'] : undefined;
  const runs = wholeNumber(input['runs']);
  const { wicket, fields } = wicketOf(input['wicket']);
  if (expected === null) fields['expected_seq'] = copy.fieldErrors;
  if (extra === undefined) fields['extra'] = copy.fieldErrors;
  if (runs === null) fields['runs'] = copy.runs;
  if (Object.keys(fields).length > 0 || extra === undefined || runs === null || expected === null) throw validation(fields);
  const entry: LogEntry = {
    kind: 'delivery', extra, runs,
    wicket: wicket && { kind: wicket.kind, fielder: wicket.fielder, batterOut: wicket.batter_out, newBatter: wicket.new_batter },
  };
  const records = withLog(bundle, [...record.log, entry]);
  guarded(() => replayMatch(bundle.spec, records));
  return { records, event: (after) => ({ kind: 'delivery', seq: lastSeqOf(after) }) };
}));

route('PUT', '/api/matches/:id/deliveries/:seq', {}, async (ctx) => {
  const seq = Number(ctx.params['seq']);
  const current = await visibleBundle(authedUser(ctx).id, ctx.params['id'] ?? '');
  if (!Number.isInteger(seq) || seq < 1 || seq > lastSeqOf(current)) throw notFound();
  return scoringCall(ctx, 200, (bundle) => {
    const input = asObject(ctx.body);
    const extra = isExtra(input['extra']) ? input['extra'] : undefined;
    const runs = wholeNumber(input['runs']);
    const fields: Record<string, string> = {};
    if (extra === undefined) fields['extra'] = copy.fieldErrors;
    if (runs === null) fields['runs'] = copy.runs;
    if (extra === undefined || runs === null) throw validation(fields);
    const played = bundle.view.played[bundle.view.played.length - 1];
    const record = bundle.records[bundle.records.length - 1];
    const log = guarded(() => changeDelivery(played.replay.spec, record.log, seq, extra, runs));
    const records = withLog(bundle, log);
    return { records, event: () => ({ kind: 'change', seq }) };
  });
});

route('DELETE', '/api/matches/:id/deliveries/last', {}, (ctx) => scoringCall(ctx, 200, (bundle) => {
  const undone = undoLast(bundle.records);
  if (!undone) throw new ApiError(409, 'NOTHING_TO_UNDO', copy.nothingToUndo);
  const removed = undone.removed;
  return { records: undone.records, event: (after) => ({ kind: 'undo', seq: removed.kind === 'delivery' ? removed.seq : lastSeqOf(after) }) };
}));

route('POST', '/api/matches/:id/retirements', {}, (ctx) => scoringCall(ctx, 201, (bundle) => {
  const record = inProgress(bundle);
  const input = asObject(ctx.body);
  const batter = text(input['batter']);
  const newBatter = text(input['new_batter']);
  const records = withLog(bundle, [...record.log, { kind: 'retirement', batter, newBatter }]);
  guarded(() => replayMatch(bundle.spec, records));
  return { records, event: (after) => ({ kind: 'retirement', seq: lastSeqOf(after) }) };
}));
