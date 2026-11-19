import { conflict, forbidden } from '../errors.js';

export type ApplicationState = 'applied' | 'viewed' | 'interviewing' | 'offered' | 'rejected' | 'withdrawn';
type MovedBy = 'applicant' | 'poster' | 'system';
/** Who a history entry is attributed to. */
export type HistoryBy = 'you' | 'hiring_team' | 'automatic';
/** The caller's relation to an application. */
export type ApplicationRole = 'applicant' | 'poster';

interface Stage {
  label: string;
  statusText: string;
  movedBy: MovedBy;
  next: ApplicationState[];
}

/** The published state machine: the one table every stage rule reads. */
const STAGES: Record<ApplicationState, Stage> = {
  applied: { label: 'Applied', statusText: 'Application submitted', movedBy: 'applicant', next: ['viewed', 'rejected', 'withdrawn'] },
  viewed: { label: 'Viewed', statusText: 'Viewed by the hiring team', movedBy: 'system', next: ['interviewing', 'rejected', 'withdrawn'] },
  interviewing: { label: 'Interviewing', statusText: 'Interviewing', movedBy: 'poster', next: ['offered', 'rejected', 'withdrawn'] },
  offered: { label: 'Offered', statusText: 'Offer extended', movedBy: 'poster', next: ['rejected'] },
  rejected: { label: 'Rejected', statusText: 'Not selected', movedBy: 'poster', next: [] },
  withdrawn: { label: 'Withdrawn', statusText: 'Withdrawn', movedBy: 'applicant', next: [] },
};

export const APPLICATION_STATES = Object.keys(STAGES) as ApplicationState[];

/** The stages an application moves through toward an offer: every stage that still has a way forward. */
export const PROGRESS_STATES = APPLICATION_STATES.filter((state) => STAGES[state].next.length > 0);

export const isApplicationState = (value: unknown): value is ApplicationState => typeof value === 'string' && value in STAGES;

export const statusText = (state: ApplicationState): string => STAGES[state].statusText;

/** The published `stages` list of a job page. */
export function publishedStages(): Array<{ state: ApplicationState; label: string; status_text: string; moved_by: MovedBy }> {
  return APPLICATION_STATES.map((state) => ({ state, label: STAGES[state].label, status_text: STAGES[state].statusText, moved_by: STAGES[state].movedBy }));
}

/** The applicant may only withdraw; the poster may make every other move. */
const mayMoveTo = (role: ApplicationRole, to: ApplicationState): boolean => (role === 'applicant') === (to === 'withdrawn');

/** The stages the role may move an application to from its current stage. */
export function legalTargets(role: ApplicationRole, from: ApplicationState): ApplicationState[] {
  return STAGES[from].next.filter((to) => mayMoveTo(role, to));
}

/** Refuses a move the role may not make (403) or the machine does not allow (409), in that order. */
export function assertMove(role: ApplicationRole, from: ApplicationState, to: ApplicationState): void {
  if (!mayMoveTo(role, to)) throw forbidden(role === 'applicant' ? 'not_poster' : 'not_applicant');
  if (!STAGES[from].next.includes(to)) throw conflict('invalid_transition', { from, to });
}

export const historyByRole = (role: ApplicationRole): HistoryBy => (role === 'applicant' ? 'you' : 'hiring_team');

/** Who a first history entry for this stage is attributed to. */
export const historyByState = (state: ApplicationState): HistoryBy => (STAGES[state].movedBy === 'applicant' ? 'you' : 'hiring_team');
