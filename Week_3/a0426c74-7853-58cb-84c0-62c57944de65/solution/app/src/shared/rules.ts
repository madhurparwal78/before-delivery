// The rules of the brief that both the server and the browser decide: who may do what (roles), and the state machines
// of sheet version, review step, issue, RFI and export job. Each machine is a table of allowed moves; every function
// that changes a state goes through `move`, so an illegal move has one error shape and one sentence per machine.

import * as copy from './copy.ts';
import { ApiError, fieldError } from './errors.ts';
import { clamp } from './geometry/numbers.ts';
import {
  ROLES,
  type ExportState, type IssueState, type OpResult, type ReviewStep, type ReviewStepRole, type ReviewStepState, type Role, type RfiState,
  type VersionState,
} from './types.ts';

// ---------------------------------------------------------------- roles

export const isRole = (value: unknown): value is Role => ROLES.some((role) => role === value);

/** Roles run from `view` up to `manage`; a role may do whatever a lower one may. */
export const atLeast = (role: Role, minimum: Role): boolean => ROLES.indexOf(role) >= ROLES.indexOf(minimum);

/** The lowest role that may take each action (brief: Roles). The server enforces these; the browser hides what a role cannot use. */
export const MINIMUM_ROLE = {
  createSubfolder: 'manage',
  setFolderRole: 'manage',
  createDrawing: 'edit',
  editDrawing: 'edit',
  addSheet: 'edit',
  editSheet: 'edit',
  lockSheet: 'manage',
  publish: 'edit',
  restoreVersion: 'edit',
  startReview: 'edit',
  addMarkup: 'markup',
  raiseIssue: 'markup',
  askRfi: 'markup',
  createLink: 'manage',
  turnOffLink: 'manage',
} as const satisfies Record<string, Role>;

/** A review step is decided by the role it is named for, or a higher one. */
export const stepMinimumRole = (step: ReviewStepRole): Role => step;

/** The sentence a role gets when it cannot edit: the phone has no drawing commands at all, otherwise it is a view-only role. */
export function editRefusal(role: Role, phone: boolean): string | null {
  if (phone) return copy.PHONE_COMMAND;
  return atLeast(role, MINIMUM_ROLE.editDrawing) ? null : copy.VIEW_ONLY;
}

/** The sentence for a drawing that is only looked at (a review): no role edits there, but a phone still gets its own sentence. */
export const viewOnlyRefusal = (phone: boolean): string => (phone ? copy.PHONE_COMMAND : copy.VIEW_ONLY);

// ---------------------------------------------------------------- operation results

/** A result other than `applied` (rebased, dropped, redirected) is a conflict with someone else's change. */
export const isConflict = (result: Pick<OpResult, 'status'>): boolean => result.status !== 'applied';

// ---------------------------------------------------------------- state machines

type Machine<S extends string> = Readonly<Record<S, readonly S[]>>;

export const VERSION_MACHINE: Machine<VersionState> = {
  publishing: ['published'],
  published: ['in_review', 'voided'],
  in_review: ['approved', 'rejected', 'published', 'voided'],
  approved: [],
  rejected: [],
  voided: [],
};

export const REVIEW_STEP_MACHINE: Machine<ReviewStepState> = {
  waiting: ['pending', 'voided'],
  pending: ['approved', 'rejected', 'expired', 'voided'],
  approved: [],
  rejected: [],
  expired: [],
  voided: [],
};

export const ISSUE_MACHINE: Machine<IssueState> = {
  open: ['answered'],
  answered: ['closed'],
  closed: ['open'],
};

export const RFI_MACHINE: Machine<RfiState> = {
  draft: ['sent'],
  sent: ['answered'],
  answered: ['closed', 'sent'],
  closed: [],
};

export const EXPORT_MACHINE: Machine<ExportState> = {
  queued: ['running'],
  running: ['ready', 'failed'],
  ready: [],
  failed: ['running'],
};

const stateGuard = <S extends string>(machine: Machine<S>) => (value: unknown): value is S =>
  typeof value === 'string' && Object.hasOwn(machine, value);

