const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set`);
  return value;
};

export const config = {
  port: Number(process.env.APP_PUBLIC_PORT ?? 4173),
  databaseUrl: need("DATABASE_URL"),
  valkeyUrl: need("VALKEY_URL"),
  valkeyPrefix: process.env.VALKEY_PREFIX ?? "malhar",
  gotenbergUrl: need("GOTENBERG_URL").replace(/\/$/, ""),
  ntfyUrl: need("NTFY_URL").replace(/\/$/, ""),
  ntfyUsername: process.env.NTFY_USERNAME ?? "",
  ntfyPassword: process.env.NTFY_PASSWORD ?? "",
  riderSeedPassword: process.env.SEED_RIDER_PASSWORD ?? "",
  hostSeedPassword: process.env.SEED_HOST_PASSWORD ?? "",
  testClock: process.env.APP_TEST_CLOCK === "1",
} as const;
