interface Config {
  port: number;
  databaseUrl: string;
  valkeyUrl: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  publicUrl: string;
  gradingKey: string | undefined;
  outlineToday: string | undefined;
  outlineTimeZone: string;
  confirmCodeSeconds: number;
  inviteTtlSeconds: number;
  trashSeconds: number;
  undoDepth: number;
  streamMaxLength: number;
  heartbeatSeconds: number;
  pauseAfterSeconds: number;
  bulletMaxChars: number;
  maxDepth: number;
  searchMaxChars: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === "") throw new Error(`${name} must be set in the environment`);
  return value;
}

function count(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: count(env, "APP_PUBLIC_PORT", 4173),
    databaseUrl: required(env, "DATABASE_URL"),
    valkeyUrl: required(env, "VALKEY_URL"),
    smtpHost: required(env, "SMTP_HOST"),
    smtpPort: Number(required(env, "SMTP_PORT")),
    mailFrom: env.MAIL_FROM ?? "Twigline <hello@twigline.test>",
    publicUrl: required(env, "APP_PUBLIC_URL").replace(/\/+$/, ""),
    gradingKey: env.GRADING_KEY === "" ? undefined : env.GRADING_KEY,
    outlineToday: env.OUTLINE_TODAY === "" ? undefined : env.OUTLINE_TODAY,
    outlineTimeZone: env.OUTLINE_TIME_ZONE ?? "Europe/London",
    confirmCodeSeconds: count(env, "TWIG_CONFIRM_CODE_SECONDS", 900),
    inviteTtlSeconds: count(env, "TWIG_INVITE_TTL_SECONDS", 259_200),
    trashSeconds: count(env, "TWIG_TRASH_SECONDS", 2_592_000),
    undoDepth: count(env, "TWIG_UNDO_DEPTH", 100),
    streamMaxLength: count(env, "TWIG_STREAM_MAXLEN", 10_000),
    heartbeatSeconds: count(env, "TWIG_HEARTBEAT_SECONDS", 15),
    pauseAfterSeconds: count(env, "TWIG_PAUSE_AFTER_SECONDS", 5),
    bulletMaxChars: count(env, "TWIG_BULLET_MAX_CHARS", 4000),
    maxDepth: count(env, "TWIG_MAX_DEPTH", 40),
    searchMaxChars: count(env, "TWIG_SEARCH_MAX_CHARS", 200),
  };
}

export const config: Config = loadConfig(process.env);