export const isVersionState = stateGuard(VERSION_MACHINE);
export const isReviewStepState = stateGuard(REVIEW_STEP_MACHINE);
export const isIssueState = stateGuard(ISSUE_MACHINE);
export const isRfiState = stateGuard(RFI_MACHINE);

function move<S extends string>(machine: Machine<S>, from: S, to: S, sentence: (from: string, to: string) => string): S {
  if (!machine[from].includes(to)) throw new ApiError('illegal_transition', sentence(from, to));
  return to;
}

export const moveVersion = (from: VersionState, to: VersionState): VersionState => move(VERSION_MACHINE, from, to, copy.versionTransition);
const moveIssue = (from: IssueState, to: IssueState): IssueState => move(ISSUE_MACHINE, from, to, copy.issueTransition);
const moveRfi = (from: RfiState, to: RfiState): RfiState => move(RFI_MACHINE, from, to, copy.rfiTransition);
export const moveExport = (from: ExportState, to: ExportState): ExportState => move(EXPORT_MACHINE, from, to, copy.exportTransition);
const moveStep = (from: ReviewStepState, to: ReviewStepState): ReviewStepState => move(REVIEW_STEP_MACHINE, from, to, copy.stepTransition);

// ---------------------------------------------------------------- versions

/** Publishing a newer version voids `published` and `in_review` versions; approved and rejected ones stay. */
function stateWhenReplaced(state: VersionState): VersionState {
  return VERSION_MACHINE[state].includes('voided') ? 'voided' : state;
}

// ---------------------------------------------------------------- reviews

export const REVIEW_STEP_ROLES: readonly ReviewStepRole[] = ['markup', 'manage'];

export interface Review { state: VersionState; steps: ReviewStep[] }
/** A version as a review action sees it: a voided one knows the number of the version that replaced it. */
export type ReviewedVersion = { state: Exclude<VersionState, 'voided'> } | { state: 'voided'; replacedByNumber: number };

/** The step a review waits on: the first one that is `pending`. */
export const pendingStep = (steps: readonly ReviewStep[]): ReviewStep | undefined => steps.find((step) => step.state === 'pending');

const withStep = (steps: ReviewStep[], index: number, change: Partial<ReviewStep>): ReviewStep[] =>
  steps.map((step, i) => (i === index ? { ...step, ...change } : step));

/** Start review: version `published` → `in_review`, the first step pending and due, the rest waiting. */
export function startReview(state: VersionState, dueAt: string): Review {
  return {
    state: moveVersion(state, 'in_review'),
    steps: REVIEW_STEP_ROLES.map((role, i) => (i === 0
      ? { role, state: moveStep('waiting', 'pending'), due_at: dueAt }
      : { role, state: 'waiting', due_at: null })),
  };
}

/**
 * Approve or reject one step. Approving the last step approves the version, a rejection rejects it, and any other
 * approval opens the next step with its own due time. Refusals follow the published sentences.
 */
export function decideStep(
  version: ReviewedVersion, steps: ReviewStep[], target: ReviewStepRole, verdict: 'approved' | 'rejected', nextDueAt: string,
): Review {
  if (version.state === 'voided') throw new ApiError('review_voided', copy.reviewVoided(version.replacedByNumber));
  if (version.state === 'published' && steps.some((step) => step.state === 'expired')) {
    throw new ApiError('review_expired', copy.REVIEW_EXPIRED);
  }
  const state = moveVersion(version.state, verdict);
  const index = steps.findIndex((step) => step.role === target);
  if (steps[index].state === 'waiting') throw new ApiError('out_of_order', copy.WAITING_ON_STEP_BEFORE);
  const decided = withStep(steps, index, { state: moveStep(steps[index].state, verdict) });
  if (verdict === 'rejected') return { state, steps: decided };
  const next = decided[index + 1];
  if (next === undefined) return { state, steps: decided };
  return { state: 'in_review', steps: withStep(decided, index + 1, { state: moveStep(next.state, 'pending'), due_at: nextDueAt }) };
}

/** The pending step that passed its due time, as the version goes back to `published`. */
export function expireReview(steps: ReviewStep[]): Review {
  const pending = pendingStep(steps);
  return {
    state: moveVersion('in_review', 'published'),
    steps: steps.map((step) => (step === pending ? { ...step, state: moveStep('pending', 'expired') } : step)),
  };
}

