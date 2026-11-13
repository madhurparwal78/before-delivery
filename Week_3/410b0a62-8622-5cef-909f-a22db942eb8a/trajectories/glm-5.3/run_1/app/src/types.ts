import type { LocalDate } from './dates.js';
import type { Step, ThresholdKind, ComplianceState } from './domain.js';

export type Sport = 'bike' | 'run';
export type WorkoutKind = 'planned' | 'completed';
export type WorkoutSource = 'builder' | 'library' | 'plan' | 'copy' | 'manual' | 'file';

export interface UserRow {
  id: string;
  role: 'athlete' | 'coach';
  name: string;
  email: string;
  tz: string;
  coach_code: string | null;
  series_start: LocalDate | null;
  start_ctl: number;
  start_atl: number;
}

export interface WorkoutRow {
  id: string;
  athlete_id: string;
  kind: WorkoutKind;
  sport: Sport;
  title: string;
  date: LocalDate;
  start_local: string | null;
  start_utc: string | null;
  duration_s: number;
  steps: Step[] | null;
  planned_tss: number | null;
  planned_if: number | null;
  tss: number | null;
  if: number | null;
  np_w: number | null;
  ns_mps: number | null;
  source: WorkoutSource;
  version: number;
  file_name: string | null;
  file_size: number | null;
  file_sha256: string | null;
  file_content_type: string | null;
  created_at: Date;
}

export interface CommentRow {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

export interface LinkRow {
  id: string;
  coach_id: string;
  coach_name: string;
  athlete_id: string;
  athlete_name: string;
  status: 'requested' | 'accepted' | 'declined' | 'removed' | 'expired';
  expires_at: string | null;
}

export interface ThresholdRow {
  id: string;
  athlete_id: string;
  kind: ThresholdKind;
  value: number;
  effective_from: LocalDate;
}

export interface SeriesRow {
  athlete_id: string;
  date: LocalDate;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
}

export interface EventRow {
  id: string;
  athlete_id: string;
  name: string;
  date: LocalDate;
}

export interface LibraryRow {
  id: string;
  owner_id: string;
  name: string;
  sport: Sport;
  steps: Step[];
  duration_s: number;
  planned_tss: number;
  planned_if: number;
}

export interface PlanEntry {
  day: number;
  start_local: string;
  sport: Sport;
  title: string;
  steps: Step[] | null;
  duration_s: number | null;
}

export interface PlanRow {
  id: string;
  owner_id: string;
  name: string;
  weeks: number;
  entries: PlanEntry[];
}

// API JSON shapes ------------------------------------------------------------

export interface WorkoutJson {
  id: string;
  athlete_id: string;
  kind: WorkoutKind;
  sport: Sport;
  title: string;
  date: LocalDate;
  start_local: string | null;
  start_utc: string | null;
  duration_s: number;
  steps: Step[] | null;
  planned_tss: number | null;
  planned_if: number | null;
  tss: number | null;
  if: number | null;
  np_w: number | null;
  ns_mps: number | null;
  source: WorkoutSource;
  version: number;
  file: { name: string; size: number; sha256: string; content_type: string } | null;
}

export interface ItemJson {
  planned: WorkoutJson | null;
  completed: WorkoutJson | null;
  compliance: ComplianceState;
  ratio: number | null;
}

export interface CommentJson {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

export interface ThresholdJson {
  id: string;
  athlete_id: string;
  kind: ThresholdKind;
  value: number;
  effective_from: LocalDate;
}

export function workoutToJson(w: WorkoutRow): WorkoutJson {
  const file =
    w.file_name !== null && w.file_size !== null && w.file_sha256 !== null && w.file_content_type !== null
      ? { name: w.file_name, size: w.file_size, sha256: w.file_sha256, content_type: w.file_content_type }
      : null;
  return {
    id: w.id,
    athlete_id: w.athlete_id,
    kind: w.kind,
    sport: w.sport,
    title: w.title,
    date: w.date,
    start_local: w.start_local,
    start_utc: w.start_utc,
    duration_s: w.duration_s,
    steps: w.steps,
    planned_tss: w.planned_tss,
    planned_if: w.planned_if,
    tss: w.tss,
    if: w.if,
    np_w: w.np_w,
    ns_mps: w.ns_mps,
    source: w.source,
    version: w.version,
    file,
  };
}

export type LiveWhat = 'workouts' | 'series' | 'comments' | 'links' | 'thresholds' | 'events';

export interface LiveChangeEvent {
  athlete_id: string;
  what: LiveWhat;
  workout_id?: string;
}
