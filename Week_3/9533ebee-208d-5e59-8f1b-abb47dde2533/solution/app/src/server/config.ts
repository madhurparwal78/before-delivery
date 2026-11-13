// The one place the server reads its environment. Nothing here is ever sent to the browser.
// A missing or invalid variable stops the server with a message naming it.

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function wholeNumber(name: string, fallback?: number): number {
  const value = process.env[name];
  if ((value === undefined || value === "") && fallback !== undefined) return fallback;
  const parsed = Number(required(name));
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive whole number`);
  return parsed;
}

function zone(name: string, fallback: string): string {
  const value = optional(name, fallback);
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
  } catch {
    throw new Error(`${name} must be an IANA time zone`);
  }
  return value;
}

function load() {
  return {
    port: wholeNumber("APP_PUBLIC_PORT", 4173),
    databaseUrl: required("DATABASE_URL"),
    s3: {
      endpoint: required("S3_ENDPOINT").replace(/\/+$/, ""),
      region: required("S3_REGION"),
      bucket: required("S3_BUCKET"),
      forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    },
    smtp: { host: required("SMTP_HOST"), port: wholeNumber("SMTP_PORT") },
    mailFrom: required("MAIL_FROM"),
    oracle: {
      baseUrl: required("WIREMOCK_URL").replace(/\/+$/, ""),
      pathPrefix: optional("ORACLE_PATH_PREFIX", "").replace(/\/+$/, ""),
      pollSeconds: wholeNumber("ORACLE_POLL_SECONDS", 2),
    },
    svix: { url: required("SVIX_URL").replace(/\/+$/, ""), apiKey: required("SVIX_API_KEY") },
    gotenbergUrl: required("GOTENBERG_URL").replace(/\/+$/, ""),
    deskTimeZone: zone("DESK_TIME_ZONE", "America/St_Johns"),
    graceSeconds: wholeNumber("GRACE_SECONDS", 300),
    stalenessSeconds: wholeNumber("STALENESS_SECONDS", 3600),
    quoteTtlSeconds: wholeNumber("QUOTE_TTL_SECONDS", 30),
  } as const;
}

function loadOrExit(): ReturnType<typeof load> {
  try {
    return load();
  } catch (error) {
    console.error(`Quillmoor Reserve cannot start: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

export const config = loadOrExit();