/** A newer version voids a review: the version and every undecided step. Approved and rejected versions keep theirs. */
export function voidReview(state: VersionState, steps: ReviewStep[]): Review {
  const next = stateWhenReplaced(state);
  if (next === state) return { state, steps };
  return { state: moveVersion(state, next), steps: steps.map((step) => (step.state === 'waiting' || step.state === 'pending' ? { ...step, state: moveStep(step.state, 'voided') } : step)) };
}

// ---------------------------------------------------------------- issues and RFIs

export interface IssueActor { username: string; manager: boolean }

/** Only `manage` or the issue's creator may reopen; this is checked before the state, as 403 comes before 409. */
export function assertMayReopen(to: IssueState, creator: string, actor: IssueActor): void {
  if (to === 'open' && !actor.manager && actor.username !== creator) throw new ApiError('forbidden', copy.ISSUE_REOPEN_REFUSED);
}

/** An issue with an RFI that is not closed cannot close. */
export function moveIssueTo(from: IssueState, to: IssueState, rfiStates: readonly RfiState[]): IssueState {
  const state = moveIssue(from, to);
  if (state === 'closed' && rfiStates.some((rfi) => rfi !== 'closed')) throw new ApiError('rfi_open', copy.CLOSE_RFI_FIRST);
  return state;
}

export interface RfiRecord { state: RfiState; asker: string; addressee: string; ball_in_court: string; answer: string | null }

/** Who holds the ball in court: the addressee while the RFI is sent, the asker in every other state. */
export const ballFor = (state: RfiState, asker: string, addressee: string): string => (state === 'sent' ? addressee : asker);

/** Only the ball in court moves an RFI; sending hands the ball to the addressee, answering hands it back to the asker. */
export function moveRfiTo(rfi: RfiRecord, to: RfiState, answer: string | undefined, actor: string): RfiRecord {
  if (actor !== rfi.ball_in_court) throw new ApiError('not_ball_in_court', copy.rfiWithOther(rfi.ball_in_court));
  const state = moveRfi(rfi.state, to);
  if (state === 'answered' && !answer?.trim()) {
    throw fieldError('answer', copy.RFI_ANSWER_REQUIRED);
  }
  return { ...rfi, state, ball_in_court: ballFor(state, rfi.asker, rfi.addressee), answer: state === 'answered' ? answer ?? null : rfi.answer };
}

// ---------------------------------------------------------------- export jobs

/** Only a failed job can be retried; a queued job also moves to `running`, but by itself. */
export const canRetryExport = (state: ExportState): boolean => state === 'failed';
/** The state of a job when it is asked for. */
export const FIRST_EXPORT_STATE: ExportState = 'queued';
/** The states of a job that is still working: the export dialog shows progress and no button. */
export const BUSY_EXPORT_STATES: readonly ExportState[] = ['queued', 'running'];
export const isExportBusy = (state: ExportState): boolean => BUSY_EXPORT_STATES.includes(state);
/** Only a `ready` job has a file to download. */
export const isDownloadable = (state: ExportState): boolean => state === 'ready';

/** Retry is how a job goes back to `running`; only a failed one may be retried. */
export function retryExport(state: ExportState): ExportState {
  if (!canRetryExport(state)) throw new ApiError('illegal_transition', copy.exportTransition(state, 'running'));
  return moveExport(state, 'running');
}

export const EXPORT_STEP_PERCENT = 20;
/** The object is written once the job reaches this progress; it is `ready` only when storage confirms the write. */
export const EXPORT_WRITE_AT = 80;
export const EXPORT_DONE = 100;

// ---------------------------------------------------------------- compare swipe

const SWIPE_MIN = 0;
export const SWIPE_MAX = 100;
export const SWIPE_START = 50;

/** The swipe divider's share of the sheet drawn from the later version, in whole percent from 0 to 100. */
export const clampSwipe = (percent: number): number => clamp(Math.round(percent), SWIPE_MIN, SWIPE_MAX);

/** The swipe percent a pointer `offset` pixels into a track `width` pixels wide stands for. */
export const swipeFromPointer = (offset: number, width: number): number => clampSwipe((offset / width) * SWIPE_MAX);
