export interface AppConfig {
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
  undoWindowSeconds: number;
  chatMaxPerMinute: number;
  partyMaxMembers: number;
  questInviteSeconds: number;
  gradingToken: string | null;
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function loadConfig(env = process.env): AppConfig {
  return {
    port: int(env.APP_PUBLIC_PORT, 4173),
    databaseUrl: env.DATABASE_URL ?? '',
    s3: {
      endpoint: env.S3_ENDPOINT ?? '',
      region: env.S3_REGION ?? 'us-east-1',
      bucket: env.S3_BUCKET ?? 'deedfall',
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
      accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
    },
    undoWindowSeconds: int(env.UNDO_WINDOW_SECONDS, 30),
    chatMaxPerMinute: int(env.CHAT_MAX_PER_MINUTE, 5),
    partyMaxMembers: int(env.PARTY_MAX_MEMBERS, 4),
    questInviteSeconds: int(env.QUEST_INVITE_SECONDS, 600),
    gradingToken: env.GRADING_TOKEN && env.GRADING_TOKEN.length > 0 ? env.GRADING_TOKEN : null,
  };
}

export const config: AppConfig = loadConfig();

