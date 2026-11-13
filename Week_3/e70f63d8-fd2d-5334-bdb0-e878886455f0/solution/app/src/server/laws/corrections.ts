import { copy } from '../../shared/copy.js';
import type { Extra } from '../../shared/wire.js';
import { isLegal } from '../../shared/rules.js';
import { replayInnings } from './engine.js';
import type { InningsRecord } from './match.js';
import type { InningsPlan, InningsSpec, LogEntry } from './types.js';
import { LawViolation } from './types.js';

type DeliveryEntry = Extract<LogEntry, { kind: 'delivery' }>;
type Removed = { kind: 'delivery'; seq: number } | { kind: 'retirement'; batter: string };

/**
 * The innings' log with delivery `seq` given new runs and a new extra. The delivery stays legal or stays not legal, a
 * recorded wicket stays possible, and the replay must still be valid; otherwise the change is refused.
 */
export const changeDelivery = (spec: InningsSpec, log: LogEntry[], seq: number, extra: Extra, runs: number): LogEntry[] => {
  const old = log.filter((entry): entry is DeliveryEntry => entry.kind === 'delivery')[seq - 1];
  const index = log.indexOf(old);
  if (isLegal(old.extra) !== isLegal(extra)) throw new LawViolation('CHANGE_MOVES_OVERS', copy.changeMovesOvers, index, seq);
  const changed = log.map((entry, position): LogEntry => (position === index ? { ...old, extra, runs } : entry));
  try {
    replayInnings(spec, changed);
  } catch (error) {
    if (!(error instanceof LawViolation)) throw error;
    if (error.entry === index) {
      if (error.code === 'BYES_NEED_RUNS' || old.wicket === null) throw error;
      throw new LawViolation('CHANGE_BREAKS_WICKET', copy.changeBreaksWicket(old.wicket.kind), index, seq, old.wicket.kind);
    }
    if (error.code === 'WICKET_NOT_ALLOWED' && error.onFreeHit && error.seq !== null && error.wicketKind !== null) {
      throw new LawViolation('CHANGE_BREAKS_WICKET', copy.changeBreaksLaterWicket(error.seq, error.wicketKind), index, error.seq, error.wicketKind);
    }
    throw new LawViolation('CHANGE_MOVES_OVERS', copy.changeMovesOvers, index, seq);
  }
  return changed;
};

const removedOf = (log: LogEntry[], position: number): Removed => {
  const entry = log[position];
  return entry.kind === 'retirement'
    ? { kind: 'retirement', batter: entry.batter }
    : { kind: 'delivery', seq: log.slice(0, position + 1).filter((candidate) => candidate.kind === 'delivery').length };
};

/**
 * Undo the last scoring event: the log's last delivery or retirement. A bowler chosen for an over with no delivery
 * goes with the delivery before it; an innings that has only its start goes, and the finished innings before it loses
 * its last delivery and reopens. Null when nothing is left to undo.
 */
export const undoLast = (records: InningsRecord[]): { records: InningsRecord[]; removed: Removed } | null => {
  const last = records[records.length - 1];
  if (!last) return null;
  if (last.log.length === 1) {
    const previous = records[records.length - 2];
    if (!previous) return null;
    const removed = removedOf(previous.log, previous.log.length - 1);
    return { records: [...records.slice(0, -2), { ...previous, log: previous.log.slice(0, -1) }], removed };
  }
  const startsOver = last.log[last.log.length - 1]?.kind === 'over';
  const scoring = last.log.length - (startsOver ? 2 : 1);
  const removed = removedOf(last.log, scoring);
  return { records: [...records.slice(0, -1), { ...last, log: last.log.slice(0, scoring) }], removed };
};

/** Field errors for the batters an innings starts with: both in the batting XI and different. */
export const startingBattersError = (plan: InningsPlan, striker: string, nonStriker: string): Record<string, string> => {
  const members = new Set(plan.battingTeam.xi.map((player) => player.id));
  const errors: Record<string, string> = {};
  if (!members.has(striker)) errors['striker'] = copy.fieldErrors;
  if (!members.has(nonStriker) || nonStriker === striker) errors['non_striker'] = copy.fieldErrors;
  return errors;
};
