export interface Env {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  pocketbaseUrl: string;
  pocketbaseAdminEmail: string;
  pocketbaseAdminPassword: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  killbill: {
    url: string;
    username: string;
    password: string;
    apiKey: string;
    apiSecret: string;
  };
  smtp: { host: string; port: number };
  mailFrom: { name: string; address: string };
  trialLengthSeconds: number;
  dunningDaySeconds: number;
  tokenWarningLeadSeconds: number;
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function loadEnv(): Env {
  const port = num(process.env.APP_PUBLIC_PORT, 4173);
  const mailFromRaw = process.env.MAIL_FROM ?? "Orrery Studio <studio@orrery-labs.test>";
  const lt = mailFromRaw.lastIndexOf("<");
  const gt = mailFromRaw.lastIndexOf(">");
  const mailFrom =
    lt >= 0 && gt > lt
      ? { name: mailFromRaw.slice(0, lt).trim(), address: mailFromRaw.slice(lt + 1, gt).trim() }
      : { name: "Orrery Studio", address: mailFromRaw.trim() };
  return {
    port,
    publicUrl: (process.env.APP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ""),
    databaseUrl: process.env.DATABASE_URL ?? "",
    pocketbaseUrl: process.env.POCKETBASE_URL ?? "",
    pocketbaseAdminEmail: process.env.POCKETBASE_ADMIN_EMAIL ?? "",
    pocketbaseAdminPassword: process.env.POCKETBASE_ADMIN_PASSWORD ?? "",
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? "",
      region: process.env.S3_REGION ?? "us-east-1",
      bucket: process.env.S3_BUCKET ?? "",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
    killbill: {
      url: (process.env.KILLBILL_URL ?? "").replace(/\/$/, ""),
      username: process.env.KILLBILL_USERNAME ?? "",
      password: process.env.KILLBILL_PASSWORD ?? "",
      apiKey: process.env.KILLBILL_API_KEY ?? "",
      apiSecret: process.env.KILLBILL_API_SECRET ?? "",
    },
    smtp: { host: process.env.SMTP_HOST ?? "", port: num(process.env.SMTP_PORT, 1025) },
    mailFrom,
    trialLengthSeconds: num(process.env.TRIAL_LENGTH_SECONDS, 1_209_600),
    dunningDaySeconds: num(process.env.DUNNING_DAY_SECONDS, 86_400),
    tokenWarningLeadSeconds: num(process.env.TOKEN_WARNING_LEAD_SECONDS, 86_400),
  };
}
