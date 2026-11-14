export type QuestionType =
  | "short_text"
  | "long_text"
  | "number"
  | "choice"
  | "checkbox"
  | "dropdown"
  | "grid"
  | "ranking"
  | "scale"
  | "date"
  | "file"
  | "calculated";

export interface Option {
  value: string;
  label: string;
}

export interface ShowRule {
  name: string;
  when: string;
}

export interface Jump {
  name: string;
  when: string;
  to: string;
}

export interface FormCheck {
  name: string;
  page: string;
  target: string;
  fail_when: string;
  message: string;
}

export type Pattern = "email" | "phone" | "digits" | "letters";
export type FileKind = "pdf" | "png" | "jpeg";

export interface Question {
  key: string;
  type: QuestionType;
  label: string;
  help?: string | null;
  required?: boolean;
  show_rule?: ShowRule | null;
  note?: string | null;
  min_length?: number;
  max_length?: number;
  pattern?: Pattern | null;
  min?: number | string;
  max?: number | string;
  decimals?: number;
  options?: Option[];
  shuffle?: boolean;
  min_selected?: number;
  max_selected?: number;
  rows?: Option[];
  columns?: Option[];
  min_label?: string | null;
  max_label?: string | null;
  max_bytes?: number;
  accept?: FileKind[];
  formula?: string;
  places?: number;
  prefix?: string | null;
  suffix?: string | null;
  hidden?: boolean;
}

export interface Page {
  key: string;
  title: string;
  questions: Question[];
  show_rule?: ShowRule | null;
  jumps?: Jump[];
}

export interface Definition {
  title: string;
  intro?: string | null;
  pages: Page[];
  checks?: FormCheck[];
}

export type AnswerValue = string | string[] | Record<string, string> | FileAnswer;

export interface FileAnswer {
  name: string;
  size: number;
  type: string;
}

export type Answers = Record<string, AnswerValue>;

export type ItemState = "lit" | "skipped";

export interface EvalQuestion {
  key: string;
  state: ItemState;
  skipped_by: string | null;
  label: string;
  help: string | null;
  field?: RespondentField;
}

export interface RespondentField {
  type: QuestionType;
  required: boolean;
  options?: Option[];
  rows?: Option[];
  columns?: Option[];
  min?: string;
  max?: string;
  min_label?: string | null;
  max_label?: string | null;
  decimals?: number;
  accept?: FileKind[];
  max_bytes?: number;
}

export interface EvalPage {
  key: string;
  title: string;
  state: ItemState;
  skipped_by: string | null;
  questions: EvalQuestion[];
}

export interface CalcValue {
  value: string | null;
  text: string;
}

export interface Evaluation {
  seq: number;
  pages: EvalPage[];
  shown_pages: number;
  values: Record<string, CalcValue>;
  hidden_now: number;
  restored: number;
  announce: string;
}

export interface ErrorItem {
  key: string;
  message: string;
  page?: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; items?: ErrorItem[] };
}

export interface Settings {
  closes_at: string | null;
  response_limit: number | null;
  closed_message: string | null;
  copy_to: string | null;
}

export type FormState = "draft" | "open" | "closed";
export type ClosedReason = "time" | "limit" | "hand";

export interface ClosedInfo {
  heading: string;
  text: string;
}

export type Change =
  | { op: "set"; key: string; field: string; value: unknown; base_rev: number }
  | { op: "add_question"; page: string; question: Question; base_rev: number }
  | { op: "remove_question"; key: string; base_rev: number }
  | { op: "move_question"; key: string; position: number; base_rev: number }
  | { op: "add_page"; page: Page; position: number; base_rev: number }
  | { op: "remove_page"; key: string; base_rev: number };

export interface SummaryRow {
  value: string;
  label: string;
  count: string;
  percent: string;
}

export interface SummaryQuestion {
  key: string;
  label: string;
  type: QuestionType;
  answered: string;
  rows?: SummaryRow[];
  mean?: string | null;
  lowest?: string | null;
  highest?: string | null;
  grid?: { row: string; label: string; rows: SummaryRow[] }[];
  ranking?: { value: string; label: string; mean_position: string | null }[];
}

export interface Summary {
  count: string;
  questions: SummaryQuestion[];
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
}
