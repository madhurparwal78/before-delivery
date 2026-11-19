import { createHash } from 'node:crypto';
import type { Files } from '../../shared/api';

/**
 * The one place that decides a version's canonical bytes and its sha256:
 *   html <B>\n<html bytes>\ncss <B>\n<css bytes>\njs <B>\n<js bytes>\nlibraries <ids>\n
 * Each <B> is the byte length of the pane that follows, and pane bytes are exactly as submitted.
 */
export const canonicalBytes = (files: Files, libraries: readonly string[]): Buffer => {
  const pane = (name: keyof Files): Buffer => {
    const bytes = Buffer.from(files[name], 'utf8');
    return Buffer.concat([Buffer.from(`${name} ${bytes.byteLength}\n`, 'utf8'), bytes, Buffer.from('\n', 'utf8')]);
  };
  return Buffer.concat([
    pane('html'),
    pane('css'),
    pane('js'),
    Buffer.from(`libraries ${libraries.join(',')}\n`, 'utf8'),
  ]);
};

export const canonicalSha256 = (files: Files, libraries: readonly string[]): string =>
  createHash('sha256').update(canonicalBytes(files, libraries)).digest('hex');

export const snapshotKey = (penId: string, number: number): string =>
  `pens/${penId}/versions/${number}.json`;

export const snapshotPrefix = (penId: string): string => `pens/${penId}/`;

export interface SnapshotBody {
  pen_id: string;
  number: number;
  sha256: string;
  files: Files;
  libraries: string[];
}

export const snapshotBytes = (snapshot: SnapshotBody): Buffer =>
  Buffer.from(JSON.stringify(snapshot), 'utf8');

export const parseSnapshot = (bytes: Buffer): SnapshotBody => JSON.parse(bytes.toString('utf8')) as SnapshotBody;
