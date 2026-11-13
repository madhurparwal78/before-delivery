import { durationWord, formatPitch } from '../../shared/music.js';
import type { DurationName, DynamicMark, Operation, Pitch } from '../../shared/types.js';

interface SummarySubject {
  kind: 'note' | 'rest';
  pitch: Pitch | null;
  duration: DurationName;
  dots: number;
}

/** The fixed summary text of one recorded operation. */
export function summaryFor(op: Operation, subject: SummarySubject): string {
  if (op.type === 'insert') {
    if (subject.kind === 'rest') return `Added ${durationWord(subject.duration, subject.dots)} rest`;
    return `Added ${formatPitch(subject.pitch!)} ${durationWord(subject.duration, subject.dots)}`;
  }
  if (op.type === 'delete') {
    if (subject.kind === 'rest') return `Deleted ${durationWord(subject.duration, subject.dots)} rest`;
    return `Deleted ${formatPitch(subject.pitch!)} ${durationWord(subject.duration, subject.dots)}`;
  }
  switch (op.field) {
    case 'pitch':
      return `Pitch set to ${formatPitch(op.value as Pitch)}`;
    case 'duration':
      return `Duration set to ${durationWord(op.value as DurationName, subject.dots)}`;
    case 'dots':
      return `Dots set to ${op.value as number}`;
    case 'tie':
      return op.value === true ? 'Tie added' : 'Tie removed';
    case 'dynamic':
      return op.value === null
        ? 'Dynamic removed'
        : `Dynamic set to ${op.value as DynamicMark}`;
    case 'dynamicPlacement':
      return op.value === 'above'
        ? 'Dynamic moved above the staff'
        : 'Dynamic moved below the staff';
    case 'text':
      return 'Text changed';
  }
}
