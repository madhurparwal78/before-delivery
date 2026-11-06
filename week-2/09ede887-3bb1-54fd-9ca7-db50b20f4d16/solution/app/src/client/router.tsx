import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';

// A small history-API router. Each history entry carries a key; the scroll position and the
// followed session link of every entry are remembered against that key so Back and Forward
// can restore them.

export interface Place {
  path: string;
  search: string;
  hash: string;
  key: string;
}

export type NavType = 'initial' | 'push' | 'pop';

interface EntryMemory {
  scrollY: number;
  followed: string | null;
}

// Answers a guarded navigation: call `proceed` to carry it out.
export type Guard = (proceed: () => void) => void;

interface NavigateOptions {
  replace?: boolean;
  keepScroll?: boolean;
}

interface RouterValue {
  place: Place;
  navType: NavType;
  navigate: (to: string, options?: NavigateOptions) => void;
  memory: (key: string) => EntryMemory;
  setGuard: (guard: Guard | null) => void;
}

const RouterContext = createContext<RouterValue | null>(null);
const memories = new Map<string, EntryMemory>();

function memoryFor(key: string): EntryMemory {
  let entry = memories.get(key);
  if (!entry) {
    entry = { scrollY: 0, followed: null };
    memories.set(key, entry);
  }
  return entry;
}

function newKey(): string {
  return crypto.randomUUID();
}

function keyOf(state: unknown): string | null {
  return typeof state === 'object' && state !== null && 'key' in state && typeof state.key === 'string' ? state.key : null;
}

function readPlace(): Place {
  let key = keyOf(window.history.state);
  if (!key) {
    key = newKey();
    window.history.replaceState({ key }, '');
  }
  return { path: window.location.pathname, search: window.location.search, hash: window.location.hash, key };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ place: Place; navType: NavType }>(() => ({ place: readPlace(), navType: 'initial' }));
  const placeRef = useRef(state.place);
  const guardRef = useRef<Guard | null>(null);

  useEffect(() => {
    placeRef.current = state.place;
  }, [state.place]);

  const go = useCallback((to: string, options: NavigateOptions) => {
    memoryFor(placeRef.current.key).scrollY = window.scrollY;
    const url = new URL(to, window.location.origin);
    const key = newKey();
    const target = url.pathname + url.search + url.hash;
    if (options.replace) window.history.replaceState({ key }, '', target);
    else window.history.pushState({ key }, '', target);
    const place = { path: url.pathname, search: url.search, hash: url.hash, key };
    placeRef.current = place;
    setState({ place, navType: 'push' });
    if (!options.keepScroll) window.scrollTo(0, 0);
  }, []);

  const navigate = useCallback(
    (to: string, options: NavigateOptions = {}) => {
      const guard = guardRef.current;
      if (guard) guard(() => go(to, options));
      else go(to, options);
    },
    [go],
  );

  useEffect(() => {
    window.history.scrollRestoration = 'manual';
    const onPop = () => {
      const outgoing = placeRef.current;
      memoryFor(outgoing.key).scrollY = window.scrollY;
      const guard = guardRef.current;
      if (guard) {
        window.history.pushState({ key: outgoing.key }, '', outgoing.path + outgoing.search + outgoing.hash);
        guard(() => window.history.back());
        return;
      }
      const place = readPlace();
      placeRef.current = place;
      setState({ place, navType: 'pop' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const value = useMemo<RouterValue>(
    () => ({
      place: state.place,
      navType: state.navType,
      navigate,
      memory: memoryFor,
      setGuard: (guard) => {
        guardRef.current = guard;
      },
    }),
    [state, navigate],
  );
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('useRouter outside RouterProvider');
  return value;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: string };

export function Link({ to, onClick, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={follow} {...rest} />;
}

// `next` after sign-in: only a same-origin path, else the agenda.
export function safeNext(next: string | null): string {
  if (next && next.startsWith('/') && next[1] !== '/' && next[1] !== '\\') return next;
  return '/agenda';
}

export function signInPath(place: Place): string {
  return `/signin?next=${encodeURIComponent(place.path + place.search)}`;
}
