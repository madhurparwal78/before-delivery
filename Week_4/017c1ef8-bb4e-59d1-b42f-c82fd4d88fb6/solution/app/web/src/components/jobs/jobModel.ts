import { ApiError } from '../../api';
import type { ApplicationState, JobCard } from '../../types';

export type Workplace = JobCard['workplace'];

export const WORKPLACE_LABELS: Record<Workplace, string> = { 'on-site': 'On-site', hybrid: 'Hybrid', remote: 'Remote' };
export const WORKPLACES: Workplace[] = ['on-site', 'hybrid', 'remote'];

export const SOMETHING_WENT_WRONG = 'Something went wrong. Try again.';
export const STORAGE_UNAVAILABLE = 'Uploads are unavailable right now. Try again later.';

export interface Stage {
  state: ApplicationState;
  label: string;
  status_text: string;
  moved_by: 'applicant' | 'poster' | 'system';
}

/** Who a stage's move is attributed to on the job page. */
export const MOVED_BY_TEXT: Record<Stage['moved_by'], string> = {
  applicant: 'the applicant',
  poster: 'the hiring team',
  system: 'automatically when the hiring team first opens it',
};

export type QuestionType = 'short_answer' | 'yes_no' | 'single_choice' | 'number';

export interface Question {
  id: string;
  type: QuestionType;
  text: string;
  required: boolean;
  knock_out?: boolean;
  ideal?: 'yes' | 'no' | null;
  options: string[] | null;
  accepted?: string[] | null;
  minimum?: number | null;
  maximum?: number | null;
}

interface MyApplication {
  id: string;
  state: ApplicationState;
  status_text: string;
}

export interface JobObject extends JobCard {
  description: string;
  questions: Question[];
  stages: Stage[];
  my_application: MyApplication | null;
  is_admin: boolean;
  is_poster: boolean;
}

export interface HistoryEntry {
  state: ApplicationState;
  status_text: string;
  at: string;
  by: 'you' | 'hiring_team' | 'automatic';
  reason: string | null;
}

export interface ApplicationObject {
  id: string;
  job: { id: string; title: string; company: { id: string; name: string } };
  state: ApplicationState;
  status_text: string;
  history: HistoryEntry[];
  moves: ApplicationState[];
  applicant?: { id: string; handle: string; name: string; headline: string };
  resume_url?: string | null;
}

export interface MyJobCard extends JobCard {
  my_application: (MyApplication & { history?: HistoryEntry[]; moves?: ApplicationState[] }) | null;
}

export interface BoardCard {
  id: string;
  applicant: { id: string; name: string; handle: string; headline: string };
  state: ApplicationState;
  entered_at: string;
  moves: ApplicationState[];
}

export type BoardColumns = Record<ApplicationState, BoardCard[]>;

interface FunnelRow {
  stage: ApplicationState;
  count: number;
  rate: number | null;
  automatic?: number;
}

export interface Funnel {
  rows: FunnelRow[];
  median_first_view_minutes: number | null;
}

export interface PageResults<T> {
  total: number;
  results: T[];
  next_cursor: string | null;
}

/** The 422 field messages of a validation refusal, or an empty record. */
export function fieldMessages(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {};
  const fields = error.body.fields;
  return typeof fields === 'object' && fields !== null ? (fields as Record<string, string>) : {};
}
