function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function required(name: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === '') throw new Error(`${name} is not set`);
  return raw;
}

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
  undoWindowSeconds: number;
  chatMaxPerMinute: number;
  partyMaxMembers: number;
  questInviteSeconds: number;
  gradingToken: string | null;
  port: number;
}

export const config: Config = {
  databaseUrl: required('DATABASE_URL'),
  s3: {
    endpoint: required('S3_ENDPOINT'),
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: required('S3_BUCKET'),
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  undoWindowSeconds: intFromEnv('UNDO_WINDOW_SECONDS', 30),
  chatMaxPerMinute: intFromEnv('CHAT_MAX_PER_MINUTE', 5),
  partyMaxMembers: intFromEnv('PARTY_MAX_MEMBERS', 4),
  questInviteSeconds: intFromEnv('QUEST_INVITE_SECONDS', 600),
  gradingToken: process.env.GRADING_TOKEN && process.env.GRADING_TOKEN !== '' ? process.env.GRADING_TOKEN : null,
  port: intFromEnv('APP_PUBLIC_PORT', 4173),
};

export const JSON_BODY_LIMIT = 64_000;
export const IMPORT_FILE_LIMIT = 100_000;
export const BANNER_FILE_LIMIT = 2_000_000;
export const SESSION_COOKIE = 'deed_session';
