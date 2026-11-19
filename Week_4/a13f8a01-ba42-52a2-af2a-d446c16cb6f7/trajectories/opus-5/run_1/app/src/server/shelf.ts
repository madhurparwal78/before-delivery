import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShelfEntry } from '../shared/api';
import { assetPath } from './assets';

interface ShelfDefinition {
  name: string;
  version: string;
  file: string;
  global: string;
  license: string;
}

const DEFINITIONS: readonly ShelfDefinition[] = [
  { name: 'dayjs', version: '1.11.13', file: 'dayjs.min.js', global: 'dayjs', license: 'MIT' },
  { name: 'lodash', version: '4.17.21', file: 'lodash.min.js', global: '_', license: 'MIT' },
  { name: 'matter-js', version: '0.20.0', file: 'matter.min.js', global: 'Matter', license: 'MIT' },
  { name: 'tinycolor2', version: '1.6.0', file: 'tinycolor.js', global: 'tinycolor', license: 'MIT' },
  { name: 'canvas-confetti', version: '1.9.3', file: 'confetti.js', global: 'confetti', license: 'ISC' },
];

export interface ShelfLibrary {
  entry: ShelfEntry;
  file: string;
  body: Buffer;
}

const load = (): ShelfLibrary[] =>
  DEFINITIONS.map((definition) => {
    const id = `${definition.name}@${definition.version}`;
    const body = readFileSync(join(assetPath('shelf'), id, definition.file));
    return {
      file: definition.file,
      body,
      entry: {
        id,
        name: definition.name,
        version: definition.version,
        global: definition.global,
        path: `/shelf/${id}/${definition.file}`,
        license: definition.license,
        bytes: body.byteLength,
        sha256: createHash('sha256').update(body).digest('hex'),
      },
    };
  });

export const shelf: readonly ShelfLibrary[] = load();

const byId = new Map(shelf.map((library) => [library.entry.id, library]));

export const shelfEntries = (): ShelfEntry[] => shelf.map((library) => library.entry);

export const shelfLibrary = (id: string): ShelfLibrary | undefined => byId.get(id);

export const isShelfId = (id: string): boolean => byId.has(id);

/** The storage key mirroring a shelf file. */
export const shelfKey = (library: ShelfLibrary): string => `shelf/${library.entry.id}/${library.file}`;
