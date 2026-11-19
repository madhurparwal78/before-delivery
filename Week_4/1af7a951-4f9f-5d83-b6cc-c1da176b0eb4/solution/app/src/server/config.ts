// The one place the server reads its environment. Nothing here is ever sent to the browser.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`${name} is not set`);
  return value;
}

function mailbox(from: string): { address: string; domain: string } {
  const address = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim();
  const domain = address.split("@")[1];
  if (!domain) throw new Error("MAIL_FROM has no mail domain");
  return { address, domain };
}

const mailFrom = required("MAIL_FROM");
const sender = mailbox(mailFrom);

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT ?? "4173"),
  databaseUrl: required("DATABASE_URL"),
  killbill: {
    url: required("KILLBILL_URL").replace(/\/+$/, ""),
    username: required("KILLBILL_USERNAME"),
    password: required("KILLBILL_PASSWORD"),
    apiKey: required("KILLBILL_API_KEY"),
    apiSecret: required("KILLBILL_API_SECRET"),
  },
  storage: {
    endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  mail: {
    host: required("SMTP_HOST"),
    port: Number(required("SMTP_PORT")),
    from: mailFrom,
    fromAddress: sender.address,
    domain: sender.domain,
    inspectorUrl: required("MAILPIT_URL"),
  },
} as const;
