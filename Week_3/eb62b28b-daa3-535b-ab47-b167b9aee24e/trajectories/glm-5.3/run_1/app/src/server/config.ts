export type Config = {
  port: number;
  publicUrl: string;
  databaseUrl: string;
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
  smtp: {
    host: string;
    port: number;
    from: string;
  };
  timers: {
    sessionSeconds: number;
    messageRateWindowSeconds: number;
    fileRateWindowSeconds: number;
    closureWaitSeconds: number;
    drawPageSeconds: number | null;
  };
};

export function readConfig(): Config {
  const port = Number(process.env["APP_PUBLIC_PORT"] ?? 4173);
  const publicUrl = process.env["APP_PUBLIC_URL"] ?? `http://127.0.0.1:${port}`;
  const databaseUrl = required("DATABASE_URL");
  const s3Endpoint = process.env["S3_ENDPOINT"] ?? "http://127.0.0.1:9000";
  const region = process.env["S3_REGION"] ?? "us-east-1";
  const bucket = process.env["S3_BUCKET"] ?? "ocotillo";
  const forcePathStyle = (process.env["S3_FORCE_PATH_STYLE"] ?? "false").toLowerCase() === "true";
  const s3AccessKey = required("S3_ACCESS_KEY_ID");
  const s3Secret = required("S3_SECRET_ACCESS_KEY");
  const killbillUrl = process.env["KILLBILL_URL"] ?? "http://127.0.0.1:8080";
  const kbUser = process.env["KILLBILL_USERNAME"] ?? "admin";
  const kbPassword = process.env["KILLBILL_PASSWORD"] ?? "password";
  const kbApiKey = required("KILLBILL_API_KEY");
  const kbApiSecret = required("KILLBILL_API_SECRET");
  const smtpHost = process.env["SMTP_HOST"] ?? "127.0.0.1";
  const smtpPort = Number(process.env["SMTP_PORT"] ?? 25);
  const mailFrom = process.env["MAIL_FROM"] ?? "Ocotillo Member Desk <desk@ocotillo.example>";
  const sessionSeconds = Number(process.env["SESSION_SECONDS"] ?? 43200);
  const messageRateWindowSeconds = Number(process.env["MESSAGE_RATE_WINDOW_SECONDS"] ?? 3600);
  const fileRateWindowSeconds = Number(process.env["FILE_RATE_WINDOW_SECONDS"] ?? 3600);
  const closureWaitSeconds = Number(process.env["CLOSURE_WAIT_SECONDS"] ?? 2592000);
  const drawPageSecondsRaw = process.env["DRAW_PAGE_SECONDS"];
  const drawPageSeconds = drawPageSecondsRaw ? Number(drawPageSecondsRaw) : null;
  return {
    port,
    publicUrl,
    databaseUrl,
    s3: {
      endpoint: s3Endpoint,
      region,
      bucket,
      forcePathStyle,
      accessKeyId: s3AccessKey,
      secretAccessKey: s3Secret,
    },
    killbill: {
      url: killbillUrl.replace(/\/$/, ""),
      username: kbUser,
      password: kbPassword,
      apiKey: kbApiKey,
      apiSecret: kbApiSecret,
    },
    smtp: { host: smtpHost, port: smtpPort, from: mailFrom },
    timers: {
      sessionSeconds,
      messageRateWindowSeconds,
      fileRateWindowSeconds,
      closureWaitSeconds,
      drawPageSeconds,
    },
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
