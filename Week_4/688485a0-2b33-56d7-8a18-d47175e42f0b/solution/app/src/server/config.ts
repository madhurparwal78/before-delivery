/** The one place the process environment is read. Nothing here is sent to the browser. */

function text(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function whole(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const publicUrl = text("APP_PUBLIC_URL").replace(/\/+$/, "");
const mailFrom = text("MAIL_FROM");

export const config = {
  port: whole("APP_PUBLIC_PORT", whole("PORT", 4173)),
  publicUrl,
  secureCookies: publicUrl.startsWith("https:"),
  databaseUrl: text("DATABASE_URL"),
  gradingKey: text("GRADING_KEY"),
  storage: {
    endpoint: text("S3_ENDPOINT").replace(/\/+$/, ""),
    region: text("S3_REGION"),
    bucket: text("S3_BUCKET"),
    pathStyle: text("S3_FORCE_PATH_STYLE") !== "false",
    accessKeyId: text("S3_ACCESS_KEY_ID"),
    secretAccessKey: text("S3_SECRET_ACCESS_KEY"),
  },
  mail: {
    host: text("SMTP_HOST"),
    port: whole("SMTP_PORT", 1025),
    from: mailFrom,
    fromAddress: /<([^>]+)>/.exec(mailFrom)?.[1] ?? mailFrom.trim(),
  },
  limits: {
    maxDocBytes: whole("JARFUL_MAX_DOC_BYTES", 16384),
    maxDepth: whole("JARFUL_MAX_DEPTH", 20),
    scanLimit: whole("JARFUL_SCAN_LIMIT", 10000),
    pageSize: whole("JARFUL_PAGE_SIZE", 20),
    importMaxLines: whole("JARFUL_IMPORT_MAX_LINES", 5000),
    schemaSample: whole("JARFUL_SCHEMA_SAMPLE", 1000),
    previewDocs: whole("JARFUL_PREVIEW_DOCS", 5),
    maxStages: whole("JARFUL_MAX_STAGES", 20),
  },
  bodyLimits: { json: 1_000_000, grading: 10_000_000, file: 5_000_000 },
} as const;
