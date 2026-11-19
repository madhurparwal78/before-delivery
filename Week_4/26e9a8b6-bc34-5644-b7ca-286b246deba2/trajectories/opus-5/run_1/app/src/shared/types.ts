export type Currency = 'EUR' | 'GBP' | 'USD' | 'JPY';

export const CURRENCIES: readonly Currency[] = ['EUR', 'GBP', 'USD', 'JPY'];

export type Phase = 'open_up' | 'take_out' | 'fit_new' | 'close_up' | 'test_it';

export const PHASES: readonly Phase[] = ['open_up', 'take_out', 'fit_new', 'close_up', 'test_it'];

export const PHASE_NAMES: Record<Phase, string> = {
  open_up: 'Open up',
  take_out: 'Take out',
  fit_new: 'Fit new',
  close_up: 'Close up',
  test_it: 'Test it',
};

export type GuideState = 'draft' | 'published' | 'withdrawn';

export type Visibility = 'public' | 'private';

export type Axis = 'x' | 'y' | 'z';

export interface Camera {
  yaw: number;
  pitch: number;
  zoom: number;
}

export interface Callout {
  part_id: string;
  text: string;
}

export interface Part {
  id: string;
  name: string;
  node_path: string | null;
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

export interface ReaderStep extends Step {
  parts_cost: number;
  parts_cost_text: string;
}

export interface ModelRecord {
  id: string;
  state: 'stored';
  bytes: number;
  sha256: string;
  bbox_mm: [number, number, number];
  scale: number;
  scale_confirmed: boolean;
}

export interface ForkCredit {
  guide_id: string;
  title: string;
  author_name: string;
  version: number;
}

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
  total_cost: number;
  total_cost_text: string;
  part_count: number;
  step_count: number;
  parts: Part[];
  steps: ReaderStep[];
  forked_from: ForkCredit | null;
}

export interface GuideWorking {
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
  model: ModelRecord | null;
  parts: Part[];
  steps: Step[];
  forked_from: ForkCredit | null;
}

export interface QuestionAnswer {
  text: string;
  answered_by: string;
  answered_at: string;
}

export interface Question {
  id: string;
  guide_id: string;
  step: number;
  text: string;
  asked_by: string;
  asked_at: string;
  answer: QuestionAnswer | null;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  confirmed: boolean;
}
