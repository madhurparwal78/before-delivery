/** Redirect collapsing and loop detection, decided here and nowhere else. */

export type RedirectKind = 'auto' | 'manual';

export interface Redirect {
  from: string;
  to: string;
  kind: RedirectKind;
}

export const sortRedirects = (list: readonly Redirect[]): Redirect[] =>
  [...list].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));

/** Follows the one hop out of each path; returns the cycle through `start`, if any. */
export function findCycle(redirects: readonly Redirect[], start: string): string[] | null {
  const next = new Map(redirects.map((redirect) => [redirect.from, redirect.to]));
  const cycle = [start];
  const seen = new Set<string>([start]);
  let current = start;
  for (;;) {
    const target = next.get(current);
    if (target === undefined) return null;
    cycle.push(target);
    if (target === start) return cycle;
    if (seen.has(target)) return null;
    seen.add(target);
    current = target;
  }
}

export interface RenamePlan {
  redirects: Redirect[];
  added: { from: string; to: string };
  removed: { from: string; to: string } | null;
}

export type PlanResult<T> = { ok: true; plan: T } | { ok: false; cycle: string[] };

/** The redirect map a rename from `oldPath` to `newPath` leaves behind (DP-13). */
export function planRename(
  current: readonly Redirect[],
  oldPath: string,
  newPath: string,
): PlanResult<RenamePlan> {
  const autoAtNew = current.find(
    (redirect) => redirect.from === newPath && redirect.kind === 'auto',
  );
  const base = current.filter(
    (redirect) => redirect.from !== oldPath && redirect !== autoAtNew,
  );
  const added = { from: oldPath, to: newPath };
  const cycle = findCycle([...base, { ...added, kind: 'auto' as const }], newPath);
  if (cycle !== null) return { ok: false, cycle };
  const redirects: Redirect[] = [
    ...base.map((redirect) =>
      redirect.to === oldPath ? { ...redirect, to: newPath } : { ...redirect },
    ),
    { ...added, kind: 'auto' },
  ];
  return {
    ok: true,
    plan: {
      redirects,
      added,
      removed: autoAtNew === undefined ? null : { from: autoAtNew.from, to: autoAtNew.to },
    },
  };
}

/** The redirect map after adding a manual redirect (DP-14). */
export function planManualRedirect(
  current: readonly Redirect[],
  from: string,
  to: string,
): PlanResult<Redirect[]> {
  const added: Redirect = { from, to, kind: 'manual' };
  const cycle = findCycle([...current, added], from);
  if (cycle !== null) return { ok: false, cycle };
  return { ok: true, plan: [...current, added] };
}

export type Resolution =
  | { kind: 'page'; path: string }
  | { kind: 'redirect'; to: string }
  | { kind: 'missing' };

/**
 * Public resolution order inside one published snapshot:
 * manual redirect, then page, then automatic redirect, then not found.
 */
export function resolvePublicPath(
  redirects: readonly Redirect[],
  livePaths: ReadonlySet<string>,
  path: string,
): Resolution {
  const manual = redirects.find((redirect) => redirect.kind === 'manual' && redirect.from === path);
  if (manual !== undefined) return { kind: 'redirect', to: manual.to };
  if (livePaths.has(path)) return { kind: 'page', path };
  const auto = redirects.find((redirect) => redirect.kind === 'auto' && redirect.from === path);
  if (auto !== undefined) return { kind: 'redirect', to: auto.to };
  return { kind: 'missing' };
}
