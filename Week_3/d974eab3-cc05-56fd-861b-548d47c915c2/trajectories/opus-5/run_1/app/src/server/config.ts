export interface Config {
  databaseUrl: string;
  gotenbergUrl: string;
  /** Without a grading key the grading route is absent. */
  gradingKey: string | null;
  port: number;
}

const DEFAULT_PORT = 4173;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set.`);
  }
  return value;
}

export function readConfig(): Config {
  const port = process.env['APP_PUBLIC_PORT'];
  const gradingKey = process.env['GRADING_KEY'];
  return {
    databaseUrl: required('DATABASE_URL'),
    gotenbergUrl: required('GOTENBERG_URL').replace(/\/+$/, ''),
    gradingKey: gradingKey === undefined || gradingKey === '' ? null : gradingKey,
    port: port === undefined || port === '' ? DEFAULT_PORT : Number(port),
  };
}
