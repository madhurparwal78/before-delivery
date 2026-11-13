function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(`missing environment variable ${name}`);
  return value;
}

function seconds(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive whole number of seconds`);
  return parsed;
}

function secondsList(name: string, fallback: readonly number[]): number[] {
  const value = process.env[name];
  if (value === undefined || value === "") return [...fallback];
  return value
    .split(",")
    .map((part) => {
      const parsed = Number(part.trim());
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be whole numbers of seconds`);
      return parsed;
    })
    .sort((a, b) => b - a);
}

export const config = {
  port: seconds("APP_PUBLIC_PORT", 4173),
  databaseUrl: required("DATABASE_URL"),
  vault: {
    endpoint: required("S3_ENDPOINT"),
    region: required("S3_REGION"),
    bucket: required("S3_BUCKET"),
    forcePathStyle: required("S3_FORCE_PATH_STYLE") === "true",
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
  },
  paymentProviderUrl: required("WIREMOCK_URL").replace(/\/+$/, ""),
  offerWindowSeconds: seconds("OFFER_WINDOW_SECONDS", 2592000),
  leaverWindowSeconds: seconds("LEAVER_WINDOW_SECONDS", 7776000),
  offerWarningSeconds: seconds("OFFER_WARNING_SECONDS", 86400),
  leaverWarningsSeconds: secondsList("LEAVER_WARNINGS_SECONDS", [2592000, 604800, 86400]),
} as const;
