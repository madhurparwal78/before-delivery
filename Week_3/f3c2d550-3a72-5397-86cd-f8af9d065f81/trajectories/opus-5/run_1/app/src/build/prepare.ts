import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeUpright, readPhotoHeader, sniffPhotoType } from '../server/domain/photo.js';
import { sizeLine } from '../server/domain/sizes.js';
import { computedSwatchArea, measureSwatch, srgbConverter } from '../server/domain/swatch.js';
import { DEMO_BLURBS, DEMO_SLUGS, SEED_REFERENCES } from '../shared/seed.js';
import { OBJECT_DRAWINGS, renderObjectPng } from './objects.js';

/**
 * Draws the stand-in photographs and works out the landing page's bundled demo stops, using
 * the same swatch rule the server uses for every other reference.
 */

const root = process.cwd();
const objectsDirectory = join(root, 'dist', 'public', 'assets', 'objects');
const generatedDirectory = join(root, 'src', 'generated');

mkdirSync(objectsDirectory, { recursive: true });
mkdirSync(generatedDirectory, { recursive: true });

const swatches = new Map<string, string>();

for (const drawing of OBJECT_DRAWINGS) {
  const png = renderObjectPng(drawing);
  writeFileSync(join(objectsDirectory, `${drawing.slug}.png`), png);
  const type = sniffPhotoType(png);
  if (!type) throw new Error(`drawn photograph ${drawing.slug} is not a JPEG or PNG`);
  const header = readPhotoHeader(png, type);
  if (!header) throw new Error(`drawn photograph ${drawing.slug} has no readable header`);
  const image = decodeUpright(png, type, header.orientation);
  const swatch = measureSwatch(
    image,
    computedSwatchArea(image.width, image.height),
    srgbConverter(null),
  );
  swatches.set(drawing.slug, swatch);
}

const demoStops = DEMO_SLUGS.map((slug) => {
  const reference = SEED_REFERENCES.find((entry) => entry.slug === slug);
  const swatch = swatches.get(slug);
  if (!reference || !swatch) throw new Error(`no drawn photograph for demo stop ${slug}`);
  return {
    slug,
    title: reference.title,
    maker: reference.maker,
    year: reference.year,
    size_line: sizeLine(reference.size, 'mm'),
    swatch,
    photo_url: `/assets/objects/${slug}.png`,
    blurb: DEMO_BLURBS[slug] ?? '',
  };
});

const source = `// Written by scripts/build.mjs. The landing page plays these three stops with no
// help from the database or the object store.
export interface DemoStop {
  slug: string;
  title: string;
  maker: string;
  year: number;
  size_line: string;
  swatch: string;
  photo_url: string;
  blurb: string;
}

export const DEMO_STOPS: readonly DemoStop[] = ${JSON.stringify(demoStops, null, 2)};
`;

writeFileSync(join(generatedDirectory, 'demo.ts'), source);

process.stdout.write(
  `drew ${OBJECT_DRAWINGS.length} stand-in photographs and bundled ${demoStops.length} demo stops\n`,
);
