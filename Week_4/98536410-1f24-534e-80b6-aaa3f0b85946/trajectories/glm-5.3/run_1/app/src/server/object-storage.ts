import type { Config } from "./config.js";
import { bucketName, createBucket, deleteObject, getObject, headBucket, putObject, type ObjectResult } from "./object-store.js";

export type StorageStatus = "up" | "down";

const CHECK_INTERVAL_MS = 5000;

export class ObjectStorage {
  private readonly cfg: Config;
  private status: StorageStatus = "down";
  private checkedAt: Date = new Date(0);
  private timer: NodeJS.Timeout | null = null;

  constructor(cfg: Config) {
    this.cfg = cfg;
  }

  bucket(): string {
    return bucketName(this.cfg);
  }

  async start(): Promise<void> {
    try {
      await createBucket(this.cfg);
      await this.probe();
    } catch {
      this.status = "down";
      this.checkedAt = new Date();
    }
    this.timer = setInterval(() => {
      void this.probe();
    }, CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  private async probe(): Promise<void> {
    try {
      const ok = await headBucket(this.cfg);
      this.status = ok ? "up" : "down";
    } catch {
      this.status = "down";
    }
    this.checkedAt = new Date();
  }

  statusSnapshot(): { storage: StorageStatus; checked_at: string } {
    return { storage: this.status, checked_at: this.checkedAt.toISOString() };
  }

  isUp(): boolean {
    return this.status === "up";
  }

  async put(key: string, contentType: string, body: Buffer): Promise<void> {
    if (this.status !== "up") throw new Error("storage down");
    await putObject(this.cfg, key, contentType, body);
  }

  async delete(key: string): Promise<void> {
    if (this.status !== "up") throw new Error("storage down");
    await deleteObject(this.cfg, key);
  }

  async get(key: string): Promise<ObjectResult> {
    if (this.status !== "up") throw new Error("storage down");
    return getObject(this.cfg, key);
  }
}
