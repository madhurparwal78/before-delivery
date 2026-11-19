/**
 * The configurable limits. The key is the `snake_case` name used by
 * `GET /api/limits`; the environment variable is the same name upper-cased.
 */
export const LIMIT_DEFAULTS = {
  model_max_bytes: 20_000_000,
  model_max_parts: 64,
  question_limit: 10,
  question_window_seconds: 3600,
  signin_limit: 5,
  signin_window_seconds: 900,
  resend_limit: 3,
  resend_window_seconds: 3600,
  confirm_token_ttl_seconds: 86_400,
  presence_grace_seconds: 2,
  guide_title_max: 120,
  step_title_max: 120,
  step_text_max: 2000,
  callout_text_max: 60,
  part_name_max: 80,
  question_text_max: 1000,
  answer_text_max: 1000,
  tag_text_max: 32,
  guide_tag_max: 8,
  guide_step_max: 60,
  step_callout_max: 6,
  search_query_max: 200,
  search_tag_max: 8,
  search_db_timeout_ms: 2000,
  page_size_default: 24,
  page_size_max: 100,
} as const;

export type LimitName = keyof typeof LIMIT_DEFAULTS;

export type Limits = { [K in LimitName]: number };

export const LIMIT_NAMES = Object.keys(LIMIT_DEFAULTS) as LimitName[];

/** Code points, so a single emoji counts as one. */
export function codePointLength(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}
