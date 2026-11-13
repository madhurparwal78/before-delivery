export interface Config {
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  smtp: { host: string; port: number };
  mailFrom: string;
  mailpitUrl: string;
  publicPort: number;
  publicUrl: string;
  timers: {
    sessionSeconds: number;
    holdSeconds: number;
    portalPageSeconds: number;
    appointmentRateWindowSeconds: number;
    bookFileRateWindowSeconds: number;
  };
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function readConfig(): Config {
  const port = intEnv('APP_PUBLIC_PORT', 4173);
  const publicUrl = process.env.APP_PUBLIC_URL && process.env.APP_PUBLIC_URL !== ''
    ? process.env.APP_PUBLIC_URL
    : `http://localhost:${port}`;
  return {
    databaseUrl: process.env.DATABASE_URL ?? '',
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? '',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket: process.env.S3_BUCKET ?? '',
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
    smtp: { host: process.env.SMTP_HOST ?? '', port: intEnv('SMTP_PORT', 1025) },
    mailpitUrl: process.env.MAILPIT_URL ?? '',
    mailFrom: process.env.MAIL_FROM ?? 'Atelier Ourlet <desk@atelier-ourlet.example>',
    publicPort: port,
    publicUrl: publicUrl.replace(/\/$/, ''),
    timers: {
      sessionSeconds: intEnv('SESSION_SECONDS', 43200),
      holdSeconds: intEnv('HOLD_SECONDS', 7200),
      portalPageSeconds: intEnv('PORTAL_PAGE_SECONDS', 1209600),
      appointmentRateWindowSeconds: intEnv('APPOINTMENT_RATE_WINDOW_SECONDS', 3600),
      bookFileRateWindowSeconds: intEnv('BOOK_FILE_RATE_WINDOW_SECONDS', 3600),
    },
  };
}

export const SHOP = {
  legalName: 'Atelier Ourlet SRL',
  address: 'Rue de l\u2019Ourlet 12, 1000 Brussels',
  iban: 'BE68 5390 0754 7034',
} as const;
