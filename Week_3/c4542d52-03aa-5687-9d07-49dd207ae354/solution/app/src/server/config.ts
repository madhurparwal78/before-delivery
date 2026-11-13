const env = process.env;

function integer(name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function integerList(name: string, fallback: string): number[] {
  return (env[name] ?? fallback)
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isFinite(value) && value > 0);
}

export const config = {
  port: integer("APP_PUBLIC_PORT", 4173),
  databaseUrl: env.DATABASE_URL ?? "",
  vault: {
    endpoint: (env.S3_ENDPOINT ?? "").replace(/\/+$/, ""),
    region: env.S3_REGION ?? "",
    bucket: env.S3_BUCKET ?? "",
    forcePathStyle: (env.S3_FORCE_PATH_STYLE ?? "true") === "true",
    accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
  },
  providerUrl: (env.WIREMOCK_URL ?? "").replace(/\/+$/, ""),
  offerWindowSeconds: integer("OFFER_WINDOW_SECONDS", 2592000),
  leaverWindowSeconds: integer("LEAVER_WINDOW_SECONDS", 7776000),
  offerWarningSeconds: integer("OFFER_WARNING_SECONDS", 86400),
  leaverWarningsSeconds: integerList("LEAVER_WARNINGS_SECONDS", "2592000,604800,86400"),
};
