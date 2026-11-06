import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, request } from './api.js';
import type { User } from './types.js';

export interface RouteState {
  path: string;
  query: URLSearchParams;
  navigate: (to: string, options?: { replace?: boolean }) => void;
  setQuery: (changes: Record<string, string | null>, options?: { replace?: boolean }) => void;
}

export const RouteContext = createContext<RouteState | null>(null);

export function useRoute(): RouteState {
  const route = useContext(RouteContext);
  if (route === null) throw new Error('route used outside the router');
  return route;
}

export function useRouteState(): RouteState {
  const [location, setLocation] = useState(() => ({
    path: window.location.pathname,
    search: window.location.search,
  }));

  useEffect(() => {
    const onPopState = (): void => {
      setLocation({ path: window.location.pathname, search: window.location.search });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    const url = new URL(to, window.location.origin);
    if (options?.replace === true) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    setLocation({ path: url.pathname, search: url.search });
  }, []);

  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const setQuery = useCallback(
    (changes: Record<string, string | null>, options?: { replace?: boolean }) => {
      const next = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      const text = next.toString();
      navigate(`${window.location.pathname}${text.length > 0 ? `?${text}` : ''}`, options);
    },
    [navigate],
  );

  return { path: location.path, query, navigate, setQuery };
}

export interface UserState {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const UserContext = createContext<UserState | null>(null);

export function useUser(): UserState {
  const state = useContext(UserContext);
  if (state === null) throw new Error('user used outside the provider');
  return state;
}

export function useUserState(): UserState {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const body = await request<{ user: User | null }>('/api/me');
      setUser(body.user);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await request('/api/auth/signout', { method: 'POST' });
    setUser(null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { user, loading, refresh, signOut };
}

const AGENDA_KEY = 'kerf-agenda';

function readAgenda(): string[] {
  try {
    const raw = window.localStorage.getItem(AGENDA_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export interface AgendaState {
  ids: string[];
  has: (id: string) => boolean;
  toggle: (id: string) => boolean;
  remove: (id: string) => void;
}

/** The agenda is kept in browser storage, so it survives reload in the same browser. */
export function useAgenda(): AgendaState {
  const [ids, setIds] = useState<string[]>(readAgenda);

  useEffect(() => {
    window.localStorage.setItem(AGENDA_KEY, JSON.stringify(ids));
  }, [ids]);

  const has = useCallback((id: string) => ids.includes(id), [ids]);

  const toggle = useCallback(
    (id: string) => {
      let added = false;
      setIds((current) => {
        if (current.includes(id)) return current.filter((item) => item !== id);
        added = true;
        return [...current, id];
      });
      return !ids.includes(id) || added;
    },
    [ids],
  );

  const remove = useCallback((id: string) => {
    setIds((current) => current.filter((item) => item !== id));
  }, []);

  return { ids, has, toggle, remove };
}

export interface ProviderProps {
  children: ReactNode;
}
