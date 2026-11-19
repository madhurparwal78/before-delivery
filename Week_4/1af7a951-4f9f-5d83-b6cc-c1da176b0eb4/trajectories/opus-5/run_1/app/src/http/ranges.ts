export type ByteRange =
  | { readonly kind: 'full' }
  | { readonly kind: 'slice'; readonly first: number; readonly last: number }
  | { readonly kind: 'unsatisfiable' };

const FULL: ByteRange = { kind: 'full' };
const UNSATISFIABLE: ByteRange = { kind: 'unsatisfiable' };

export function parseByteRange(header: string | null, size: number): ByteRange {
  if (header === null) return FULL;
  const match = /^bytes=(.*)$/.exec(header.trim());
  if (match === null) return FULL;
  const spec = (match[1] ?? '').trim();
  if (spec.includes(',')) return FULL;

  const suffix = /^-(\d+)$/.exec(spec);
  if (suffix !== null) {
    const count = Number(suffix[1]);
    if (count === 0) return UNSATISFIABLE;
    return { kind: 'slice', first: Math.max(0, size - count), last: size - 1 };
  }

  const explicit = /^(\d+)-(\d*)$/.exec(spec);
  if (explicit === null) return FULL;
  const first = Number(explicit[1]);
  const endPart = explicit[2] ?? '';
  if (endPart === '') {
    return first >= size ? UNSATISFIABLE : { kind: 'slice', first, last: size - 1 };
  }
  const requestedLast = Number(endPart);
  if (requestedLast < first) return FULL;
  if (first >= size) return UNSATISFIABLE;
  return { kind: 'slice', first, last: Math.min(requestedLast, size - 1) };
}
