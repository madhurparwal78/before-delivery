/**
 * The media library: it stores the published objects at start and whenever
 * storage becomes reachable again, and it answers availability and bytes.
 */

import { MEDIA_CONTENT_TYPE, MEDIA_MANIFEST, type MediaObject } from '../shared/media.js';
import { projectBySlug, type Project } from '../shared/seed.js';
import { coverArtwork, frameArtwork } from './artwork.js';
import { ObjectStore, StorageUnreachableError, type StoredObject } from './storage.js';

const artworkFor = (object: MediaObject): Buffer => {
  const project: Project | undefined = projectBySlug(object.slug);
  if (project === undefined) throw new Error(`Unknown project: ${object.slug}`);
  return object.kind === 'cover' ? coverArtwork(project) : frameArtwork(project, object.frame);
};

export interface AvailabilityReport {
  readonly reachable: boolean;
  readonly objects: readonly { readonly key: string; readonly available: boolean }[];
}

export class MediaLibrary {
  private reachable = true;
  private probe: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: ObjectStore,
    private readonly probeSeconds: number,
  ) {}

  /** Creates the bucket if missing and stores every published object that is missing. */
  private async storeMissingObjects(): Promise<void> {
    await this.store.createBucketIfMissing();
    for (const object of MEDIA_MANIFEST) {
      if (!(await this.store.objectExists(object.key))) {
        await this.store.putObject(object.key, artworkFor(object), MEDIA_CONTENT_TYPE);
      }
    }
  }

  private startProbe(): void {
    if (this.probe !== null) return;
    this.probe = setInterval(() => {
      void this.tryRecover();
    }, this.probeSeconds * 1000);
    this.probe.unref();
  }

  private stopProbe(): void {
    if (this.probe === null) return;
    clearInterval(this.probe);
    this.probe = null;
  }

  private async tryRecover(): Promise<void> {
    try {
      await this.storeMissingObjects();
      this.reachable = true;
      this.stopProbe();
    } catch (error) {
      if (!(error instanceof StorageUnreachableError)) throw error;
    }
  }

  private markUnreachable(): void {
    this.reachable = false;
    this.startProbe();
  }

  /** Stores the published objects at start, and keeps probing while storage is down. */
  async start(): Promise<void> {
    try {
      await this.storeMissingObjects();
      this.reachable = true;
    } catch (error) {
      if (!(error instanceof StorageUnreachableError)) throw error;
      this.markUnreachable();
    }
  }

  async availability(): Promise<AvailabilityReport> {
    try {
      const flags = await Promise.all(
        MEDIA_MANIFEST.map(async (object) => ({
          key: object.key,
          available: await this.store.objectExists(object.key),
        })),
      );
      this.reachable = true;
      this.stopProbe();
      return { reachable: true, objects: flags };
    } catch (error) {
      if (!(error instanceof StorageUnreachableError)) throw error;
      this.markUnreachable();
      return {
        reachable: false,
        objects: MEDIA_MANIFEST.map((object) => ({ key: object.key, available: false })),
      };
    }
  }

  /** The stored object, null when it is missing, or an unreachable error. */
  async read(key: string): Promise<StoredObject | null> {
    try {
      const object = await this.store.getObject(key);
      this.reachable = true;
      this.stopProbe();
      return object;
    } catch (error) {
      if (!(error instanceof StorageUnreachableError)) throw error;
      this.markUnreachable();
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    await this.store.deleteObject(key);
  }

  async restoreAll(): Promise<void> {
    await this.storeMissingObjects();
  }

  /** Whether storage answers right now. */
  async check(): Promise<boolean> {
    try {
      await this.store.ping();
      this.reachable = true;
      this.stopProbe();
    } catch (error) {
      if (!(error instanceof StorageUnreachableError)) throw error;
      this.markUnreachable();
    }
    return this.reachable;
  }
}
