function text(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is not set`)
  return value
}

function whole(name: string, fallback: number): number {
  const value = process.env[name]
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : fallback
}

export const config = {
  port: whole('APP_PUBLIC_PORT', 4173),
  publicUrl: process.env.APP_PUBLIC_URL?.replace(/\/+$/, '') || null,
  databaseUrl: text('DATABASE_URL'),
  s3: {
    endpoint: text('S3_ENDPOINT').replace(/\/+$/, ''),
    region: text('S3_REGION'),
    bucket: text('S3_BUCKET'),
    pathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  grading: process.env.OVERLAP_GRADING === '1',
  presenceGraceMs: whole('OVERLAP_PRESENCE_GRACE_MS', 15000),
  heartbeatMs: whole('OVERLAP_HEARTBEAT_MS', 5000),
  uploadMaxBytes: whole('OVERLAP_UPLOAD_MAX_BYTES', 65536),
  maxGrid: whole('OVERLAP_MAX_GRID', 25),
  maxPlayers: whole('OVERLAP_MAX_PLAYERS', 8),
  liveRate: whole('OVERLAP_LIVE_RATE', 30),
  toastMs: whole('OVERLAP_TOAST_MS', 4000),
  replayStepMs: whole('OVERLAP_REPLAY_STEP_MS', 500),
}
