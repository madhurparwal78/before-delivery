/** Loads the bytes behind image, SVG and model assets once, and describes them for the evaluator. */
import { parseSvgOutline } from '../../shared/geometry';
import { parseModel } from '../../shared/gltf';
import type { Mesh } from '../../shared/geometry';
import type { AssetInfo } from '../../shared/types';

type AssetState = 'loading' | 'ready' | 'unavailable';

interface Entry {
  state: AssetState;
  meshes: Mesh[] | null;
  image: ImageBitmap | null;
}

export class AssetLoader {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  /** Bumps when any asset changes state, so renderers know to redraw. */
  version = 0;

  constructor(private readonly urlOf: (assetId: string) => string) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(id: string, entry: Entry): void {
    this.entries.set(id, entry);
    this.version += 1;
    this.listeners.forEach((l) => l());
  }

  state(id: string): AssetState | undefined {
    return this.entries.get(id)?.state;
  }

  meshes(id: string): Mesh[] | null {
    return this.entries.get(id)?.meshes ?? null;
  }

  image(id: string): ImageBitmap | null {
    return this.entries.get(id)?.image ?? null;
  }

  /** Starts loading the bytes of an asset the first time it is asked for. */
  request(info: AssetInfo): void {
    if (this.entries.has(info.id)) return;
    this.set(info.id, { state: 'loading', meshes: null, image: null });
    void this.fetchBytes(info.id).then(async (bytes) => {
      if (!bytes) return this.set(info.id, { state: 'unavailable', meshes: null, image: null });
      if (info.kind === 'model') {
        const result = parseModel(bytes, Number.MAX_SAFE_INTEGER);
        return this.set(info.id, { state: 'model' in result ? 'ready' : 'unavailable', meshes: 'model' in result ? result.model.meshes : null, image: null });
      }
      if (info.kind === 'image') {
        const image = await createImageBitmap(new Blob([bytes as BlobPart])).catch(() => null);
        return this.set(info.id, { state: image ? 'ready' : 'unavailable', meshes: null, image });
      }
      return this.set(info.id, { state: 'ready', meshes: null, image: null });
    });
  }

  private async fetchBytes(id: string): Promise<Uint8Array | null> {
    try {
      const response = await fetch(this.urlOf(id), { credentials: 'same-origin' });
      return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    } catch {
      return null;
    }
  }

  /**
   * Fetches an asset by id and describes it the way the server's asset list does, for pages that only have a
   * scene document (the embed, the covers). A failed fetch marks the asset unavailable and returns null.
   */
  async describe(id: string, kind: AssetInfo['kind']): Promise<AssetInfo | null> {
    const bytes = await this.fetchBytes(id);
    if (!bytes) {
      this.set(id, { state: 'unavailable', meshes: null, image: null });
      return null;
    }
    const base: AssetInfo = { id, kind, fileName: id, bytes: bytes.length, sha256: '', status: 'confirmed', width: null, height: null, vertices: null, clips: [], model: null, outline: null };
    if (kind === 'model') {
      const result = parseModel(bytes, Number.MAX_SAFE_INTEGER);
      if (!('model' in result)) {
        this.set(id, { state: 'unavailable', meshes: null, image: null });
        return null;
      }
      this.set(id, { state: 'ready', meshes: result.model.meshes, image: null });
      return { ...base, vertices: result.model.summary.vertices, clips: result.model.summary.clips.map((c) => ({ name: c.name, durationS: c.durationS })), model: result.model.summary };
    }
    if (kind === 'svg') {
      const parsed = parseSvgOutline(new TextDecoder().decode(bytes));
      this.set(id, { state: 'ready', meshes: null, image: null });
      return 'outline' in parsed ? { ...base, outline: parsed.outline } : null;
    }
    const image = await createImageBitmap(new Blob([bytes as BlobPart])).catch(() => null);
    this.set(id, { state: image ? 'ready' : 'unavailable', meshes: null, image });
    return image ? { ...base, width: image.width, height: image.height } : null;
  }
}
