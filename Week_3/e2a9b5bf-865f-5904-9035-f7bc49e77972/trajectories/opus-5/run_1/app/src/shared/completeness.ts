import type { ObjectKind, ProgramEdition } from './types.js';

/** The facts the completeness rule needs about one observation. */
export interface CompletenessSubject {
  id: string;
  object_id: string;
  kind: ObjectKind;
  evening_date: string;
  observed_at: string | null;
  seeing: number | null;
  transparency_nelm: number | null;
  concentration_class: string | null;
  has_pair: boolean;
  description: string;
  has_sketch: boolean;
  /** Creation order, used only to break an equal observed_at. */
  sequence: number;
}

export interface ProgramRules {
  required_count: number;
  editions: ProgramEdition[];
  object_ids: string[];
}

/**
 * The rule edition in force on an observation's evening: the newest edition
 * whose effective_from is on or before that evening date.
 */
export function editionFor(editions: ProgramEdition[], eveningDate: string): ProgramEdition {
  let chosen = editions[0];
  if (!chosen) throw new Error('a program always has at least one edition');
  for (const edition of editions) {
    if (edition.effective_from <= eveningDate) chosen = edition;
  }
  return chosen;
}

export type CompletenessFailure =
  | 'not_on_program'
  | 'missing_ut_time'
  | 'missing_seeing'
  | 'missing_transparency'
  | 'missing_concentration'
  | 'missing_pair'
  | 'short_description'
  | 'missing_sketch';

/**
 * The published completeness rule, in failure order. Aperture and magnification
 * always hold, because every session has optics.
 */
export function completenessFailures(
  subject: CompletenessSubject,
  program: ProgramRules,
): CompletenessFailure[] {
  if (!program.object_ids.includes(subject.object_id)) return ['not_on_program'];
  const edition = editionFor(program.editions, subject.evening_date);
  const failures: CompletenessFailure[] = [];
  if (subject.observed_at === null) failures.push('missing_ut_time');
  if (subject.seeing === null || subject.seeing < 1 || subject.seeing > 10) {
    failures.push('missing_seeing');
  }
  if (subject.transparency_nelm === null) failures.push('missing_transparency');
  if (edition.concentration_required && subject.concentration_class === null) {
    failures.push('missing_concentration');
  }
  if (edition.pair_required && subject.kind === 'double_star' && !subject.has_pair) {
    failures.push('missing_pair');
  }
  if (subject.description.trim().length < edition.min_description) {
    failures.push('short_description');
  }
  if (edition.sketch_required && !subject.has_sketch) failures.push('missing_sketch');
  return failures;
}

export function qualifies(subject: CompletenessSubject, program: ProgramRules): boolean {
  return completenessFailures(subject, program).length === 0;
}

/** "Newest" is the latest observed_at; an equal observed_at goes to the later created. */
function newerThan(a: CompletenessSubject, b: CompletenessSubject): boolean {
  if (a.observed_at === b.observed_at) return a.sequence > b.sequence;
  if (a.observed_at === null) return false;
  if (b.observed_at === null) return true;
  return a.observed_at > b.observed_at;
}

/** The newest qualifying observation of an object, or null when none qualifies. */
export function representativeQualifying(
  subjects: CompletenessSubject[],
  objectId: string,
  program: ProgramRules,
): CompletenessSubject | null {
  let best: CompletenessSubject | null = null;
  for (const subject of subjects) {
    if (subject.object_id !== objectId) continue;
    if (!qualifies(subject, program)) continue;
    if (best === null || newerThan(subject, best)) best = subject;
  }
  return best;
}

/** Build packet falls back to the newest observation of an object when none qualifies. */
export function representativeAny(
  subjects: CompletenessSubject[],
  objectId: string,
): CompletenessSubject | null {
  let best: CompletenessSubject | null = null;
  for (const subject of subjects) {
    if (subject.object_id !== objectId) continue;
    if (best === null || newerThan(subject, best)) best = subject;
  }
  return best;
}

export interface Progress {
  qualifying: number;
  total: number;
  required: number;
}

export function progressFor(subjects: CompletenessSubject[], program: ProgramRules): Progress {
  let qualifying = 0;
  for (const objectId of program.object_ids) {
    if (representativeQualifying(subjects, objectId, program) !== null) qualifying += 1;
  }
  return {
    qualifying,
    total: program.object_ids.length,
    required: program.required_count,
  };
}

/** The rows Build packet starts a draft from, in the program's list order. */
export function draftRowsFor(
  subjects: CompletenessSubject[],
  program: ProgramRules,
): CompletenessSubject[] {
  const rows: CompletenessSubject[] = [];
  for (const objectId of program.object_ids) {
    const chosen =
      representativeQualifying(subjects, objectId, program) ??
      representativeAny(subjects, objectId);
    if (chosen) rows.push(chosen);
  }
  return rows;
}
