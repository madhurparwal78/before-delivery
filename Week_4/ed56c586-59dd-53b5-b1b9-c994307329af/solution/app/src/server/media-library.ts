import { renderMediaObject } from "./artwork/index.js";
import { MEDIA_KEYS, MEDIA_OBJECTS, type MediaReport } from "../shared/media-manifest.js";
import { ObjectStore, StorageUnavailableError, type StoredObject } from "./object-store.js";

/** The media library: the bucket holding the 42 published objects. The app creates the bucket and stores every missing
 * object at start and whenever storage becomes reachable again, and tells visitors only through `/media/<key>`. */

const CONCURRENT_REQUESTS = 8;

async function inBatches<Item, Result>(items: readonly Item[], work: (item: Item) => Promise<Result>): Promise<Result[]> {
  const results: Result[] = [];
  for (let at = 0; at < items.length; at += CONCURRENT_REQUESTS) {
    results.push(...(await Promise.all(items.slice(at, at + CONCURRENT_REQUESTS).map(work))));
  }
  return results;
}

export class MediaLibrary {
  /** Whether every published object has been stored since storage last became reachable. */
  private stored = false;
  private storing: Promise<void> | undefined;

  constructor(private readonly store: ObjectStore, private readonly probeSeconds: number) {}

  start(): void {
    void this.storeWhenReachable();
    setInterval(() => void this.probe(), this.probeSeconds * 1000).unref();
  }

  /** The periodic probe: notices storage going away, and stores the objects once it is back. */
  private async probe(): Promise<void> {
    if (this.stored) {
      try {
        await this.store.headBucket();
      } catch (error) {
        if (!(error instanceof StorageUnavailableError)) throw error;
        this.stored = false;
      }
      return;
    }
    await this.storeWhenReachable();
  }

  private storeWhenReachable(): Promise<void> {
    this.storing ??= this.storeMissingObjects()
      .then(() => {
        this.stored = true;
      })
      .catch((error: unknown) => {
        if (!(error instanceof StorageUnavailableError)) throw error;
        this.stored = false;
      })
      .finally(() => {
        this.storing = undefined;
      });
    return this.storing;
  }

  /** Creates the bucket if it is missing, then stores every published object that is missing. */
  private async storeMissingObjects(): Promise<void> {
    if ((await this.store.headBucket()) === "missing") await this.store.createBucket();
    await inBatches(MEDIA_OBJECTS, async (object) => {
      if ((await this.store.headObject(object.key)) !== "missing") return;
      const artwork = renderMediaObject(object);
      await this.store.putObject(object.key, artwork.bytes, artwork.contentType);
    });
  }

  async storageAnswers(): Promise<boolean> {
    try {
      await this.store.headBucket();
      return true;
    } catch (error) {
      if (error instanceof StorageUnavailableError) return false;
      throw error;
    }
  }

  /** Availability of every published object at this moment, in manifest order. */
  async report(): Promise<MediaReport> {
    if (!this.stored) await this.storeWhenReachable();
    try {
      const answers = await inBatches(MEDIA_KEYS, async (key) => ({ key, available: (await this.store.headObject(key)) === "present" }));
      return { status: "available", objects: answers };
    } catch (error) {
      if (!(error instanceof StorageUnavailableError)) throw error;
      this.stored = false;
      return { status: "unavailable", objects: MEDIA_KEYS.map((key) => ({ key, available: false })) };
    }
  }

  /** The stored object, undefined when it is missing; throws StorageUnavailableError while storage cannot be reached. */
  async read(key: string): Promise<StoredObject | undefined> {
    try {
      const object = await this.store.getObject(key);
      if (!this.stored) void this.storeWhenReachable();
      return object;
    } catch (error) {
      if (error instanceof StorageUnavailableError) this.stored = false;
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    await this.store.deleteObject(key);
  }

  /** The grading reset: every missing published object is stored again. */
  async restore(): Promise<void> {
    await this.storeMissingObjects();
    this.stored = true;
  }
}
