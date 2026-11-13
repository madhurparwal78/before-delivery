// Configuration read once at start. Never hard-coded, never sent to the browser.
export interface Config {
  port: number;
  databaseUrl: string;
  valkeyUrl: string;
  valkeyPrefix: string;
  gotenbergUrl: string;
  ntfyUrl: string;
  ntfyUsername: string;
  ntfyPassword: string;
  seedRiderPassword: string | null;
  seedHostPassword: string | null;
  testClock: boolean;
}

function readConfig(): Config {
  return {
    port: (() => {
      const publicPort = process.env.APP_PUBLIC_PORT;
      if (publicPort && /^\d+$/.test(publicPort)) {
        const n = Number(publicPort);
        if (n > 0 && n < 65536) return n;
      }
      return 4173;
    })(),
    databaseUrl: process.env.DATABASE_URL ?? "",
    valkeyUrl: process.env.VALKEY_URL ?? "",
    valkeyPrefix: process.env.VALKEY_PREFIX ?? "malhar",
    gotenbergUrl: process.env.GOTENBERG_URL ?? "",
    ntfyUrl: process.env.NTFY_URL ?? "",
    ntfyUsername: process.env.NTFY_USERNAME ?? "",
    ntfyPassword: process.env.NTFY_PASSWORD ?? "",
    seedRiderPassword: process.env.SEED_RIDER_PASSWORD || null,
    seedHostPassword: process.env.SEED_HOST_PASSWORD || null,
    testClock: process.env.APP_TEST_CLOCK === "1",
  };
}

export const config: Config = readConfig();
