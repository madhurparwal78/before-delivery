import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from './api.js';
import { messageFor } from '../../shared/copy.js';
import type { Preferences, User } from '../../shared/types.js';

interface MeResponse {
  user: User;
  preferences: Preferences;
}

interface StoreValue {
  user: User | null;
  preferences: Preferences;
  reducedMotion: boolean;
  notice: string;
  serviceNotice: string | null;
  announce: (text: string) => void;
  setServiceNotice: (text: string | null) => void;
  setPreference: (next: Partial<Preferences>) => void;
  signedIn: (user: User) => void;
  signedOut: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

function systemReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function StoreProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [preferences, setPreferences] = useState<Preferences>({ motion: true, sound: false });
  const [systemReduced, setSystemReduced] = useState(systemReducedMotion);
  const [notice, setNotice] = useState('');
  const [serviceNotice, setServiceNotice] = useState<string | null>(null);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setSystemReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    void api<MeResponse>('/api/me')
      .then((me) => {
        setUser(me.user);
        setPreferences(me.preferences);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.code === 'accounts_unavailable') {
          setServiceNotice(messageFor('accounts_unavailable'));
        }
      });
  }, []);

  const announce = useCallback((text: string) => setNotice(text), []);

  const setPreference = useCallback(
    (next: Partial<Preferences>) => {
      setPreferences((current) => {
        const merged = { ...current, ...next };
        void api<{ preferences: Preferences }>('/api/me/preferences', { method: 'PUT', body: merged }).catch(
          (error: unknown) => {
            if (error instanceof ApiError && error.code === 'accounts_unavailable') {
              setServiceNotice(messageFor('accounts_unavailable'));
            }
          },
        );
        return merged;
      });
    },
    [],
  );

  const value = useMemo<StoreValue>(
    () => ({
      user,
      preferences,
      reducedMotion: systemReduced || !preferences.motion,
      notice,
      serviceNotice,
      announce,
      setServiceNotice,
      setPreference,
      signedIn: (next: User) => {
        setUser(next);
        void api<MeResponse>('/api/me')
          .then((me) => setPreferences(me.preferences))
          .catch(() => undefined);
      },
      signedOut: () => {
        setUser(null);
        setPreferences({ motion: true, sound: false });
      },
    }),
    [user, preferences, systemReduced, notice, serviceNotice, announce, setPreference],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('Store is missing');
  return value;
}
