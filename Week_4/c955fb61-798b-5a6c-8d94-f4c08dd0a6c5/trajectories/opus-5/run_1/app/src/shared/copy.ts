import type { LinkType } from './types.js';

export const TYPE_WORDS: Record<LinkType, string> = {
  FS: 'finish to start',
  SS: 'start to start',
  FF: 'finish to finish',
  SF: 'start to finish',
};

export const LINK_TYPE_LABELS: Record<LinkType, string> = {
  FS: 'Finish to start',
  SS: 'Start to start',
  FF: 'Finish to finish',
  SF: 'Start to finish',
};

export const ALERTS = {
  signIn: 'Email or password is incorrect.',
  signUpName: 'Enter your name.',
  signUpEmail: 'Enter a valid email address.',
  signUpPassword: 'Password must be at least 10 characters.',
  signUpTaken: 'That email already has an account.',
  projectName: 'Project name must be 1 to 80 characters.',
  itemName: 'Name must be 1 to 120 characters.',
  itemStart: 'Enter a date as YYYY-MM-DD.',
  itemDuration: 'Duration must be a whole number from 0 to 999.',
  itemPercent: 'Percent complete must be a whole number from 0 to 100.',
  milestonePercent: 'A milestone is either 0% or 100% complete.',
  hasAssignees: 'Remove the assignees before making this a milestone.',
  predecessorSyntax: 'Write predecessors like 2FS+1, 3SS-2.',
  duplicateLink: 'Those tasks are already linked.',
  selfLink: 'A task cannot wait for itself.',
  groupLink: 'Groups cannot be linked.',
  lagRange: 'Lag must be between -30 and 30 working days.',
  readOnly: 'You can view this project but not change it.',
  holidayDate: 'Enter a date as YYYY-MM-DD.',
  holidayName: 'Holiday name must be 1 to 60 characters.',
  holidayWeekend: 'That date is a weekend.',
  holidayDuplicate: 'That date is already a holiday.',
  baselineName: 'Baseline name must be 1 to 60 characters.',
  assignHours: 'Hours a day must be from 0.5 to 24 in steps of 0.5.',
  commentLength: 'Comments can be at most 1000 characters.',
  storageOutage: 'File storage is unavailable. Your export was not saved. Try again later.',
  saveFailed: 'Your change could not be saved. Try again.',
} as const;

export function noRowMessage(row: number): string {
  return `There is no row ${row}.`;
}

export function rowTwiceMessage(row: number): string {
  return `Row ${row} is listed twice.`;
}

export function loopMessage(path: string[]): string {
  return `That link would make the project wait on itself: ${path.join(' -> ')}.`;
}

export function alreadyAssignedMessage(name: string): string {
  return `${name} is already assigned to this task.`;
}

export function conflictMessage(name: string, item: string): string {
  return `${name} changed ${item} first. Your change was not saved.`;
}

export function varianceText(variance: number): string {
  if (variance === 0) return 'On baseline';
  const n = Math.abs(variance);
  const unit = n === 1 ? '1 working day' : `${n} working days`;
  return `${unit} ${variance > 0 ? 'later' : 'earlier'} than baseline`;
}

export function workingDaysText(days: number): string {
  return days === 1 ? '1 working day' : `${days} working days`;
}

export function movedCountText(count: number): string {
  if (count === 0) return 'No dependent tasks moved.';
  if (count === 1) return '1 dependent task moved.';
  return `${count} dependent tasks moved.`;
}

export function tasksMovedText(count: number): string {
  if (count === 0) return 'No tasks moved.';
  if (count === 1) return '1 task moved.';
  return `${count} tasks moved.`;
}

export function criticalCountText(count: number): string {
  if (count === 0) return 'No critical tasks';
  if (count === 1) return '1 critical task';
  return `${count} critical tasks`;
}
