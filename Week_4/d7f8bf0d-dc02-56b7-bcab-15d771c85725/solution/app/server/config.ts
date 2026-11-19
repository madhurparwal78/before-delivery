// The environment is read here: the service addresses, the port and the idle period. The supervisor and the entry
// point only read which role the process plays.

function required(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') throw new Error(`${name} is not set`)
  return value
}

export const publicPort = Number(process.env.APP_PUBLIC_PORT ?? 4173)
export const idleSeconds = Number(process.env.SESSION_IDLE_SECONDS ?? 1800)

interface InstanceConfig {
  instanceId: string
  databaseUrl: string
  valkeyUrl: string
  gotenbergUrl: string
  internalToken: string
}

export function instanceConfig(): InstanceConfig {
  return {
    instanceId: required('GANDYBOARD_INSTANCE'),
    databaseUrl: required('DATABASE_URL'),
    valkeyUrl: required('VALKEY_URL'),
    gotenbergUrl: required('GOTENBERG_URL'),
    internalToken: required('GANDYBOARD_INTERNAL_TOKEN'),
  }
}
