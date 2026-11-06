export type Density = 'List' | 'Card' | 'Grid';
export type ColourScheme = 'Light' | 'Dark' | 'System';

export type SavedFilter = {
  name: string;
  search: string;
  folder: string;
  tag: string;
  starred: boolean;
};

export type CanvasPrefs = { zoom: number; panX: number; panY: number };

export type Prefs = {
  density: Density;
  scheme: ColourScheme;
  savedFilters: SavedFilter[];
  canvas: Record<string, CanvasPrefs>;
  folders: string[];
};

export const ALL_DOCUMENTS = 'All documents';
export const ALL_FOLDERS = 'All folders';
export const ALL_TAGS = 'All tags';
export const NO_FOLDER = 'No folder';

const KEY = 'oddment.prefs';

const startingPrefs: Prefs = {
  density: 'List',
  scheme: 'System',
  savedFilters: [{ name: 'Starred', search: '', folder: ALL_FOLDERS, tag: ALL_TAGS, starred: true }],
  canvas: {},
  folders: ['Plans'],
};

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...startingPrefs };
    return { ...startingPrefs, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return { ...startingPrefs };
  }
}

export function savePrefs(prefs: Prefs): void {
  localStorage.setItem(KEY, JSON.stringify(prefs));
}

export function applyScheme(scheme: ColourScheme): void {
  const dark =
    scheme === 'Dark' ||
    (scheme === 'System' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.colourScheme = dark ? 'dark' : 'light';
}
