/** Every environment variable the server reads, in one place. None of it is ever sent to the browser. */
import { fileURLToPath } from 'node:url'

function text(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback
  if (value === undefined) throw new Error(`${name} is not set`)
  return value
}

function number(name: string, fallback: number): number {
  return Number(text(name, String(fallback)))
}

const port = number('APP_PUBLIC_PORT', 4173)

export const config = {
  port,
  publicUrl: text('APP_PUBLIC_URL', `http://localhost:${port}`).replace(/\/$/, ''),
  publicDir: text('PUBLIC_DIR', fileURLToPath(new URL('./public', import.meta.url))),
  databaseUrl: text('DATABASE_URL'),
  s3: {
    endpoint: text('S3_ENDPOINT').replace(/\/$/, ''),
    region: text('S3_REGION'),
    bucket: text('S3_BUCKET'),
    pathStyle: text('S3_FORCE_PATH_STYLE', 'true') === 'true',
    accessKeyId: text('S3_ACCESS_KEY_ID'),
    secretAccessKey: text('S3_SECRET_ACCESS_KEY'),
  },
  smtp: { host: text('SMTP_HOST'), port: number('SMTP_PORT', 1025) },
  mailFrom: text('MAIL_FROM', 'Hushfoot <hello@hushfoot.example>'),
  gradingRoutes: process.env.GRADING_ROUTES === 'on',
  worldTickMs: number('WORLD_TICK_MS', 100),
  worldDayTicks: number('WORLD_DAY_TICKS', 14400),
  duskStartHour: number('DUSK_START_HOUR', 18),
  duskEndHour: number('DUSK_END_HOUR', 20),
  rainStartHour: number('RAIN_START_HOUR', 6),
  rainEndHour: number('RAIN_END_HOUR', 9),
  photoTickGrace: number('PHOTO_TICK_GRACE', 30),
  photoMaxBytes: number('PHOTO_MAX_BYTES', 2000000),
  liveIntervalMs: number('LIVE_INTERVAL_MS', 1000),
  safariSeatReleaseSeconds: number('SAFARI_SEAT_RELEASE_SECONDS', 30),
  postcardLimit: number('POSTCARD_LIMIT', 10),
  postcardWindowSeconds: number('POSTCARD_WINDOW_SECONDS', 3600),
  confirmCodeTtlSeconds: number('CONFIRM_CODE_TTL_SECONDS', 86400),
}

/** How long a sign-in lasts: the cookie's Max-Age and the server-side session age limit. */
export const SESSION_SECONDS = 30 * 24 * 60 * 60
