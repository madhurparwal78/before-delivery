function whole(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return value;
}

function text(name: string): string {
  return process.env[name] ?? '';
}

export const config = {
  port: whole('APP_PUBLIC_PORT', 4173),
  publicUrl: text('APP_PUBLIC_URL'),
  databaseUrl: text('DATABASE_URL'),
  s3: {
    endpoint: text('S3_ENDPOINT'),
    region: text('S3_REGION'),
    bucket: text('S3_BUCKET'),
    forcePathStyle: text('S3_FORCE_PATH_STYLE') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  presenceGraceMs: whole('OVERLAP_PRESENCE_GRACE_MS', 15000),
  heartbeatMs: whole('OVERLAP_HEARTBEAT_MS', 5000),
  uploadMaxBytes: whole('OVERLAP_UPLOAD_MAX_BYTES', 65536),
  maxGrid: whole('OVERLAP_MAX_GRID', 25),
  maxPlayers: whole('OVERLAP_MAX_PLAYERS', 8),
  liveRate: whole('OVERLAP_LIVE_RATE', 30),
  toastMs: whole('OVERLAP_TOAST_MS', 4000),
  replayStepMs: whole('OVERLAP_REPLAY_STEP_MS', 500),
  grading: process.env.OVERLAP_GRADING === '1',
} as const;

export const JSON_BODY_LIMIT = 16384;
export const LIVE_MESSAGE_LIMIT = 4096;
export const RECORD_RETRY_MS = 5000;
