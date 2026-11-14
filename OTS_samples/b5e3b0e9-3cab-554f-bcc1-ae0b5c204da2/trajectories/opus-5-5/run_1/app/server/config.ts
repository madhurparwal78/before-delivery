function text(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function whole(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be a whole number`);
  return value;
}

export const timers = {
  pushSeconds: whole('PUSH_SECONDS', 30),
  lineupSeconds: whole('LINEUP_SECONDS', 20),
  takeoffRollSeconds: whole('TAKEOFF_ROLL_SECONDS', 30),
  landingRollSeconds: whole('LANDING_ROLL_SECONDS', 40),
  crossSeconds: whole('CROSS_SECONDS', 30),
  handoffOfferSeconds: whole('HANDOFF_OFFER_SECONDS', 60),
  arrivalProtectSeconds: whole('ARRIVAL_PROTECT_SECONDS', 120),
  goAroundSeconds: whole('GO_AROUND_SECONDS', 300),
  readbackCorrectSeconds: whole('READBACK_CORRECT_SECONDS', 15),
  readbackErrorEvery: whole('READBACK_ERROR_EVERY', 5),
  simSeedOffset: whole('SIM_SEED_OFFSET', 0),
  slotToleranceSeconds: whole('SLOT_TOLERANCE_SECONDS', 300),
  windChangeDelaySeconds: whole('WIND_CHANGE_DELAY_SECONDS', 120),
  seatGraceSeconds: whole('SEAT_GRACE_SECONDS', 120),
  inviteTtlHours: whole('INVITE_TTL_HOURS', 168),
  verifyTtlHours: whole('VERIFY_TTL_HOURS', 24),
  commandsPerMinute: whole('COMMANDS_PER_MINUTE', 120),
  layoutMaxBytes: whole('LAYOUT_MAX_BYTES', 200000),
};

export type Timers = typeof timers;

const port = whole('APP_PUBLIC_PORT', 4173);

export const config = {
  databaseUrl: text('DATABASE_URL'),
  s3: {
    endpoint: text('S3_ENDPOINT'),
    region: text('S3_REGION', 'us-east-1'),
    bucket: text('S3_BUCKET'),
    forcePathStyle: text('S3_FORCE_PATH_STYLE', 'true') !== 'false',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  smtp: {
    host: text('SMTP_HOST'),
    port: whole('SMTP_PORT', 1025),
    from: text('MAIL_FROM'),
  },
  port,
  publicUrl: text('APP_PUBLIC_URL', `http://127.0.0.1:${port}`).replace(/\/+$/, ''),
  gradingKey: text('GRADING_KEY'),
  simClock: text('SIM_CLOCK', 'wall') === 'stepped' ? ('stepped' as const) : ('wall' as const),
  appToday: text('APP_TODAY'),
  timeZone: text('APP_TIME_ZONE', 'UTC') || 'UTC',
};

export function today(): string {
  if (config.appToday) return config.appToday;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts;
}
