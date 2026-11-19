export type Role = 'lead' | 'manager' | 'care' | 'shopper';

export type Me = {
  user: { id: string; name: string; email: string; role: Role; operator_id: string };
  operator: { id: string; name: string };
  store_ids: string[];
  session_expires_at: string;
};

let currentMe: Me | null = null;

export function setMe(me: Me | null): void {
  currentMe = me;
}

export function me(): Me {
  if (!currentMe) throw new Error('No signed-in person');
  return currentMe;
}

export function maybeMe(): Me | null {
  return currentMe;
}

export function landingRoute(role: Role, storeIds: string[]): string {
  if (role === 'lead') return '/estate';
  if (role === 'care') return '/care';
  if (role === 'shopper') return '/catalogue';
  const lowest = [...storeIds].sort()[0];
  return lowest ? `/shop/${lowest}` : '/';
}

export function routeBelongsToRole(path: string, role: Role, storeIds: string[]): boolean {
  const parts = path.split('?')[0]!.split('/').filter((part) => part !== '');
  if (parts.length === 0) return true;
  switch (role) {
    case 'lead':
      return parts[0] === 'estate';
    case 'care':
      return parts[0] === 'care';
    case 'shopper':
      return ['catalogue', 'products', 'cart', 'orders'].includes(parts[0] as string);
    case 'manager':
      return parts[0] === 'shop' && storeIds.includes(parts[1] ?? '');
  }
}

const TAB_KEY = 'tramela.tab.state';

type TabStore = Record<string, unknown>;

function readTabStore(): TabStore {
  try {
    return JSON.parse(sessionStorage.getItem(TAB_KEY) ?? '{}') as TabStore;
  } catch {
    return {};
  }
}

function writeTabStore(store: TabStore): void {
  try {
    sessionStorage.setItem(TAB_KEY, JSON.stringify(store));
  } catch {
    /* a tab with no session storage simply keeps nothing */
  }
}

/** What a reload in the same tab brings back. */
export function saveTabState<T>(key: string, value: T): void {
  const store = readTabStore();
  store[key] = value;
  writeTabStore(store);
}

export function loadTabState<T>(key: string): T | null {
  const value = readTabStore()[key];
  return value === undefined ? null : (value as T);
}

export function dropTabState(key: string): void {
  const store = readTabStore();
  delete store[key];
  writeTabStore(store);
}

export function clearTabState(): void {
  try {
    sessionStorage.removeItem(TAB_KEY);
  } catch {
    /* nothing to clear */
  }
}

export type SavedScreen = {
  account: string;
  next: string;
  sessionEnded: boolean;
  payload: Record<string, unknown>;
};

const SAVED_SCREEN = 'tramela.saved.screen';

export function saveScreenForSignIn(saved: SavedScreen): void {
  try {
    sessionStorage.setItem(SAVED_SCREEN, JSON.stringify(saved));
  } catch {
    /* nothing saved */
  }
}

export function readSavedScreen(): SavedScreen | null {
  try {
    const raw = sessionStorage.getItem(SAVED_SCREEN);
    return raw ? (JSON.parse(raw) as SavedScreen) : null;
  } catch {
    return null;
  }
}

export function dropSavedScreen(): void {
  try {
    sessionStorage.removeItem(SAVED_SCREEN);
  } catch {
    /* nothing saved */
  }
}
