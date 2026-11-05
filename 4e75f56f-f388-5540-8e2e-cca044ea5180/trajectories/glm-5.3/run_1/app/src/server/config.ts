export interface Config {
  port: number;
  killbillUrl: string;
  killbillUsername: string;
  killbillPassword: string;
  killbillApiKey: string;
  killbillApiSecret: string;
  databaseUrl: string;
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3ForcePathStyle: boolean;
  s3AccessKeyId: string;
  s3SecretAccessKey: string;
  smtpHost: string;
  smtpPort: number;
  mailFrom: string;
  pocketbaseUrl: string;
  pocketbaseAdminEmail: string;
  pocketbaseAdminPassword: string;
  holdSeconds: number;
  offerSeconds: number;
  benchDaysNow: string | null;
  appOrigin: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function loadConfig(): Config {
  const port = intEnv("APP_PUBLIC_PORT", 4173);
  const publicUrl = process.env.APP_PUBLIC_URL ?? `http://127.0.0.1:${port}`;
  return {
    port,
    killbillUrl: required("KILLBILL_URL").replace(/\/$/, ""),
    killbillUsername: required("KILLBILL_USERNAME"),
    killbillPassword: required("KILLBILL_PASSWORD"),
    killbillApiKey: required("KILLBILL_API_KEY"),
    killbillApiSecret: required("KILLBILL_API_SECRET"),
    databaseUrl: required("DATABASE_URL"),
    s3Endpoint: required("S3_ENDPOINT").replace(/\/$/, ""),
    s3Region: process.env.S3_REGION ?? "us-east-1",
    s3Bucket: required("S3_BUCKET"),
    s3ForcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") !== "false",
    s3AccessKeyId: required("S3_ACCESS_KEY_ID"),
    s3SecretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    smtpHost: required("SMTP_HOST"),
    smtpPort: intEnv("SMTP_PORT", 1025),
    mailFrom: required("MAIL_FROM"),
    pocketbaseUrl: required("POCKETBASE_URL").replace(/\/$/, ""),
    pocketbaseAdminEmail: required("POCKETBASE_ADMIN_EMAIL"),
    pocketbaseAdminPassword: required("POCKETBASE_ADMIN_PASSWORD"),
    holdSeconds: intEnv("HOLD_SECONDS", 480),
    offerSeconds: intEnv("OFFER_SECONDS", 86400),
    benchDaysNow: process.env.BENCH_DAYS_NOW ?? null,
    appOrigin: publicUrl.replace(/\/$/, ""),
  };
}

export const COURSE = {
  title: "Layered Composite Masterclass",
  dates: "Friday 16 and Saturday 17 April 2027",
  day1Date: "2027-04-16",
  day2Date: "2027-04-17",
  venue: "The Opaline Lab, 1460 West Kinzie Street, Chicago, Illinois",
  instructor: "Dr. Celeste Marrow-Ibarra",
  provider: "Opaline Institute",
  providerId: "OI-PACE-219874",
  credits: 16,
  format: "Lecture and participation (hands-on)",
  subjectCode: "250 Operative (restorative) dentistry",
} as const;

export const PRICES = {
  bench: { price: 345000, deposit: 90000, balance: 255000 },
  atelier: { price: 590000, deposit: 150000, balance: 440000 },
} as const;

export const ATELIER_CAP = 10;
export const SEATS_TOTAL = 24;
export const DEPOSITS_CLOSED_AFTER = "2027-03-19";
export const REFUND_PENALTY_UNTIL = "2027-01-15";
export const REMINDER_21_FROM = "2027-02-26";
export const REMINDER_7_FROM = "2027-03-12";
export const JSON_BODY_LIMIT = 65536;
export const MULTIPART_BODY_LIMIT = 10100000;
export const FILE_LIMIT = 10000000;

export const STAFF = [
  { role: "director", name: "Mara Okonkwo-Lindqvist", email: "director@opaline-institute.test", password: "bench-days-director-2027" },
  { role: "registrar", name: "Theo Vasquez-Hale", email: "registrar@opaline-institute.test", password: "bench-days-registrar-2027" },
  { role: "frontdesk", name: "Priya Anand-Sorensen", email: "frontdesk@opaline-institute.test", password: "bench-days-frontdesk-2027" },
] as const;
