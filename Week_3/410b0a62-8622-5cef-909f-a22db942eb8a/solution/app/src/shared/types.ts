export type Sport = 'bike' | 'run';
export type Role = 'athlete' | 'coach';
export type WorkoutKind = 'planned' | 'completed';
export type WorkoutSource = 'builder' | 'library' | 'plan' | 'copy' | 'manual' | 'file';
export type Compliance = 'on-target' | 'close' | 'off-target' | 'missed' | 'unplanned' | 'planned';
export type ThresholdKind = 'ftp' | 'pace';
export type LinkStatus = 'requested' | 'accepted' | 'declined' | 'removed' | 'expired';

export type PlainStepKind = 'warmup' | 'steady' | 'recovery' | 'cooldown';
export interface PlainStep {
  kind: PlainStepKind;
  duration_s: number;
  target_pct: number;
}
export interface IntervalPart {
  duration_s: number;
  target_pct: number;
}
export interface IntervalStep {
  kind: 'interval';
  repeat: number;
  work: IntervalPart;
  recovery: IntervalPart;
}
export type Step = PlainStep | IntervalStep;

export interface FileInfo {
  name: string;
  size: number;
  sha256: string;
  content_type: string;
}

export interface Workout {
  id: string;
  athlete_id: string;
  kind: WorkoutKind;
  sport: Sport;
  title: string;
  date: string;
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
  file: FileInfo | null;
}

export interface Item {
  planned: Workout | null;
  completed: Workout | null;
  compliance: Compliance;
  ratio: number | null;
}

export interface Tally {
  'on-target': number;
  close: number;
  'off-target': number;
  missed: number;
  unplanned: number;
  planned: number;
}

export interface SportTotals {
  bike_tss: number;
  run_tss: number;
  bike_s: number;
  run_s: number;
  sessions: number;
}

export interface CalendarDay {
  date: string;
  items: Item[];
}

export interface WeekSummary {
  week: string;
  monday: string;
  planned_tss: number;
  completed_tss: number;
  tsb: number;
  tally: Tally;
  sports: SportTotals;
  days: CalendarDay[];
}

export interface WeeksResponse {
  today: string;
  weeks: WeekSummary[];
}

export interface SeriesDay {
  date: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
}

export interface Threshold {
  kind: ThresholdKind;
  value: number;
  effective_from: string;
}

export interface AthleteEvent {
  name: string;
  date: string;
}

export interface AthleteDetail {
  id: string;
  name: string;
  tz: string;
  series_start: string;
  thresholds: Threshold[];
  events: AthleteEvent[];
}

export interface Me {
  id: string;
  role: Role;
  name: string;
  email: string;
  tz: string;
  coach_code: string | null;
  today: string;
}

export interface AthleteRow {
  id: string;
  name: string;
  tz: string;
  week: { week: string; planned_tss: number; completed_tss: number };
  latest: Item | null;
}

export interface Comment {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
}

export interface WorkoutDetail {
  workout: Workout;
  item: Item;
  comments: Comment[];
}

export interface LibraryItem {
  id: string;
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
  duration_s: number;
}

export interface Plan {
  id: string;
  name: string;
  weeks: number;
  entries: PlanEntry[];
}

export interface LinkRow {
  id: string;
  coach_id: string;
  coach_name: string;
  athlete_id: string;
  athlete_name: string;
  status: LinkStatus;
  expires_at: string;
}

export interface ApplyResult {
  created: number;
  skipped: number;
  kept: number;
  first_day: string;
  last_day: string;
  workouts: Workout[];
}

export interface CopyResult {
  created: number;
  skipped: number;
  workouts: Workout[];
}

export interface ThresholdResult {
  threshold: Threshold;
  rescored: number;
  series_from: string;
}

export type ChangeKind = 'workouts' | 'series' | 'comments' | 'links' | 'thresholds' | 'events';
export interface ChangeEvent {
  athlete_id: string;
  what: ChangeKind;
  workout_id?: string;
}
export interface NoticeEvent {
  text: string;
}

export interface ValidationBody {
  errors: Record<string, string>;
}
export interface ErrorBody {
  error: string;
  message: string;
}
