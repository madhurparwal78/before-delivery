import { randomBytes, createHash } from "node:crypto";

export type Timer = { s: number };
const num = (v: string | undefined, d: number): number => {
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};
const bool = (v: string | undefined, d: boolean): boolean => (v === undefined || v === "" ? d : v !== "false" && v !== "0");

export const config = {
  get port() { return num(process.env.APP_PUBLIC_PORT, 4173); },
  get publicUrl() { return process.env.APP_PUBLIC_URL || ""; },
  get databaseUrl() { return process.env.DATABASE_URL!; },
  get s3() {
    return {
      endpoint: process.env.S3_ENDPOINT || "",
      region: process.env.S3_REGION || "us-east-1",
      bucket: process.env.S3_BUCKET || "semenza",
      forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, true),
      accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
    };
  },
  get smtp() {
    return { host: process.env.SMTP_HOST || "", port: num(process.env.SMTP_PORT, 1025), mailpitUrl: process.env.MAILPIT_URL || "", from: process.env.MAIL_FROM || "Semenza Desk <desk@bottega-semenza.example>" };
  },
  get wiremockUrl() { return process.env.WIREMOCK_URL || ""; },
  get gotenbergUrl() { return process.env.GOTENBERG_URL || ""; },
  get meili() {
    return { url: (process.env.MEILISEARCH_URL || "").replace(/\/$/, ""), key: process.env.MEILISEARCH_API_KEY || "", prefix: process.env.SEARCH_INDEX_PREFIX || "main" };
  },
  get timers() {
    return {
      enquiryWindow: num(process.env.ENQUIRY_RATE_WINDOW_SECONDS, 3600),
      fileWindow: num(process.env.FILE_RATE_WINDOW_SECONDS, 3600),
      stockCache: num(process.env.STOCK_CACHE_SECONDS, 300),
      closureWait: num(process.env.CLOSURE_WAIT_SECONDS, 2592000),
      holdDays: num(process.env.HOLD_DAYS, 7),
      clientPage: num(process.env.CLIENT_PAGE_SECONDS, 1209600),
      reminderAfter: num(process.env.REMINDER_AFTER_SECONDS, 604800),
      session: num(process.env.SESSION_SECONDS, 604800),
    };
  },
};

export const searchIndexName = () => `${config.meili.prefix}_entries`;
export const newToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
