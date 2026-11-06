import { createHash, randomBytes } from 'node:crypto';

export type Config = {
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
  presenceIdleSeconds: number;
};

function readConfig(): Config {
  const port = Number(process.env.APP_PUBLIC_PORT ?? 4173);
  const idleRaw = process.env.PRESENCE_IDLE_SECONDS;
  let idle = 60;
  if (idleRaw !== undefined) {
    const n = Number(idleRaw);
    if (!Number.isInteger(n) || n < 1 || n > 3600) throw new Error('PRESENCE_IDLE_SECONDS must be a whole number from 1 to 3600');
    idle = n;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error('S3_BUCKET is required');
  return {
    port,
    databaseUrl,
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? '',
      region: process.env.S3_REGION ?? 'us-east-1',
      bucket,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
    presenceIdleSeconds: idle,
  };
}

export const config: Config = readConfig();

const SESSION_HOURS = 12;

export function newSessionToken(): string {
  return randomBytes(24).toString('base64url');
}

export function sessionExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + SESSION_HOURS * 3600 * 1000);
}

export function hashPassword(password: string): string {
  return createHash('sha256').update(`quillmere:${password}`).digest('hex');
}

/** Person ids are stable opaque strings; new ids hold at least 16 random URL-safe characters. */
export function newId(len = 17): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const bytes = randomBytes(len);
  for (let i = 0; i < len; i += 1) out += alphabet[bytes[i]! % alphabet.length];
  return out;
}
