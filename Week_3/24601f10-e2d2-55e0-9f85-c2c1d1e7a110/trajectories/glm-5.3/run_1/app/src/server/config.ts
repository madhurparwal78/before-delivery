export interface AppConfig {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  grading: boolean;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  confirmWindowMs: number;
  matchLimitMs: number;
  swissRoundMs: number;
  checkinDefaultMs: number;
  reportRate: number;
  loginRate: number;
  rosterMaxBytes: number;
  logoMaxBytes: number;
  toastMs: number;
}

function num(v: string | undefined, def: number): number {
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export const config: AppConfig = {
  port: process.env.APP_PUBLIC_PORT ? Number(process.env.APP_PUBLIC_PORT) : 4173,
  publicUrl: (process.env.APP_PUBLIC_URL ?? "").replace(/\/+$/, ""),
  databaseUrl: process.env.DATABASE_URL ?? "",
  grading: process.env.CUPFOLD_GRADING === "1",
  s3: {
    endpoint: (process.env.S3_ENDPOINT ?? "").replace(/\/+$/, ""),
    region: process.env.S3_REGION ?? "us-east-1",
    bucket: process.env.S3_BUCKET ?? "",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  },
  confirmWindowMs: num(process.env.CUPFOLD_CONFIRM_WINDOW_MS, 600000),
  matchLimitMs: num(process.env.CUPFOLD_MATCH_LIMIT_MS, 1800000),
  swissRoundMs: num(process.env.CUPFOLD_SWISS_ROUND_MS, 3000000),
  checkinDefaultMs: num(process.env.CUPFOLD_CHECKIN_DEFAULT_MS, 3600000),
  reportRate: num(process.env.CUPFOLD_REPORT_RATE, 20),
  loginRate: num(process.env.CUPFOLD_LOGIN_RATE, 10),
  rosterMaxBytes: num(process.env.CUPFOLD_ROSTER_MAX_BYTES, 65536),
  logoMaxBytes: num(process.env.CUPFOLD_LOGO_MAX_BYTES, 524288),
  toastMs: num(process.env.CUPFOLD_TOAST_MS, 4000),
};
