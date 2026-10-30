'use strict';
// The one place the environment is read. Nothing else touches process.env.

const config = Object.freeze({
  databaseUrl: process.env.DATABASE_URL || '',
  publicUrl: process.env.APP_PUBLIC_URL || '',
  listenPort: Number(process.env.APP_PUBLIC_PORT || 4173),
  listenHost: '0.0.0.0',
  lockoutSeconds: Number.parseInt(process.env.SIGN_IN_LOCKOUT_SECONDS || '900', 10),
});

module.exports = config;
