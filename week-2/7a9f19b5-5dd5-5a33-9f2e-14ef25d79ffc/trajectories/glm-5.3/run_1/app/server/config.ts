/** Read every service URL and credential from the environment at start. */
export interface Config {
  database_url: string
  killbill_url: string
  killbill_username: string
  killbill_password: string
  killbill_api_key: string
  killbill_api_secret: string
  smtp_host: string
  smtp_port: number
  mail_from: string
  s3_endpoint: string
  s3_region: string
  s3_bucket: string
  s3_force_path_style: boolean
  s3_access_key_id: string
  s3_secret_access_key: string
  pocketbase_url: string
  pocketbase_admin_email: string
  pocketbase_admin_password: string
  app_public_port: number
  app_public_url: string
  lightfall_today: string | null
}

export function load_config(): Config {
  const env = process.env
  return {
    database_url: required(env, 'DATABASE_URL'),
    killbill_url: required(env, 'KILLBILL_URL'),
    killbill_username: required(env, 'KILLBILL_USERNAME'),
    killbill_password: required(env, 'KILLBILL_PASSWORD'),
    killbill_api_key: required(env, 'KILLBILL_API_KEY'),
    killbill_api_secret: required(env, 'KILLBILL_API_SECRET'),
    smtp_host: required(env, 'SMTP_HOST'),
    smtp_port: number_env(env, 'SMTP_PORT'),
    mail_from: required(env, 'MAIL_FROM'),
    s3_endpoint: required(env, 'S3_ENDPOINT'),
    s3_region: required(env, 'S3_REGION'),
    s3_bucket: required(env, 'S3_BUCKET'),
    s3_force_path_style: env['S3_FORCE_PATH_STYLE'] === 'true',
    s3_access_key_id: required(env, 'S3_ACCESS_KEY_ID'),
    s3_secret_access_key: required(env, 'S3_SECRET_ACCESS_KEY'),
    pocketbase_url: required(env, 'POCKETBASE_URL'),
    pocketbase_admin_email: required(env, 'POCKETBASE_ADMIN_EMAIL'),
    pocketbase_admin_password: required(env, 'POCKETBASE_ADMIN_PASSWORD'),
    app_public_port: env['APP_PUBLIC_PORT'] ? number_env(env, 'APP_PUBLIC_PORT') : 4173,
    app_public_url: required(env, 'APP_PUBLIC_URL'),
    lightfall_today: env['LIGHTFALL_TODAY'] ?? null,
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`)
  }
  return value
}

function number_env(env: NodeJS.ProcessEnv, name: string): number {
  const n = Number(env[name])
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number`)
  return n
}
