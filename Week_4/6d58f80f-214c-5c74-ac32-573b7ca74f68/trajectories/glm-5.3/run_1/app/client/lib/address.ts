export interface AddressState {
  screen: 'drive' | 'recent' | 'shared' | 'bin' | 'handovers' | 'settings' | 'sign-in';
  folder: string | null;
  view: 'list' | 'grid';
  sort: string;
  q: string;
}

const SORT_KEYS = ['name-asc', 'name-desc', 'modified-desc', 'modified-asc', 'size-desc', 'size-asc'];

export function parseAddress(path: string): AddressState {
  const [rawPath, rawQuery] = path.split('?');
  const params = new URLSearchParams(rawQuery ?? '');
  const segment = rawPath?.replace(/^\/+/, '') ?? '';
  const known = ['drive', 'recent', 'shared', 'bin', 'handovers', 'settings', 'sign-in'] as const;
  const match = known.find(k => segment === k);
  const view = params.get('view') === 'grid' ? 'grid' : 'list';
  const sort = params.get('sort');
  return {
    screen: match ?? 'drive',
    folder: params.get('folder'),
    view,
    sort: sort && SORT_KEYS.includes(sort) ? sort : 'name-asc',
    q: params.get('q') ?? '',
  };
}

export function buildAddress(state: AddressState): string {
  const params = new URLSearchParams();
  if (state.folder) params.set('folder', state.folder);
  if (state.view === 'grid') params.set('view', 'grid');
  if (state.sort && state.sort !== 'name-asc') params.set('sort', state.sort);
  if (state.q) params.set('q', state.q);
  const qs = params.toString();
  const path = state.screen === 'drive' ? '/drive' : `/${state.screen}`;
  return qs ? `${path}?${qs}` : path;
}

export const SORT_OPTIONS = [
  { key: 'name-asc', label: 'Name A–Z' },
  { key: 'name-desc', label: 'Name Z–A' },
  { key: 'modified-desc', label: 'Newest first' },
  { key: 'modified-asc', label: 'Oldest first' },
  { key: 'size-desc', label: 'Largest first' },
  { key: 'size-asc', label: 'Smallest first' },
];
