import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ConfigBody, UserBody } from '../shared/api.js';
import { api } from './api.js';
import { syncServerTime } from './clock.js';
import { setToastLifetime } from './notices.js';
import { navigate, useLocation } from './router.js';

interface Session {
  ready: boolean;
  username: string | null;
  setUsername: (username: string | null) => void;
}

const SessionContext = createContext<Session>({ ready: false, username: null, setUsername: () => undefined });
export const useSession = (): Session => useContext(SessionContext);

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [ready, setReady] = useState(false);
  const [username, setUsername] = useState<string | null>(null);
  useEffect(() => {
    void api.get<ConfigBody>('/api/config').then((config) => {
      syncServerTime(config.server_time);
      setToastLifetime(config.toast_ms);
    });
    void api.get<UserBody>('/api/me')
      .then((body) => setUsername(body.user.username), () => setUsername(null))
      .finally(() => setReady(true));
  }, []);
  return <SessionContext.Provider value={{ ready, username, setUsername }}>{children}</SessionContext.Provider>;
}

// Signed-out visitors to a signed-in route are sent to /signin?next=<that path>.
export function RequireUser({ children }: { children: (username: string) => ReactNode }): ReactNode {
  const { ready, username } = useSession();
  const { path, query } = useLocation();
  const search = query.toString();
  useEffect(() => {
    if (ready && !username) navigate(`/signin?next=${encodeURIComponent(path + (search ? `?${search}` : ''))}`, true);
  }, [ready, username, path, search]);
  if (!ready || !username) return <p className="loading">Loading...</p>;
  return children(username);
}
