export type CourseState = 'draft' | 'in_review' | 'published' | 'withdrawn';
export type Role = 'learner' | 'coordinator' | 'planner' | 'author';

export const COURSE_STATE_LABELS: Record<CourseState, string> = {
  draft: 'Draft',
  in_review: 'In review',
  published: 'Published',
  withdrawn: 'Withdrawn',
};

interface Edge {
  readonly from: CourseState;
  readonly to: CourseState;
  readonly by: Role;
  readonly requiresNote: boolean;
}

/** The only legal edges of the course lifecycle. */
const EDGES: readonly Edge[] = [
  { from: 'draft', to: 'in_review', by: 'author', requiresNote: false },
  { from: 'in_review', to: 'published', by: 'planner', requiresNote: false },
  { from: 'in_review', to: 'draft', by: 'planner', requiresNote: true },
  { from: 'published', to: 'withdrawn', by: 'planner', requiresNote: false },
];

const AUTHOR_TARGETS: readonly CourseState[] = ['in_review'];
const PLANNER_TARGETS: readonly CourseState[] = ['published', 'draft', 'withdrawn'];

export function isCourseState(value: unknown): value is CourseState {
  return value === 'draft' || value === 'in_review' || value === 'published' || value === 'withdrawn';
}

/** Whether this role may ever ask for this target state, whatever the current state is. */
export function mayRequestTransition(role: Role, to: CourseState): boolean {
  if (role === 'author') return AUTHOR_TARGETS.includes(to);
  if (role === 'planner') return PLANNER_TARGETS.includes(to);
  return false;
}

export function findEdge(from: CourseState, to: CourseState, role: Role): Edge | null {
  return EDGES.find((edge) => edge.from === from && edge.to === to && edge.by === role) ?? null;
}

/** The author edits their own draft; the planner edits any course in draft or in review. */
export function mayEditCourse(state: CourseState, role: Role, isOwnCourse: boolean): boolean {
  if (role === 'planner') return state === 'draft' || state === 'in_review';
  if (role === 'author') return isOwnCourse && state === 'draft';
  return false;
}

/** Withdrawn courses stay readable but cannot be bought, assigned, packed or given cohorts. */
export function isOpenForEnrolment(state: CourseState): boolean {
  return state === 'published';
}
