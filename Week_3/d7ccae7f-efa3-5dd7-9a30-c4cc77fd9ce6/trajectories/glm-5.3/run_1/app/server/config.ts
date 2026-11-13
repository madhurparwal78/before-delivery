import { readFileSync } from 'node:fs';

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    console.error(`Missing required environment variable ${name}`);
    process.exit(1);
  }
  return value;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const databaseUrl = required('DATABASE_URL');
const valkeyUrl = required('VALKEY_URL');
const s3Endpoint = required('S3_ENDPOINT');
const s3Region = process.env.S3_REGION || 'us-east-1';
const s3Bucket = required('S3_BUCKET');
const s3ForcePathStyle = (process.env.S3_FORCE_PATH_STYLE || 'true').toLowerCase() !== 'false';
const s3AccessKeyId = required('S3_ACCESS_KEY_ID');
const s3SecretAccessKey = required('S3_SECRET_ACCESS_KEY');
const appPublicPort = intEnv('APP_PUBLIC_PORT', 4173);
const roomIdleSeconds = intEnv('ROOM_IDLE_SECONDS', 1800);
const imageUrlTtlSeconds = intEnv('IMAGE_URL_TTL_SECONDS', 120);

export const config = {
  databaseUrl,
  valkeyUrl,
  s3Endpoint,
  s3Region,
  s3Bucket,
  s3ForcePathStyle,
  s3AccessKeyId,
  s3SecretAccessKey,
  appPublicPort,
  roomIdleSeconds,
  imageUrlTtlSeconds,
} as const;

export function loadAssetText(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8');
}
