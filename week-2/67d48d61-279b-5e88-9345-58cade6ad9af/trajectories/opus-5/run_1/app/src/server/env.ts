function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}

function optionalDate(name: string): string | null {
  const value = process.env[name];
  if (value === undefined || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} must be written YYYY-MM-DD`);
  }
  return value;
}

function cycleSeconds(): number | null {
  const value = process.env.PROMPTSIDE_CYCLE_SECONDS;
  if (value === undefined || value === '') return null;
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 604_800) return null;
  return seconds;
}

export interface Config {
  port: number;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  intake: { url: string; adminEmail: string; adminPassword: string };
  timeZone: string;
  firstMonday: string | null;
  openingNight: string | null;
  cycleSeconds: number | null;
}

export const config: Config = {
  port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  intake: {
    url: required('POCKETBASE_URL').replace(/\/+$/, ''),
    adminEmail: required('POCKETBASE_ADMIN_EMAIL'),
    adminPassword: required('POCKETBASE_ADMIN_PASSWORD'),
  },
  timeZone: process.env.THEATRE_TZ ?? 'Europe/London',
  firstMonday: optionalDate('PROMPTSIDE_FIRST_MONDAY'),
  openingNight: optionalDate('PROMPTSIDE_OPENING_NIGHT'),
  cycleSeconds: cycleSeconds(),
};
