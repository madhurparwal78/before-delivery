import type { FeatureStatus, NoteStatus, ReleaseStatus } from '../../shared/types';
import { conflict, type AppError } from '../errors';

/** The one place every state machine in the product is decided. */

const NOTE_EDGES: ReadonlyArray<[NoteStatus, NoteStatus]> = [
  ['unprocessed', 'processed'],
  ['processed', 'unprocessed'],
  ['unprocessed', 'snoozed'],
  ['snoozed', 'unprocessed'],
];

export function noteTransitionAllowed(from: NoteStatus, to: NoteStatus): boolean {
  return NOTE_EDGES.some(([a, b]) => a === from && b === to);
}

/** Snoozing again while snoozed replaces the time. */
export function noteSnoozeAllowed(from: NoteStatus): boolean {
  return from === 'snoozed' || noteTransitionAllowed(from, 'snoozed');
}

export function noteTransitionError(from: NoteStatus, to: NoteStatus): AppError {
  return conflict('invalid_transition', `This note can't move from ${from} to ${to}.`, { from, to });
}

export const FEATURE_STATUS_LABELS: Record<FeatureStatus, string> = {
  candidate: 'Candidate',
  planned: 'Planned',
  in_progress: 'In progress',
  released: 'Released',
  archived: 'Archived',
};

const FEATURE_EDGES: ReadonlyArray<[FeatureStatus, FeatureStatus]> = [
  ['candidate', 'planned'],
  ['planned', 'in_progress'],
];

export function featureTransitionAllowed(from: FeatureStatus, to: FeatureStatus): boolean {
  if (to === 'archived') return from !== 'archived';
  return FEATURE_EDGES.some(([a, b]) => a === from && b === to);
}

export function featureTransitionError(name: string, from: FeatureStatus, to: FeatureStatus): AppError {
  return conflict(
    'invalid_transition',
    `${name} can't move from ${FEATURE_STATUS_LABELS[from]} to ${FEATURE_STATUS_LABELS[to]}.`,
    { from, to },
  );
}

export function releaseTransitionError(from: ReleaseStatus, to: ReleaseStatus): AppError {
  return conflict('invalid_transition', `This release can't move from ${from} to ${to}.`, { from, to });
}

export const releaseShippedError = (): AppError =>
  conflict('release_shipped', 'This release has shipped and can\u2019t change.');
