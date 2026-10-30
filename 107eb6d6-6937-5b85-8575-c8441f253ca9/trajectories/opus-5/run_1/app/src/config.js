const positiveInteger = (raw, fallback) => {
  const parsed = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  databaseUrl: process.env.DATABASE_URL,
  port: positiveInteger(process.env.APP_PUBLIC_PORT, 4173),
  publicUrl: process.env.APP_PUBLIC_URL ?? '',
  signInLockoutSeconds: positiveInteger(process.env.SIGN_IN_LOCKOUT_SECONDS, 900),
  maxFailedSignIns: 5,
  bodyLimitBytes: 100000,
  pageSize: 50,
  apiPageSizeDefault: 50,
  apiPageSizeMax: 100,
  sessionCookie: 'gf_session'
};
