import type { Limits } from '../shared/types';

function text(name: string, fallback?: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== '') return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Environment variable ${name} is required`);
}

function whole(name: string, fallback: number): number {
  const value = Number(text(name, String(fallback)));
  if (!Number.isInteger(value) || value < 0) throw new Error(`Environment variable ${name} must be a whole number`);
  return value;
}

const smtpFrom = text('MAIL_FROM');

export const config = {
  port: whole('APP_PUBLIC_PORT', 4173),
  publicUrl: text('APP_PUBLIC_URL').replace(/\/+$/, ''),
  databaseUrl: text('DATABASE_URL'),
  s3: {
    endpoint: text('S3_ENDPOINT').replace(/\/+$/, ''),
    region: text('S3_REGION'),
    bucket: text('S3_BUCKET'),
    pathStyle: text('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: text('SMTP_HOST'),
    port: whole('SMTP_PORT', 1025),
    from: smtpFrom,
    fromAddress: smtpFrom.includes('<') ? smtpFrom.slice(smtpFrom.indexOf('<') + 1, smtpFrom.indexOf('>')) : smtpFrom.trim(),
  },
  gradingRoutes: process.env.GRADING_ROUTES === 'on',
  searchDbTimeoutMs: whole('SEARCH_DB_TIMEOUT_MS', 2000),
  bodyLimit: 1_000_000,
  limits: {
    model_max_bytes: whole('MODEL_MAX_BYTES', 20_000_000),
    model_max_parts: whole('MODEL_MAX_PARTS', 64),
    question_limit: whole('QUESTION_LIMIT', 10),
    question_window_seconds: whole('QUESTION_WINDOW_SECONDS', 3600),
    signin_limit: whole('SIGNIN_LIMIT', 5),
    signin_window_seconds: whole('SIGNIN_WINDOW_SECONDS', 900),
    resend_limit: whole('RESEND_LIMIT', 3),
    resend_window_seconds: whole('RESEND_WINDOW_SECONDS', 3600),
    confirm_token_ttl_seconds: whole('CONFIRM_TOKEN_TTL_SECONDS', 86400),
    presence_grace_seconds: whole('PRESENCE_GRACE_SECONDS', 2),
    guide_title_max: whole('GUIDE_TITLE_MAX', 120),
    step_title_max: whole('STEP_TITLE_MAX', 120),
    step_text_max: whole('STEP_TEXT_MAX', 2000),
    callout_text_max: whole('CALLOUT_TEXT_MAX', 60),
    part_name_max: whole('PART_NAME_MAX', 80),
    question_text_max: whole('QUESTION_TEXT_MAX', 1000),
    answer_text_max: whole('ANSWER_TEXT_MAX', 1000),
    tag_text_max: whole('TAG_TEXT_MAX', 32),
    guide_tag_max: whole('GUIDE_TAG_MAX', 8),
    guide_step_max: whole('GUIDE_STEP_MAX', 60),
    step_callout_max: whole('STEP_CALLOUT_MAX', 6),
    search_query_max: whole('SEARCH_QUERY_MAX', 200),
    search_tag_max: whole('SEARCH_TAG_MAX', 8),
    page_size_default: whole('PAGE_SIZE_DEFAULT', 24),
    page_size_max: whole('PAGE_SIZE_MAX', 100),
  } satisfies Limits,
};

export const limits = config.limits;
