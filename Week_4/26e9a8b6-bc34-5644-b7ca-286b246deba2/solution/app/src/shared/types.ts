export const CURRENCIES = ['EUR', 'GBP', 'USD', 'JPY'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const PHASES = ['open_up', 'take_out', 'fit_new', 'close_up', 'test_it'] as const;
export type Phase = (typeof PHASES)[number];
export const AXES = ['x', 'y', 'z'] as const;
export type Axis = (typeof AXES)[number];
export type GuideState = 'draft' | 'published' | 'withdrawn';
export const VISIBILITIES = ['public', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export interface Camera { yaw: number; pitch: number; zoom: number }
export interface Callout { part_id: string; text: string }

export interface Part {
  id: string;
  name: string;
  node_path: string;
  unbound: boolean;
  axis: Axis;
  apart_mm: number;
  quantity: number;
  unit_price: number;
  fitted_at: string | null;
}

export interface Step {
  id: string;
  number: number;
  title: string;
  text: string;
  phase: Phase;
  explode: number;
  focus_parts: string[];
  camera: Camera;
  callouts: Callout[];
}

export interface ReadingStep extends Step { parts_cost: number; parts_cost_text: string }

export interface Model {
  id: string;
  state: 'stored';
  bytes: number;
  sha256: string;
  bbox_mm: [number, number, number];
  scale: number;
  scale_confirmed: boolean;
}

export interface ForkCredit { guide_id: string; title: string; author_name: string; version: number }

export interface User { id: string; name: string; email: string; confirmed: boolean }

export interface GuideReading {
  id: string;
  slug: string;
  title: string;
  author: { id: string; name: string };
  state: GuideState;
  visibility: Visibility;
  currency: Currency;
  tags: string[];
  published_version: number | null;
  like_count: number;
  fork_count: number;
  model_id: string | null;
  model_scale: number;
  total_cost: number;
  total_cost_text: string;
  part_count: number;
  step_count: number;
  parts: Part[];
  steps: ReadingStep[];
  forked_from: ForkCredit | null;
  liked: boolean;
}

export interface Working {
  id: string;
  slug: string;
  title: string;
  state: GuideState;
  visibility: Visibility;
  currency: Currency;
  tags: string[];
  revision: number;
  latest_version: number | null;
  guide_total: number;
  guide_total_text: string;
  field_revisions: Record<string, number>;
  model: Model | null;
  parts: Part[];
  steps: Step[];
  forked_from: ForkCredit | null;
  coauthors: { id: string; name: string }[];
}

export interface VersionSummary {
  number: number;
  saved_at: string;
  saved_by: string;
  restored_from: number | null;
  step_count: number;
  parts_cost: number;
  parts_cost_text: string;
}

export interface VersionBody {
  number: number;
  steps: Step[];
  parts: Part[];
  model_id: string | null;
  parts_cost: number;
  parts_cost_text: string;
}

export interface Compare {
  older: number;
  newer: number;
  added: { position: number; title: string }[];
  removed: { position: number; title: string }[];
  changed: { position: number; title: string; fields: string[] }[];
  moved: { title: string; from: number; to: number }[];
  part_changes: { part: string; field: 'name' | 'quantity' | 'unit_price' | 'fitted_at'; from: string | number | null; to: string | number | null }[];
  cost_difference: number;
  cost_difference_text: string;
  currency: Currency;
}

export interface Question {
  id: string;
  guide_id: string;
  step: number;
  text: string;
  asked_by: string;
  asked_at: string;
  answer: { text: string; answered_by: string; answered_at: string } | null;
}

export interface DashboardQuestion extends Question { guide_title: string }

export interface GuideRow { id: string; slug: string; title: string; state: GuideState }

export interface SearchItem {
  id: string;
  slug: string;
  title: string;
  author_name: string;
  tags: string[];
  like_count: number;
  step_count: number;
  parts_cost_text: string;
}

export interface PresencePerson { id: string; name: string; step: number }

export type LiveEvent =
  | { type: 'field'; field: string; value: unknown; field_revision: number; revision: number; by: { id: string; name: string }; guide_total: number; guide_total_text: string }
  | { type: 'working' }
  | { type: 'version'; latest_version: number }
  | { type: 'state'; state: GuideState; published_version: number | null }
  | { type: 'counts'; like_count: number; fork_count: number }
  | { type: 'question'; question: Question }
  | { type: 'answer'; question: Question }
  | { type: 'alert_question'; guide_title: string; step: number }
  | { type: 'alert_answer'; author_name: string; step: number }
  | { type: 'presence'; people: PresencePerson[] };

export interface Limits {
  model_max_bytes: number;
  model_max_parts: number;
  question_limit: number;
  question_window_seconds: number;
  signin_limit: number;
  signin_window_seconds: number;
  resend_limit: number;
  resend_window_seconds: number;
  confirm_token_ttl_seconds: number;
  presence_grace_seconds: number;
  guide_title_max: number;
  step_title_max: number;
  step_text_max: number;
  callout_text_max: number;
  part_name_max: number;
  question_text_max: number;
  answer_text_max: number;
  tag_text_max: number;
  guide_tag_max: number;
  guide_step_max: number;
  step_callout_max: number;
  search_query_max: number;
  search_tag_max: number;
  page_size_default: number;
  page_size_max: number;
}
