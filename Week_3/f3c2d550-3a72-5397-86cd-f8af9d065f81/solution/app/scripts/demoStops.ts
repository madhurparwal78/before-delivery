import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readHeader } from "../server/photo.js";
import { SHRINK_WIDTHS, measure, shrinkJpeg } from "../server/pixels.js";
import { DEMO_REEL, SEED_PHOTOS, SEED_REFERENCES } from "../server/seedData.js";

/**
 * Writes the three bundled Landing demo stops: the same records and photographs as the Demo reel,
 * with swatches computed by the swatch rule from those same files.
 */
const web = fileURLToPath(new URL("../../web/", import.meta.url));
await mkdir(`${web}src/generated`, { recursive: true });
await mkdir(`${web}public/demo`, { recursive: true });

const stops = [];
for (const title of DEMO_REEL) {
  const seed = SEED_REFERENCES.find((candidate) => candidate.title === title);
  if (!seed) throw new Error(`${title} is not a seed reference`);
  const bytes = await readFile(new URL(seed.file, SEED_PHOTOS));
  const header = readHeader(bytes);
  if (!header) throw new Error(`${seed.file} is not a JPEG or PNG`);
  const { computed } = measure({ bytes, header, point: null, crop: false });
  if (header.orientation !== 1) throw new Error(`${seed.file} must be stored upright to be served at smaller widths`);
  await copyFile(new URL(seed.file, SEED_PHOTOS), `${web}public/demo/${seed.file}`);
  const stem = seed.file.replace(/\.jpg$/, "");
  const srcset = [];
  for (const width of SHRINK_WIDTHS) {
    await writeFile(`${web}public/demo/${stem}-${width}.jpg`, shrinkJpeg(bytes, width));
    srcset.push(`/demo/${stem}-${width}.jpg ${width}w`);
  }
  srcset.push(`/demo/${seed.file} ${header.width}w`);
  const [width, height, depth] = seed.size;
  stops.push({
    id: seed.file.replace(/\.jpg$/, ""),
    title: seed.title,
    maker: seed.maker,
    year: seed.year,
    size_tenths_mm: { width, height, depth },
    swatch: computed,
    photo: `/demo/${seed.file}`,
    srcset: srcset.join(", "),
  });
}
await writeFile(`${web}src/generated/demo.json`, `${JSON.stringify(stops, null, 2)}\n`);
