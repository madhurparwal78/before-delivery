export interface Config {
  port: number;
  databaseUrl: string;
  gotenbergUrl: string;
  /** Without a grading key the grading route does not exist. */
  gradingKey: string | undefined;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`${name} must be set in the environment`);
  }
  return value;
}

export function readConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: Number(env["APP_PUBLIC_PORT"] || 4173),
    databaseUrl: required(env, "DATABASE_URL"),
    gotenbergUrl: required(env, "GOTENBERG_URL"),
    gradingKey: env["GRADING_KEY"] || undefined,
  };
}
