import { SORT_KEYS, type SortKey } from '../../shared/types.js';

export type Screen = 'sign-in' | 'drive' | 'recent' | 'shared' | 'bin' | 'handovers' | 'settings';

export interface Address {
  screen: Screen;
  folder: string | null;
  view: 'list' | 'grid';
  sort: SortKey;
  q: string;
}

const SCREENS: Record<string, Screen> = {
  '/sign-in': 'sign-in',
  '/drive': 'drive',
  '/recent': 'recent',
  '/shared': 'shared',
  '/bin': 'bin',
  '/handovers': 'handovers',
  '/settings': 'settings',
};

export const readAddress = (): Address => {
  const url = new URL(window.location.href);
  const screen = SCREENS[url.pathname] ?? 'drive';
  const sort = url.searchParams.get('sort');
  const view = url.searchParams.get('view');
  return {
    screen,
    folder: url.searchParams.get('folder'),
    view: view === 'grid' ? 'grid' : 'list',
    sort: SORT_KEYS.includes(sort as SortKey) ? (sort as SortKey) : 'name-asc',
    q: url.searchParams.get('q') ?? '',
  };
};

/** Defaults are left out of the address. */
export const writeAddress = (address: Address): string => {
  const search = new URLSearchParams();
  if (address.folder !== null && address.folder !== '') search.set('folder', address.folder);
  if (address.view !== 'list') search.set('view', address.view);
  if (address.sort !== 'name-asc') search.set('sort', address.sort);
  if (address.q !== '') search.set('q', address.q);
  const query = search.toString();
  return `/${address.screen}${query === '' ? '' : `?${query}`}`;
};

export const navigate = (address: Address, mode: 'push' | 'replace' = 'push'): void => {
  const target = writeAddress(address);
  if (mode === 'replace') window.history.replaceState({}, '', target);
  else window.history.pushState({}, '', target);
  window.dispatchEvent(new PopStateEvent('popstate'));
};
