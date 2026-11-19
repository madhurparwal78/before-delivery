import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, type Env } from "./server.js";

const here = dirname(fileURLToPath(import.meta.url));
const env: Env = {
  S3_ENDPOINT: process.env.S3_ENDPOINT ?? "",
  S3_REGION: process.env.S3_REGION ?? "",
  S3_BUCKET: process.env.S3_BUCKET ?? "",
  S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE ?? "",
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? "",
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? "",
  SMTP_HOST: process.env.SMTP_HOST ?? "",
  SMTP_PORT: process.env.SMTP_PORT ?? "",
  MAIL_FROM: process.env.MAIL_FROM ?? "",
  GRADING_KEY: process.env.GRADING_KEY,
  MEDIA_PROBE_SECONDS: process.env.MEDIA_PROBE_SECONDS,
  MAIL_TIMEOUT_SECONDS: process.env.MAIL_TIMEOUT_SECONDS,
  APP_PUBLIC_PORT: process.env.APP_PUBLIC_PORT,
};

await startServer(env, join(here, "assets"));
