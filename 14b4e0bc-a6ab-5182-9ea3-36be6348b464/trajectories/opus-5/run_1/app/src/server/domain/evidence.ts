import { createHash } from 'node:crypto';
import { codePointLength } from '../../shared/domain.ts';
import { errors } from '../http/errors.ts';
import type { MultipartFile } from '../http/body.ts';

export const MAX_EVIDENCE_BYTES = 5_000_000;
const MAX_FILENAME_CODE_POINTS = 200;
const MAX_NOTE_CODE_POINTS = 500;

export interface AcceptedEvidence {
  filename: string;
  contentType: string;
  bytes: Buffer;
  sha256: string;
  note: string;
}

/** The evidence acceptance rules, applied in the published order. */
export function acceptEvidence(file: MultipartFile | undefined, rawNote: string): AcceptedEvidence {
  const evidenceMessage = ((): string | null => {
    if (file === undefined || file.bytes.length === 0) return 'Attach a PDF or text sign-off.';
    if (file.bytes.length > MAX_EVIDENCE_BYTES) {
      return 'Evidence must be 5,000,000 bytes or smaller.';
    }
    if (codePointLength(file.filename) > MAX_FILENAME_CODE_POINTS) {
      return 'Evidence filename must be 200 characters or fewer.';
    }
    if (file.filename.includes('/') || file.filename.includes('\\')) {
      return 'Evidence filename cannot contain / or \\.';
    }
    if (/[\u0000-\u001f\u007f]/.test(file.filename)) {
      return 'Evidence filename cannot contain control characters.';
    }
    const lower = file.filename.toLowerCase();
    if (!lower.endsWith('.pdf') && !lower.endsWith('.txt')) {
      return 'Evidence must be a .pdf or .txt file.';
    }
    return null;
  })();
  if (evidenceMessage !== null) throw errors.validation({ evidence: evidenceMessage });
  if (codePointLength(rawNote) > MAX_NOTE_CODE_POINTS) {
    throw errors.validation({ note: 'Note must be 500 characters or fewer.' });
  }
  const accepted = file as MultipartFile;
  const contentType = accepted.filename.toLowerCase().endsWith('.pdf')
    ? 'application/pdf'
    : 'text/plain; charset=utf-8';
  return {
    filename: accepted.filename,
    contentType,
    bytes: accepted.bytes,
    sha256: createHash('sha256').update(accepted.bytes).digest('hex'),
    note: rawNote,
  };
}

export function storageKeyFor(assetId: string, evidenceId: string): string {
  return `evidence/${assetId}/${evidenceId}`;
}

const ATTR_CHAR = /^[A-Za-z0-9!#$&+\-.^_`|~]$/;

export function contentDisposition(filename: string): string {
  const fallback = [...filename]
    .map((character) => (character.codePointAt(0)! > 127 || character === '"' || character === '\\' ? '_' : character))
    .join('');
  const encoded = [...Buffer.from(filename, 'utf8')]
    .map((byte) => {
      const character = String.fromCharCode(byte);
      return ATTR_CHAR.test(character)
        ? character
        : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    })
    .join('');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export interface ByteRange {
  start: number;
  end: number;
}

export type RangeOutcome =
  | { kind: 'full' }
  | { kind: 'ranges'; ranges: ByteRange[] }
  | { kind: 'unsatisfiable' };

/** Weak comparison, ignoring a W/ prefix on either side. */
export function matchesIfNoneMatch(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const trimmed = header.trim();
  if (trimmed === '*') return true;
  return trimmed
    .split(',')
    .map((entry) => entry.trim().replace(/^W\//, ''))
    .some((entry) => entry === etag);
}

function parseSpecs(header: string): { start: number | null; end: number | null }[] | null {
  const match = /^([A-Za-z]+)=(.*)$/.exec(header.trim());
  if (!match || match[1].toLowerCase() !== 'bytes') return null;
  const parts = match[2].split(',').map((part) => part.trim());
  if (parts.length < 1 || parts.length > 10) return null;
  const specs: { start: number | null; end: number | null }[] = [];
  for (const part of parts) {
    const suffix = /^-(\d+)$/.exec(part);
    if (suffix) {
      specs.push({ start: null, end: Number(suffix[1]) });
      continue;
    }
    const open = /^(\d+)-$/.exec(part);
    if (open) {
      specs.push({ start: Number(open[1]), end: null });
      continue;
    }
    const closed = /^(\d+)-(\d+)$/.exec(part);
    if (closed) {
      const start = Number(closed[1]);
      const end = Number(closed[2]);
      if (start > end) return null;
      specs.push({ start, end });
      continue;
    }
    return null;
  }
  return specs;
}

/** Resolves, sorts and merges the requested ranges exactly as published. */
export function evaluateRange(
  rangeHeader: string | undefined,
  ifRangeHeader: string | undefined,
  etag: string,
  size: number,
): RangeOutcome {
  if (rangeHeader === undefined) return { kind: 'full' };
  const specs = parseSpecs(rangeHeader);
  if (specs === null) return { kind: 'full' };
  if (ifRangeHeader !== undefined && ifRangeHeader.trim() !== etag) return { kind: 'full' };

  const resolved: ByteRange[] = [];
  for (const spec of specs) {
    if (spec.start === null) {
      const length = spec.end as number;
      if (length === 0) continue;
      resolved.push({ start: Math.max(0, size - length), end: size - 1 });
      continue;
    }
    if (spec.start >= size) continue;
    resolved.push({ start: spec.start, end: spec.end === null ? size - 1 : Math.min(spec.end, size - 1) });
  }
  if (resolved.length === 0) return { kind: 'unsatisfiable' };

  resolved.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: ByteRange[] = [resolved[0]];
  for (const range of resolved.slice(1)) {
    const last = merged[merged.length - 1];
    if (range.start <= last.end + 1) last.end = Math.max(last.end, range.end);
    else merged.push(range);
  }
  return { kind: 'ranges', ranges: merged };
}

export function rangeAuditValue(ranges: readonly ByteRange[] | null): string | null {
  if (ranges === null) return null;
  return ranges.map((range) => `${range.start}-${range.end}`).join(',');
}
