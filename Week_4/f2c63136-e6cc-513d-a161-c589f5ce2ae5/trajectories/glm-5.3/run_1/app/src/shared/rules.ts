import { byteLength } from './bytes.js';

/** Paths: 1 to 255 bytes, no empty/./.. segments, no backslash, no NUL. */
export function isValidPath(path: string): boolean {
  if (path.length === 0 || byteLength(path) > 255) return false;
  if (path.includes('\\') || path.includes('\0')) return false;
  if (path.startsWith('/') || path.endsWith('/')) return false;
  const segs = path.split('/');
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..') return false;
  }
  return true;
}

/** Usernames: 2 to 32 chars of lowercase letters, digits and `-`, letter first. */
export function isValidUsername(username: string): boolean {
  return /^[a-z][a-z0-9-]{1,31}$/.test(username);
}

/** Organisation, repository and team names: 1 to 39 chars, letter or digit first. */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,38}$/.test(slug);
}

/** Branch names: 1 to 64 chars of letters, digits, `.`, `_`, `-`, letter or digit first. */
export function isValidBranchName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name);
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

/** One entry of a combined diff. */
export interface CombinedFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  baseText: string | null;
  headText: string | null;
}

/**
 * The combined diff: every path whose content differs between the base
 * revision and the head revision, in byte order of path.
 */
export function combinedDiff(
  baseFiles: Map<string, string | null>,
  headFiles: Map<string, string | null>,
): CombinedFile[] {
  const paths = new Set<string>([...baseFiles.keys(), ...headFiles.keys()]);
  const out: CombinedFile[] = [];
  const sorted = [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const path of sorted) {
    const base = baseFiles.has(path) ? baseFiles.get(path)! : null;
    const head = headFiles.has(path) ? headFiles.get(path)! : null;
    if (base === head) continue;
    const status: CombinedFile['status'] =
      base === null ? 'added' : head === null ? 'deleted' : 'modified';
    out.push({ path, status, baseText: base, headText: head });
  }
  return out;
}

/**
 * The file-level apply rule, in exactly one place. Applying a change onto a
 * newer revision N succeeds when no path in its combined diff was also
 * changed between its base revision and N, or was changed there to exactly
 * the change's head content. Otherwise the change is conflicting.
 */
export function fileLevelApply(
  diff: CombinedFile[],
  baseFiles: Map<string, string | null>,
  targetFiles: Map<string, string | null>,
): { ok: boolean; conflicts: string[]; result: Map<string, string | null> } {
  const conflicts: string[] = [];
  for (const f of diff) {
    const baseContent = baseFiles.get(f.path) ?? null;
    const targetContent = targetFiles.get(f.path) ?? null;
    if (baseContent === targetContent) continue;
    if (targetContent === f.headText) continue;
    conflicts.push(f.path);
  }
  const result = new Map(targetFiles);
  if (conflicts.length === 0) {
    for (const f of diff) {
      if (f.headText === null) result.delete(f.path);
      else result.set(f.path, f.headText);
    }
  }
  return { ok: conflicts.length === 0, conflicts: conflicts.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)), result };
}
