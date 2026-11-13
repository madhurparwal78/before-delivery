// The completeness rule together with the choice of rule edition (DP-28, DP-64).

export type ObjectKind = "globular" | "open_cluster" | "nebula" | "planetary_nebula" | "galaxy" | "double_star";

export interface RuleEdition {
  readonly edition: number;
  readonly effective_from: string; // YYYY-MM-DD
  readonly min_description: number;
  readonly sketch_required: boolean;
  readonly concentration_required: boolean;
  readonly pair_required: boolean;
}

// The edition in force on a session's evening date.
export function editionForDate(editions: readonly RuleEdition[], eveningDate: string): RuleEdition {
  let chosen = editions[0];
  for (const e of editions) {
    if (e.effective_from <= eveningDate) chosen = e;
  }
  return chosen!;
}

export interface ObservationForRule {
  readonly hasUtTime: boolean;
  readonly seeing: number | null;
  readonly transparencyNelm: number | null;
  readonly description: string;
  readonly hasSketch: boolean;
  readonly concentrationClass: string | null;
  readonly hasPair: boolean;
  readonly kind: ObjectKind;
}

export function qualifiesForEdition(observation: ObservationForRule, edition: RuleEdition): boolean {
  if (!observation.hasUtTime) return false;
  if (observation.seeing === null) return false;
  if (observation.transparencyNelm === null) return false;
  if (observation.description.trim().length < edition.min_description) return false;
  if (edition.sketch_required && !observation.hasSketch) return false;
  if (edition.concentration_required && observation.concentrationClass === null) return false;
  if (edition.pair_required && observation.kind === "double_star" && !observation.hasPair) return false;
  return true;
}

export function qualifies(observation: ObservationForRule, editions: readonly RuleEdition[], eveningDate: string): boolean {
  return qualifiesForEdition(observation, editionForDate(editions, eveningDate));
}

export type RejectionCode =
  | "not_on_program"
  | "duplicate_object"
  | "missing_ut_time"
  | "missing_seeing"
  | "missing_transparency"
  | "missing_concentration"
  | "missing_pair"
  | "short_description"
  | "missing_sketch";

export interface PacketRowProblem {
  readonly observation_id: string | null;
  readonly code: RejectionCode;
  readonly message: string;
}

export interface RowForCheck extends ObservationForRule {
  readonly observation_id: string;
  readonly designation: string;
  readonly evening_date: string;
}

export function rowReasons(
  observation: ObservationForRule,
  designation: string,
  eveningDate: string,
  edition: RuleEdition,
): PacketRowProblem[] {
  const problems: PacketRowProblem[] = [];
  const withId = (code: RejectionCode, message: string): PacketRowProblem => ({ observation_id: null, code, message });
  const label = `${designation}, ${eveningDate}`;
  if (!observation.hasUtTime) problems.push(withId("missing_ut_time", `${label}: add the UT time.`));
  if (observation.seeing === null) problems.push(withId("missing_seeing", `${label}: add seeing from 1 to 10.`));
  if (observation.transparencyNelm === null) problems.push(withId("missing_transparency", `${label}: add transparency as a limiting magnitude.`));
  if (edition.concentration_required && observation.concentrationClass === null) {
    problems.push(withId("missing_concentration", `${label}: add the Shapley-Sawyer concentration class.`));
  }
  if (edition.pair_required && observation.kind === "double_star" && !observation.hasPair) {
    problems.push(withId("missing_pair", `${label}: add the measured pair for this double star.`));
  }
  if (observation.description.trim().length < edition.min_description) {
    problems.push(withId("short_description", `${label}: the description needs at least ${edition.min_description} characters.`));
  }
  if (edition.sketch_required && !observation.hasSketch) {
    problems.push(withId("missing_sketch", `${label}: this program needs a sketch.`));
  }
  return problems;
}
