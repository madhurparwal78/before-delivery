import type { ProgrammeStatus, PublishBlocker } from '../../shared/api.js';

export interface PublishCheckInput {
  status: ProgrammeStatus;
  firstRehearsalMs: number;
  nowMs: number;
  workCount: number;
  shortfall: number;
}

/** The publish guards, in order. An empty list means a publish made now would succeed. */
export function publishBlockers(input: PublishCheckInput): PublishBlocker[] {
  const blockers: PublishBlocker[] = [];
  if (input.status !== 'in_preparation') {
    blockers.push({
      error: 'illegal_transition',
      message: 'Folders can only be published while the programme is in preparation.',
    });
  }
  if (input.nowMs >= input.firstRehearsalMs) {
    blockers.push({
      error: 'first_rehearsal_passed',
      message: "Folders can't be published after the first rehearsal has started.",
    });
  }
  if (input.workCount === 0) {
    blockers.push({ error: 'no_works', message: 'Add a work before publishing folders.' });
  }
  if (input.shortfall > 0) {
    blockers.push({
      error: 'copies_short',
      message:
        input.shortfall === 1
          ? "Folders can't be published while 1 copy is short."
          : `Folders can't be published while ${input.shortfall} copies are short.`,
    });
  }
  return blockers;
}
