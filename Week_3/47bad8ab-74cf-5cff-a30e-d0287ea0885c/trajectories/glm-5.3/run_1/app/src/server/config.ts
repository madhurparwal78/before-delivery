export interface Config {
  port: number;
  publicUrl: string;
  databaseUrl: string;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    forcePathStyle: boolean;
    accessKeyId: string;
    secretAccessKey: string;
  };
  presenceGraceMs: number;
  heartbeatMs: number;
  uploadMaxBytes: number;
  maxGrid: number;
  maxPlayers: number;
  liveRate: number;
  toastMs: number;
  replayStepMs: number;
  grading: boolean;
}

function intEnv(name: string, def: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;
  const v = Number(raw);
  return Number.isFinite(v) && Number.isInteger(v) && v > 0 ? v : def;
}

export function loadConfig(): Config {
  const port = intEnv("APP_PUBLIC_PORT", 4173);
  return {
    port,
    publicUrl: process.env.APP_PUBLIC_URL ?? "",
    databaseUrl: process.env.DATABASE_URL ?? "",
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? "",
      region: process.env.S3_REGION ?? "",
      bucket: process.env.S3_BUCKET ?? "",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
    presenceGraceMs: intEnv("OVERLAP_PRESENCE_GRACE_MS", 15000),
    heartbeatMs: intEnv("OVERLAP_HEARTBEAT_MS", 5000),
    uploadMaxBytes: intEnv("OVERLAP_UPLOAD_MAX_BYTES", 65536),
    maxGrid: intEnv("OVERLAP_MAX_GRID", 25),
    maxPlayers: intEnv("OVERLAP_MAX_PLAYERS", 8),
    liveRate: intEnv("OVERLAP_LIVE_RATE", 30),
    toastMs: intEnv("OVERLAP_TOAST_MS", 4000),
    replayStepMs: intEnv("OVERLAP_REPLAY_STEP_MS", 500),
    grading: process.env.OVERLAP_GRADING === "1",
  };
}
