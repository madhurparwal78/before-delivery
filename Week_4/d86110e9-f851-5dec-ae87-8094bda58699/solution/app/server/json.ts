export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Deepest nesting of arrays and objects, counted without recursion so hostile bodies cannot exhaust the stack. */
export function depthOf(value: Json): number {
  let deepest = 0;
  const pending: Array<[Json, number]> = [[value, 1]];
  while (pending.length > 0) {
    const [node, depth] = pending.pop() as [Json, number];
    if (typeof node !== 'object' || node === null) continue;
    deepest = Math.max(deepest, depth);
    for (const child of Array.isArray(node) ? node : Object.values(node)) pending.push([child, depth + 1]);
  }
  return deepest;
}

/** Text as a person sees it: an emoji or a combined accent counts as one character. */
export function visibleLength(text: string): number {
  let count = 0;
  for (const _ of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)) count += 1;
  return count;
}
