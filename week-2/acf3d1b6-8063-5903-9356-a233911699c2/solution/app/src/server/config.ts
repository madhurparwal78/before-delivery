// Every setting the server reads from its environment, read once at start.

function required(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Missing environment variable ${names.join(' or ')}`);
}

const port = Number(process.env.APP_PUBLIC_PORT || 4173);

export const config = {
  port,
  publicUrl: required('APP_PUBLIC_URL').replace(/\/+$/, ''),
  databaseUrl: required('DATABASE_URL', 'DB_URL'),
  smtp: {
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
  },
  mailFrom: 'studio@example.com',
};
