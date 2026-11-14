// Wire and storage shapes shared by the server and the browser (types only, no logic).

export type QuestionType =
  | 'short_text' | 'long_text' | 'number' | 'choice' | 'checkbox' | 'dropdown'
  | 'grid' | 'ranking' | 'scale' | 'date' | 'file' | 'calculated';

export type Pattern = 'email' | 'phone' | 'digits' | 'letters';
export type FileKind = 'pdf' | 'png' | 'jpeg';

export interface ChoiceOption { value: string; label: string }
export interface ShowRule { name: string; when: string }
export interface Jump { name: string; when: string; to: string }

export interface Question {
  key: string;
  type: QuestionType;
  label: string;
  help?: string;
  required?: boolean;
  show_rule?: ShowRule;
  note?: string;
  options?: ChoiceOption[];
  shuffle?: boolean;
  min_length?: number;
  max_length?: number;
  pattern?: Pattern;
  min?: number | string;
  max?: number | string;
  decimals?: number;
  min_selected?: number;
  max_selected?: number;
  rows?: ChoiceOption[];
  columns?: ChoiceOption[];
  min_label?: string;
  max_label?: string;
  max_bytes?: number;
  accept?: FileKind[];
  formula?: string;
  places?: number;
  prefix?: string;
  suffix?: string;
  hidden?: boolean;
}

export interface Page {
  key: string;
  title: string;
  questions: Question[];
  show_rule?: ShowRule;
  jumps?: Jump[];
}

export interface FormCheck { name: string; page: string; target: string; fail_when: string; message: string }

export interface FormDefinition {
  title: string;
  intro: string;
  pages: Page[];
  checks: FormCheck[];
}

export interface FileAnswer { name: string; size: number; type: string }
export type AnswerValue = string | string[] | Record<string, string> | FileAnswer;
export type Answers = Record<string, AnswerValue>;

// ---- Evaluation (brief: API, Evaluation object) ----
export interface EvalQuestion {
  key: string;
  state: 'lit' | 'skipped';
  skipped_by: string | null;
  label: string;
  help: string | null;
}
export interface EvalPage {
  key: string;
  title: string;
  state: 'lit' | 'skipped';
  skipped_by: string | null;
  questions: EvalQuestion[];
}
export interface CalcValue { value: string | null; text: string }
export interface Evaluation {
  seq: number;
  pages: EvalPage[];
  shown_pages: number;
  /** 1-based place of the current page among the shown pages (0 when no current page was asked for). */
  page_number: number;
  values: Record<string, CalcValue>;
  hidden_now: number;
  restored: number;
  announce: string;
}

// ---- Errors ----
export interface ErrorItem { key: string; message: string; page?: string }
export interface ApiError { error: { code: string; message: string; items?: ErrorItem[] } }

// ---- Respondent structure: the static, safe part of the live edition's questions ----
export interface StructureQuestion {
  type: QuestionType;
  required: boolean;
  options?: ChoiceOption[]; // already in shuffled order
  rows?: ChoiceOption[];
  columns?: ChoiceOption[];
  min?: number | string;
  max?: number | string;
  decimals?: number;
  min_label?: string;
  max_label?: string;
  accept?: FileKind[];
  max_bytes?: number;
}
export interface RespondentState {
  id: string;
  edition: number;
  page: string;
  answers: Answers;
  evaluation: Evaluation;
  structure: Record<string, StructureQuestion>;
  title: string;
  /** The server's date (YYYY-MM-DD): where the date picker opens when nothing is chosen. */
  today: string;
  /** Resume only. */
  notice?: string | null;
  saved_at?: string | null;
}

// ---- Co-editing changes (brief: API, Change shapes) ----
export type Change =
  | { op: 'set'; key: string; field: string; value: unknown; base_rev: number }
  | { op: 'add_question'; page: string; question: Question; base_rev: number }
  | { op: 'remove_question'; key: string; base_rev: number }
  | { op: 'move_question'; key: string; position: number; base_rev: number }
  | { op: 'add_page'; page: Page; position: number; base_rev: number }
  | { op: 'remove_page'; key: string; base_rev: number };

export interface Settings {
  closes_at: string | null;
  response_limit: number | null;
  closed_message: string | null;
  copy_to: string | null;
}
export type FormState = 'draft' | 'open' | 'closed';
export type ClosedReason = 'time' | 'limit' | 'hand' | null;
export interface ClosedText { heading: string; text: string }
export interface Problem { key: string; message: string }

export interface FormDetail {
  id: string;
  slug: string;
  title: string;
  role: 'owner' | 'editor';
  state: FormState;
  closed_reason: ClosedReason;
  edition: number | null;
  rev: number;
  draft: FormDefinition;
  problems: Problem[];
  settings: Settings;
  responses: number;
  server_now: string;
}

// ---- Summary (brief: Summary) ----
export interface SummaryRow { value: string; label: string; count: string; percent: string }
export interface SummaryQuestion {
  key: string;
  label: string;
  type: QuestionType;
  answered: string;
  rows: SummaryRow[];
  mean: string | null;
  lowest: string | null;
  highest: string | null;
  grid: { row: string; label: string; rows: SummaryRow[] }[];
  ranking: { value: string; label: string; mean_position: string }[];
}
export interface Summary { count: string; questions: SummaryQuestion[] }

// ---- Owner's response view ----
export interface ResponseItem { key: string; label: string; text: string; value: AnswerValue | null; note?: string }
export interface ResponseFile { key: string; name: string; size: number; type: string; url: string }
export interface ResponseView {
  id: string;
  reference: string;
  edition: number;
  submitted_at: string;
  items: ResponseItem[];
  files: ResponseFile[];
}

// ---- WebSocket frames (brief: API, Live updates over /ws) ----
export interface Person { id: string; name: string }
export type ClientFrame =
  | { type: 'join'; form: string; view: 'builder' | 'summary' }
  | { type: 'join'; response: string }
  | { type: 'change'; change: Change; ref: number };
export type ServerFrame =
  | { type: 'joined'; rev: number; live: boolean }
  | { type: 'applied'; seq: number; by: Person; change: Change; conflict_with: string | null }
  | { type: 'ack'; ref: number; seq: number; conflict_with: string | null }
  | { type: 'presence'; editors: Person[] }
  | { type: 'summary'; summary: Summary }
  | { type: 'form_state'; state: FormState; closed_reason: ClosedReason; closed: ClosedText | null }
  | { type: 'moved' }
  | { type: 'refused'; ref?: number; error: ApiError['error'] };
