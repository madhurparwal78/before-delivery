import pg from "pg";
import type { AppConfig } from "./config.js";
import type { Db } from "./db.js";
import { S3Client, S3NotFound } from "./s3.js";
import { Redis } from "ioredis";
import { canonicalJson, digestOf } from "../shared/canonical.js";
import type { Solid } from "../shared/records.js";

/** Structural type: a pg pool or client used by queries. */
export interface Tx {
  query: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>;
}

/** The Valkey client type. */
export type RedisClient = Redis;

export class AppCtx {
  readonly db: Db;
  readonly s3: S3Client;
  readonly redis: RedisClient;
  readonly config: AppConfig;
  private storageHealthy = true;
  private dbHealthy = false;

  constructor(db: Db, s3: S3Client, redis: RedisClient, config: AppConfig) {
    this.db = db;
    this.s3 = s3;
    this.redis = redis;
    this.config = config;
  }

  markStorage(up: boolean): void { this.storageHealthy = up; }
  get storageUp(): boolean { return this.storageHealthy; }
  markDb(up: boolean): void { this.dbHealthy = up; }
  get dbUp(): boolean { return this.dbHealthy; }

  prefix(key: string): string { return `${this.config.valkeyKeyPrefix}${key}`; }

  /** Store a solid by digest; one object per distinct digest. */
  async storeSolid(solid: Solid): Promise<string> {
    const json = canonicalJson(solid);
    const digest = digestOf(json);
    await this.putObject(`solids/${digest}.json`, Buffer.from(json, "utf8"), "application/json");
    return digest;
  }

  async storeThumbnail(digest: string, svg: string): Promise<void> {
    await this.putObject(`thumbnails/${digest}.svg`, Buffer.from(svg, "utf8"), "image/svg+xml");
  }

  async storeSource(source: string): Promise<string> {
    const key = `sources/${digestOf(source)}.tine`;
    await this.putObject(key, Buffer.from(source, "utf8"), "text/plain");
    return key;
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.putObject(key, body, contentType);
    // Storage confirmation: read the metadata back.
    const present = await this.s3.headObject(key);
    if (!present) throw new Error(`Storage confirmation failed for ${key}`);
  }

  async getSolid(digest: string): Promise<Solid> {
    const bytes = await this.s3.getObject(`solids/${digest}.json`);
    return JSON.parse(bytes.toString("utf8")) as Solid;
  }

  async getSolidBytes(digest: string): Promise<Buffer> {
    return this.s3.getObject(`solids/${digest}.json`);
  }

  async getSource(key: string): Promise<string> {
    const bytes = await this.s3.getObject(key);
    return bytes.toString("utf8");
  }

  async getThumbnail(digest: string): Promise<Buffer> {
    return this.s3.getObject(`thumbnails/${digest}.svg`);
  }

  /** Does storage answer at all? Used by health and the degraded mode. */
  async checkStorage(): Promise<boolean> {
    try {
      const key = "health/ping";
      await this.s3.putObject(key, Buffer.from("ok"), "text/plain");
      this.storageHealthy = true;
      return true;
    } catch {
      this.storageHealthy = false;
      return false;
    }
  }

  /** Write an outbox event in the caller's transaction. */
  async outbox(tx: Tx, type: string, partSlug: string, roomId: string | null, data: unknown): Promise<string> {
    const r = await tx.query(
      `insert into outbox (type, part_slug, room_id, data) values ($1,$2,$3,$4) returning seq`,
      [type, partSlug, roomId, JSON.stringify(data)]
    );
    return String(r.rows[0]!.seq);
  }
}

export { S3NotFound };
