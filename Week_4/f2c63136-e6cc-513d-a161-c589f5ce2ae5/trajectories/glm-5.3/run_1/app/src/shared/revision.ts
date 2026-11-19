import { createHash } from 'node:crypto';
import { byteOrder } from './bytes.js';

export interface RevisionFileInput { path: string; content: string }
export interface RevisionIdentity { parents: string[]; message: string; files: RevisionFileInput[] }

/** Canonical bytes hashed into a revision id, exactly as specified. */
export function canonicalRevisionText(ident: RevisionIdentity): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  for (const p of ident.parents) parts.push(`parent ${p}\n`);
  parts.push(`message ${enc.encode(ident.message).length}\n${ident.message}\n`);
  for (const path of byteOrder(ident.files.map((f) => f.path))) {
    const content = ident.files.find((f) => f.path === path)!.content;
    parts.push(`file ${enc.encode(content).length} ${path}\n${content}\n`);
  }
  return parts.join('');
}

export function revisionId(ident: RevisionIdentity): string {
  return createHash('sha256').update(canonicalRevisionText(ident), 'utf8').digest('hex').slice(0, 12);
}
