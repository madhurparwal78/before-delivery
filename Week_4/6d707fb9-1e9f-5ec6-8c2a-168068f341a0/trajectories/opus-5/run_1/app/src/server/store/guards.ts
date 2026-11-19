import { copy } from '../domain/copy';
import { LISBON, localTime } from '../domain/time';
import { problem } from '../http/problem';
import type { LabelRow, StyleRowRecord } from './rows';

/** A closed label refuses every write under it, and the closed-label copy wins. */
export function requireWritable(style: StyleRowRecord, label: LabelRow): void {
  if (label.state !== 'open') throw problem.conflict(copy.labelClosed);
  if (style.state === 'archived') throw problem.conflict(copy.styleArchived);
}

export function staleEditCopy(style: StyleRowRecord): string {
  const time = localTime(Number(style.changed_at), LISBON);
  return style.changed_by === null
    ? copy.changedElsewhere(time)
    : copy.changedByAnswer(time, style.changed_by);
}

/** An edit with an old `baseVersion` answers 412 with the published copy. */
export function checkBaseVersion(style: StyleRowRecord, baseVersion: number | null): void {
  if (baseVersion !== null && baseVersion !== style.version) {
    throw problem.staleEdit(staleEditCopy(style));
  }
}
