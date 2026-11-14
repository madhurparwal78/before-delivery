import type { Resolved } from './resolve.ts';

/** The first shown page after `from` on this walk; null at the end. */
export function nextShownPage(resolved: Resolved, from: string): string | null {
  const index = resolved.pages.findIndex((page) => page.key === from);
  return resolved.pages.slice(index + 1).find((page) => page.state === 'lit')?.key ?? null;
}

/** The last shown page before `from` on this walk; null at the start. */
export function previousShownPage(resolved: Resolved, from: string): string | null {
  const index = resolved.pages.findIndex((page) => page.key === from);
  const before = index === -1 ? resolved.pages : resolved.pages.slice(0, index);
  return before.findLast((page) => page.state === 'lit')?.key ?? null;
}
