/** Every service address, credential and limit comes from the environment, once, at start. */

function text(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function whole(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: whole('APP_PUBLIC_PORT', whole('PORT', 4173)),
  databaseUrl: text('DATABASE_URL'),
  appPublicUrl: text('APP_PUBLIC_URL', 'http://127.0.0.1:4173'),
  gradingKey: text('GRADING_KEY'),
  storage: {
    endpoint: text('S3_ENDPOINT'),
    region: text('S3_REGION', 'us-east-1'),
    bucket: text('S3_BUCKET'),
    forcePathStyle: text('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  mail: {
    host: text('SMTP_HOST'),
    port: whole('SMTP_PORT', 1025),
    from: text('MAIL_FROM', 'Jarful <hello@jarful.test>'),
  },
  limits: {
    maxDocBytes: whole('JARFUL_MAX_DOC_BYTES', 16384),
    maxDepth: whole('JARFUL_MAX_DEPTH', 20),
    scanLimit: whole('JARFUL_SCAN_LIMIT', 10000),
    pageSize: whole('JARFUL_PAGE_SIZE', 20),
    importMaxLines: whole('JARFUL_IMPORT_MAX_LINES', 5000),
    schemaSample: whole('JARFUL_SCHEMA_SAMPLE', 1000),
    previewDocs: whole('JARFUL_PREVIEW_DOCS', 5),
    maxStages: whole('JARFUL_MAX_STAGES', 20),
  },
  bodyLimits: {
    json: 1_000_000,
    grading: 10_000_000,
    upload: 5_000_000,
  },
};

export type Limits = typeof config.limits;
