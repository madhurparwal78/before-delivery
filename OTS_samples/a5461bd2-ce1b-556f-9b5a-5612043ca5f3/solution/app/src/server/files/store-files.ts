import { FileStoreUnavailable, type FileStore } from "../file-store";
import { sleep } from "../time";
import { galleryImage } from "./gallery-art";
import { islandModel } from "./islands";
import type { Catalog } from "../../shared/types";

const encoder = new TextEncoder();

interface Wanted {
  key: string;
  type: string;
  make: () => Uint8Array;
}

function wanted(catalog: Catalog): Wanted[] {
  const models = catalog.worlds.map((world) => ({ key: `scenes/${world.slug}/world.glb`, type: "model/gltf-binary", make: () => islandModel(world.slug, world.colours) }));
  const images = catalog.projects.flatMap((project) =>
    project.gallery.map((image) => ({ key: `media/${project.slug}/${image.n}.svg`, type: "image/svg+xml", make: () => encoder.encode(galleryImage(project.slug, image.n, project.colours)) })));
  return [...models, ...images];
}

/** Stores every scene model and gallery image the bucket lacks; tries again until the file store answers. */
export async function keepFilesStored(store: FileStore, readCatalog: () => Promise<Catalog>, retryMs: number): Promise<void> {
  for (;;) {
    try {
      for (const file of wanted(await readCatalog())) {
        if (!(await store.exists(file.key))) await store.put(file.key, file.make(), file.type);
      }
      return;
    } catch (error) {
      if (!(error instanceof FileStoreUnavailable)) throw error;
      await sleep(retryMs);
    }
  }
}
