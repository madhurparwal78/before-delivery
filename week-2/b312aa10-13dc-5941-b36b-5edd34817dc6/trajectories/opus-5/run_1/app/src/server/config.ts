function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function seconds(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: seconds('APP_PUBLIC_PORT', 4173),
  databaseUrl: required('DATABASE_URL'),
  killbill: {
    url: required('KILLBILL_URL').replace(/\/$/, ''),
    username: required('KILLBILL_USERNAME'),
    password: required('KILLBILL_PASSWORD'),
    apiKey: required('KILLBILL_API_KEY'),
    apiSecret: required('KILLBILL_API_SECRET'),
  },
  mail: {
    host: required('SMTP_HOST'),
    port: Number.parseInt(required('SMTP_PORT'), 10),
    from: required('MAIL_FROM'),
  },
  storage: {
    endpoint: required('S3_ENDPOINT').replace(/\/$/, ''),
    region: required('S3_REGION'),
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env['S3_FORCE_PATH_STYLE'] ?? 'true') !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  holdTtlSeconds: seconds('LINEBOARD_HOLD_TTL_SECONDS', 600),
  noShowGraceSeconds: seconds('LINEBOARD_NO_SHOW_GRACE_SECONDS', 1800),
  sweepSeconds: seconds('LINEBOARD_SWEEP_SECONDS', 300),
  signinWindowSeconds: seconds('LINEBOARD_SIGNIN_WINDOW_SECONDS', 900),
} as const;

/** Literals that must never leak through an error body, error header or service status. */
export function secretLiterals(): string[] {
  const values = [
    config.killbill.url,
    config.storage.endpoint,
    config.storage.bucket,
    config.databaseUrl,
    config.mail.host,
    config.killbill.username,
    config.killbill.password,
    config.killbill.apiKey,
    config.killbill.apiSecret,
    config.storage.accessKeyId,
    config.storage.secretAccessKey,
  ];
  const hosts: string[] = [];
  for (const value of values) {
    const match = /^[a-z]+:\/\/([^/]+)/i.exec(value);
    if (match?.[1]) hosts.push(match[1]);
  }
  return [...values, ...hosts].filter((value) => value.length >= 12);
}
