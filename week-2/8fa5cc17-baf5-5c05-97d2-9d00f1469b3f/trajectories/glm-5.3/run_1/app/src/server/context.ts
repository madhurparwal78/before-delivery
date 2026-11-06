// Server context: configuration, database, object store, live sync event bus.

import type { Pool } from "pg";
import { S3 } from "./s3.js";
import { homeDate, isZoneName } from "../shared/hometime.js";

export interface Config {
  port: number;
  databaseUrl: string;
  lockoutWindowSeconds: number;
  sessionIdleSeconds: number;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
}

export function readConfig(): Config {
  const port = process.env.APP_PUBLIC_PORT !== undefined && /^\d+$/.test(process.env.APP_PUBLIC_PORT) ? Number(process.env.APP_PUBLIC_PORT) : 4173;
  const lockoutWindow = Number(process.env.QUIRE_LOCKOUT_WINDOW_SECONDS ?? "900");
  const sessionIdle = Number(process.env.QUIRE_SESSION_IDLE_SECONDS ?? "1209600");
  return {
    port,
    databaseUrl: process.env.DATABASE_URL ?? "",
    lockoutWindowSeconds: Number.isFinite(lockoutWindow) && lockoutWindow > 0 ? lockoutWindow : 900,
    sessionIdleSeconds: Number.isFinite(sessionIdle) && sessionIdle > 0 ? sessionIdle : 1209600,
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? "",
      region: process.env.S3_REGION ?? "",
      bucket: process.env.S3_BUCKET ?? "",
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    },
  };
}

export interface LiveEvent {
  event: string;
  data: Record<string, unknown>;
  hasId: boolean;
}

type EventListener = (ev: LiveEvent) => void;

export class LiveBus {
  private listeners = new Set<EventListener>();
  private eventId = 0;

  subscribe(fn: EventListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(event: string, data: Record<string, unknown>, hasId = true): void {
    for (const fn of this.listeners) fn({ event, data, hasId });
  }
}

export class Ctx {
  readonly pool: Pool;
  readonly s3: S3;
  readonly config: Config;
  readonly bus: LiveBus;
  homeTimeZone = "Europe/London";
  theme: "paper" | "lamplight" = "paper";
  dbReady = false;

  constructor(pool: Pool, s3: S3, config: Config) {
    this.pool = pool;
    this.s3 = s3;
    this.config = config;
    this.bus = new LiveBus();
  }

  async reloadSettings(): Promise<void> {
    const res = await this.pool.query<{ home_time_zone: string; theme: string }>("SELECT home_time_zone, theme FROM settings WHERE id = 1");
    if (res.rows.length > 0) {
      const zone = res.rows[0].home_time_zone;
      if (isZoneName(zone)) this.homeTimeZone = zone;
      this.theme = res.rows[0].theme === "lamplight" ? "lamplight" : "paper";
    }
  }

  today(): string {
    return homeDate(new Date(), this.homeTimeZone);
  }
}
