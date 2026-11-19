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
  search_db_timeout_ms: number;
  page_size_default: number;
  page_size_max: number;
}

export const DEFAULT_LIMITS: Limits = {
  model_max_bytes: 20000000,
  model_max_parts: 64,
  question_limit: 10,
  question_window_seconds: 3600,
  signin_limit: 5,
  signin_window_seconds: 900,
  resend_limit: 3,
  resend_window_seconds: 3600,
  confirm_token_ttl_seconds: 86400,
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
};

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function limitsFromEnv(env: NodeJS.ProcessEnv): Limits {
  return {
    model_max_bytes: int(env.MODEL_MAX_BYTES, DEFAULT_LIMITS.model_max_bytes),
    model_max_parts: int(env.MODEL_MAX_PARTS, DEFAULT_LIMITS.model_max_parts),
    question_limit: int(env.QUESTION_LIMIT, DEFAULT_LIMITS.question_limit),
    question_window_seconds: int(env.QUESTION_WINDOW_SECONDS, DEFAULT_LIMITS.question_window_seconds),
    signin_limit: int(env.SIGNIN_LIMIT, DEFAULT_LIMITS.signin_limit),
    signin_window_seconds: int(env.SIGNIN_WINDOW_SECONDS, DEFAULT_LIMITS.signin_window_seconds),
    resend_limit: int(env.RESEND_LIMIT, DEFAULT_LIMITS.resend_limit),
    resend_window_seconds: int(env.RESEND_WINDOW_SECONDS, DEFAULT_LIMITS.resend_window_seconds),
    confirm_token_ttl_seconds: int(env.CONFIRM_TOKEN_TTL_SECONDS, DEFAULT_LIMITS.confirm_token_ttl_seconds),
    presence_grace_seconds: int(env.PRESENCE_GRACE_SECONDS, DEFAULT_LIMITS.presence_grace_seconds),
    guide_title_max: int(env.GUIDE_TITLE_MAX, DEFAULT_LIMITS.guide_title_max),
    step_title_max: int(env.STEP_TITLE_MAX, DEFAULT_LIMITS.step_title_max),
    step_text_max: int(env.STEP_TEXT_MAX, DEFAULT_LIMITS.step_text_max),
    callout_text_max: int(env.CALLOUT_TEXT_MAX, DEFAULT_LIMITS.callout_text_max),
    part_name_max: int(env.PART_NAME_MAX, DEFAULT_LIMITS.part_name_max),
    question_text_max: int(env.QUESTION_TEXT_MAX, DEFAULT_LIMITS.question_text_max),
    answer_text_max: int(env.ANSWER_TEXT_MAX, DEFAULT_LIMITS.answer_text_max),
    tag_text_max: int(env.TAG_TEXT_MAX, DEFAULT_LIMITS.tag_text_max),
    guide_tag_max: int(env.GUIDE_TAG_MAX, DEFAULT_LIMITS.guide_tag_max),
    guide_step_max: int(env.GUIDE_STEP_MAX, DEFAULT_LIMITS.guide_step_max),
    step_callout_max: int(env.STEP_CALLOUT_MAX, DEFAULT_LIMITS.step_callout_max),
    search_query_max: int(env.SEARCH_QUERY_MAX, DEFAULT_LIMITS.search_query_max),
    search_tag_max: int(env.SEARCH_TAG_MAX, DEFAULT_LIMITS.search_tag_max),
    search_db_timeout_ms: int(env.SEARCH_DB_TIMEOUT_MS, DEFAULT_LIMITS.search_db_timeout_ms),
    page_size_default: int(env.PAGE_SIZE_DEFAULT, DEFAULT_LIMITS.page_size_default),
    page_size_max: int(env.PAGE_SIZE_MAX, DEFAULT_LIMITS.page_size_max),
  };
}
