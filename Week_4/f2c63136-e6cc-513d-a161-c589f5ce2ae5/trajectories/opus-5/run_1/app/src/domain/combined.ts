import { createHash } from 'node:crypto';
import { byteOrder, type Snapshot } from './revisions.js';

export type FileStatus = 'added' | 'modified' | 'deleted';

export interface CombinedFile {
  path: string;
  status: FileStatus;
  baseKey: string | null;
  headKey: string | null;
}

/** Every path whose content differs between the base revision and the head revision, in byte order. */
export function combinedFiles(base: Snapshot, head: Snapshot): CombinedFile[] {
  const paths = new Set<string>([...base.keys(), ...head.keys()]);
  const files: CombinedFile[] = [];
  for (const path of [...paths].sort(byteOrder)) {
    const baseEntry = base.get(path) ?? null;
    const headEntry = head.get(path) ?? null;
    if (baseEntry && headEntry && baseEntry.contentKey === headEntry.contentKey) continue;
    if (!baseEntry && !headEntry) continue;
    const status: FileStatus = !baseEntry ? 'added' : !headEntry ? 'deleted' : 'modified';
    files.push({
      path,
      status,
      baseKey: baseEntry ? baseEntry.contentKey : null,
      headKey: headEntry ? headEntry.contentKey : null,
    });
  }
  return files;
}

/** Identity of a combined diff: the same paths, statuses, base texts and head texts. */
export function diffFingerprint(files: CombinedFile[]): string {
  const canonical = files
    .map((file) => `${file.path}\u0000${file.status}\u0000${file.baseKey ?? ''}\u0000${file.headKey ?? ''}`)
    .join('\n');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
