/** The exhibit PDFs shipped with the app, read once from the build output. */
import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface SeededExhibit {
  accession: string;
  sha256: string;
  bytes: Buffer;
}

interface ManifestEntry {
  accession: string;
  sha256: string;
  bytes: number;
}

let cache: SeededExhibit[] | null = null;

export function seededExhibits(): SeededExhibit[] {
  if (cache !== null) return cache;
  const directory = path.join(__dirname, 'exhibits');
  const manifest = JSON.parse(
    readFileSync(path.join(directory, 'manifest.json'), 'utf8'),
  ) as ManifestEntry[];
  cache = manifest.map((entry) => ({
    accession: entry.accession,
    sha256: entry.sha256,
    bytes: readFileSync(path.join(directory, `${entry.accession}.pdf`)),
  }));
  return cache;
}

export function seededExhibitFor(accession: string): SeededExhibit {
  const found = seededExhibits().find((exhibit) => exhibit.accession === accession);
  if (found === undefined) throw new Error('seeded exhibit missing from the build');
  return found;
}
