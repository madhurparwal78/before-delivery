// Redirect rules, decided here and nowhere else: one hop, chains collapse on rename, a rename back removes the
// redirect instead of looping, and anything that would lead back to itself is refused with the cycle.

import { fail } from '../errors';
import { isPagePath } from '../../shared/rules';
import { linkTargets, normalizeSource, parseMarkdown } from './markdown';
import type { RedirectJson } from '../../shared/types';

interface RenamePlan {
  redirects: RedirectJson[];
  added: { from: string; to: string } | null;
  removed: { from: string; to: string } | null;
}

/** `start` and the paths its redirects lead through, in order, until the chain ends. */
function chainFrom(redirects: RedirectJson[], start: string): string[] {
  const chain = [start];
  for (;;) {
    const hop = redirects.find((r) => r.from === chain[chain.length - 1])?.to;
    if (hop === undefined || chain.includes(hop)) {
      return chain;
    }
    chain.push(hop);
  }
}

/** Renaming a page from `oldPath` to `newPath` (both with a leading slash) over the version's redirects. */
export function planRename(redirects: RedirectJson[], oldPath: string, newPath: string): RenamePlan {
  const takenBack = redirects.find((r) => r.from === newPath && r.kind === 'auto') ?? null;
  const remaining = redirects.filter((r) => r !== takenBack);
  const chain = chainFrom(remaining, newPath);
  if (chain.includes(oldPath)) {
    throw fail.redirectLoop([...chain.slice(0, chain.indexOf(oldPath) + 1), newPath]);
  }
  const collapsed = remaining.map((r) => (r.to === oldPath ? { ...r, to: newPath } : r));
  const added = collapsed.some((r) => r.from === oldPath) ? null : { from: oldPath, to: newPath };
  const result = added ? [...collapsed, { ...added, kind: 'auto' as const }] : collapsed;
  return {
    redirects: result.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)),
    added,
    removed: takenBack ? { from: takenBack.from, to: takenBack.to } : null,
  };
}

type Resolution = { kind: 'page' } | { kind: 'redirect'; to: string } | { kind: 'missing' };

/** What an address (with its leading slash) leads to: a manual redirect first, then a page, then an automatic redirect. */
export function resolvePath(redirects: RedirectJson[], hasPage: (path: string) => boolean, path: string): Resolution {
  const manual = redirects.find((r) => r.from === path && r.kind === 'manual');
  if (manual) {
    return { kind: 'redirect', to: manual.to };
  }
  if (hasPage(path)) {
    return { kind: 'page' };
  }
  const automatic = redirects.find((r) => r.from === path && r.kind === 'auto');
  return automatic ? { kind: 'redirect', to: automatic.to } : { kind: 'missing' };
}

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** Check a manual redirect before it is saved. Returns the normalised `from` and `to`. */
export function planManualRedirect(redirects: RedirectJson[], livePaths: Set<string>, rawFrom: string, rawTo: string): { from: string; to: string } {
  const from = rawFrom.startsWith('/') ? rawFrom : `/${rawFrom}`;
  if (redirects.some((r) => r.from === from)) {
    throw fail.redirectExists(from);
  }
  if (!isPagePath(from.slice(1))) {
    throw fail.validation({ from: 'Paths use letters, digits, hyphens and underscores, separated by /.' });
  }
  if (SCHEME.test(rawTo) || rawTo.startsWith('//') || rawTo.includes('\\')) {
    throw fail.redirectOffSite();
  }
  const to = rawTo.startsWith('/') ? rawTo : `/${rawTo}`;
  if (!isPagePath(to.slice(1))) {
    throw fail.validation({ to: 'Paths use letters, digits, hyphens and underscores, separated by /.' });
  }
  const chain = chainFrom(redirects, to);
  if (chain.includes(from)) {
    throw fail.redirectLoop([from, ...chain.slice(0, chain.indexOf(from) + 1)]);
  }
  if (!livePaths.has(to.slice(1))) {
    throw fail.redirectTargetMissing(to);
  }
  return { from, to };
}

/** Point every internal link and Card href whose path is exactly `oldPath` at `newPath`, keeping any #anchor. */
export function rewriteLinks(source: string, oldPath: string, newPath: string): { source: string; count: number } {
  const text = normalizeSource(source);
  const hits = linkTargets(parseMarkdown(text)).filter((t) => t.kind === 'internal' && t.path === oldPath);
  let result = text;
  for (const hit of [...hits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, hit.start) + newPath + result.slice(hit.end);
  }
  return { source: hits.length === 0 ? source : result, count: hits.length };
}
