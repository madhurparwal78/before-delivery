// The only module that reads the environment. Every host, port and credential comes from here.
const env = process.env;

function seconds(name, fallback) {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a whole number of seconds`);
  return n;
}

export const config = Object.freeze({
  databaseUrl: env.DATABASE_URL || '',
  port: Number.parseInt(env.APP_PUBLIC_PORT || '4173', 10),
  host: '0.0.0.0',
  publicUrl: (env.APP_PUBLIC_URL || '').replace(/\/$/, ''),
  idempotencyRetentionSeconds: seconds('CORVO_IDEMPOTENCY_RETENTION_SECONDS', 86400),
});
