export interface Config {
  database_url: string;
  s3_endpoint: string;
  s3_region: string;
  s3_bucket: string;
  s3_force_path_style: boolean;
  s3_access_key_id: string;
  s3_secret_access_key: string;
  smtp_host: string;
  smtp_port: number;
  mail_from: string;
  hold_seconds: number;
  hold_sweep_seconds: number;
  request_key_ttl_seconds: number;
  session_seconds: number;
  sign_in_window_seconds: number;
  port: number;
  public_url: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const str = (name: string): string => {
    const value = env[name];
    if (value === undefined || value === "") throw new Error(`Missing required environment variable ${name}`);
    return value;
  };
  const strOr = (name: string, fallback: string): string => {
    const value = env[name];
    return value === undefined || value === "" ? fallback : value;
  };
  const int = (name: string, fallback: number): number => {
    const value = env[name];
    if (value === undefined || value === "") return fallback;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  };
  return {
    database_url: str("DATABASE_URL"),
    s3_endpoint: str("S3_ENDPOINT"),
    s3_region: str("S3_REGION"),
    s3_bucket: str("S3_BUCKET"),
    s3_force_path_style: strOr("S3_FORCE_PATH_STYLE", "false") === "true",
    s3_access_key_id: str("S3_ACCESS_KEY_ID"),
    s3_secret_access_key: str("S3_SECRET_ACCESS_KEY"),
    smtp_host: str("SMTP_HOST"),
    smtp_port: int("SMTP_PORT", 1025),
    mail_from: strOr("MAIL_FROM", "Tramela Estate <encomendas@tramela.example>"),
    hold_seconds: int("HOLD_SECONDS", 600),
    hold_sweep_seconds: int("HOLD_SWEEP_SECONDS", 15),
    request_key_ttl_seconds: int("REQUEST_KEY_TTL_SECONDS", 86400),
    session_seconds: int("SESSION_SECONDS", 43200),
    sign_in_window_seconds: int("SIGN_IN_WINDOW_SECONDS", 900),
    port: int("APP_PUBLIC_PORT", 4173),
    public_url: strOr("APP_PUBLIC_URL", ""),
  };
}
