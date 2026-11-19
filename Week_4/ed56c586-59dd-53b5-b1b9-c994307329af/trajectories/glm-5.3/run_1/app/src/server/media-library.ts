/**
 * The media library. Owns the published manifest, keeps the objects stored in
 * the bucket, reports availability and re-probes while storage is down.
 */
import { coverImage, frameImage } from "../shared/artwork.js";
import { MEDIA_KEYS, type MediaReport } from "../shared/media.js";
import {
  bucketExists,
  createBucket,
  deleteObject,
  headObject,
  putObject,
  type S3Config,
} from "./s3.js";

const CONTENT_TYPE = "image/png";

export class MediaLibrary {
  private readonly config: S3Config;
  private readonly probeSeconds: number;
  private readonly cache = new Map<string, Buffer>();
  private reachable = false;
  private probeTimer: NodeJS.Timeout | null = null;
  private syncing: Promise<void> | null = null;

  constructor(config: S3Config, probeSeconds: number) {
    this.config = config;
    this.probeSeconds = Math.max(1, Math.floor(probeSeconds));
  }

  async start(): Promise<void> {
    await this.sync();
    if (!this.reachable) this.scheduleProbe();
  }

  private scheduleProbe(): void {
    if (this.probeTimer) return;
    this.probeTimer = setInterval(() => {
      void this.sync().then(() => {
        if (!this.reachable) return;
        if (this.probeTimer) {
          clearInterval(this.probeTimer);
          this.probeTimer = null;
        }
      });
    }, this.probeSeconds * 1000);
    this.probeTimer.unref?.();
  }

  private objectFor(key: string): Buffer | null {
    const match = /^work\/([a-z-]+)\/(cover|frame-([1-6]))$/.exec(key);
    if (!match) return null;
    const [, slug, kind, frame] = match;
    if (kind === "cover") {
      let image = this.cache.get(key);
      if (!image) {
        image = coverImage(slug);
        this.cache.set(key, image);
      }
      return image;
    }
    let image = this.cache.get(key);
    if (!image) {
      image = frameImage(slug, Number(frame));
      this.cache.set(key, image);
    }
    return image;
  }

  /** Creates the bucket if missing and stores every published object that is missing. */
  private async sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = (async () => {
      if (!(await bucketExists(this.config))) {
        const created = await createBucket(this.config);
        if (!created) {
          this.reachable = false;
          return;
        }
      }
      this.reachable = true;
      for (const key of MEDIA_KEYS) {
        if (await headObject(this.config, key)) continue;
        const object = this.objectFor(key);
        if (!object) continue;
        const stored = await putObject(this.config, key, {
          body: object,
          contentType: CONTENT_TYPE,
        });
        if (!stored) {
          this.reachable = false;
          this.scheduleProbe();
          return;
        }
      }
    })();
    try {
      await this.syncing;
    } finally {
      this.syncing = null;
    }
  }

  async isReachable(): Promise<boolean> {
    if (this.reachable) return true;
    await this.sync();
    return this.reachable;
  }

  async report(): Promise<MediaReport> {
    const reachable = await this.isReachable();
    if (!reachable) {
      return {
        status: "unavailable",
        objects: MEDIA_KEYS.map((key) => ({ key, available: false })),
      };
    }
    const objects = [];
    for (const key of MEDIA_KEYS) {
      objects.push({ key, available: await headObject(this.config, key) });
    }
    return { status: "available", objects };
  }

  async get(key: string): Promise<{ body: Buffer; contentType: string } | "unavailable" | "missing"> {
    const reachable = await this.isReachable();
    if (!reachable) return "unavailable";
    const present = await headObject(this.config, key);
    if (!present) return "missing";
    return { body: this.objectFor(key) ?? Buffer.alloc(0), contentType: CONTENT_TYPE };
  }

  /** Removes a published object, used by the grading route. */
  async remove(key: string): Promise<boolean> {
    const reachable = await this.isReachable();
    if (!reachable) return false;
    const present = await headObject(this.config, key);
    if (!present) return false;
    return deleteObject(this.config, key);
  }

  /** Stores every published object that is missing again. */
  async reset(): Promise<void> {
    await this.sync();
    for (const key of MEDIA_KEYS) {
      const present = await headObject(this.config, key);
      if (present) continue;
      const object = this.objectFor(key);
      if (object) await putObject(this.config, key, { body: object, contentType: CONTENT_TYPE });
    }
  }
}
