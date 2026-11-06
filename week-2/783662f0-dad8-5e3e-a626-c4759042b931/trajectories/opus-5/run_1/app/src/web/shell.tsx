import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Volume2 } from 'lucide-react';
import { SUSPENDED_BANNER, pastDueBanner } from '../shared/copy.js';
import type { CharacterObject, ServerObject, UserObject } from '../shared/types.js';
import { get, post } from './api.js';
import { FriendsDialog } from './pages/dialogs.js';
import { Link, useRouter } from './router.js';
import { setSoundOn } from './sound.js';
import { useInterval, useWidthBand } from './ui.js';

interface MeResponse {
  user: UserObject;
  servers: ServerObject[];
  preferences: { sound: boolean };
}

interface SessionValue {
  readonly user: UserObject | null;
  readonly servers: readonly ServerObject[];
  readonly sound: boolean;
  readonly loaded: boolean;
  readonly refresh: () => Promise<void>;
  readonly setSound: (on: boolean) => Promise<void>;
  readonly signedOut: () => void;
}

const SessionContext = createContext<SessionValue>({
  user: null,
  servers: [],
  sound: false,
  loaded: false,
  refresh: async () => undefined,
  setSound: async () => undefined,
  signedOut: () => undefined,
});

export const useSession = (): SessionValue => useContext(SessionContext);

export function SessionProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<{
    user: UserObject | null;
    servers: ServerObject[];
    sound: boolean;
    loaded: boolean;
  }>({ user: null, servers: [], sound: false, loaded: false });

  const refresh = useCallback(async () => {
    try {
      const me = await get<MeResponse>('/api/me');
      setSoundOn(me.preferences.sound);
      setState({
        user: me.user,
        servers: me.servers,
        sound: me.preferences.sound,
        loaded: true,
      });
    } catch {
      setSoundOn(false);
      setState({ user: null, servers: [], sound: false, loaded: true });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setSound = useCallback(async (on: boolean) => {
    const answer = await post<{ preferences: { sound: boolean } }>('/api/me/preferences', {
      sound: on,
    });
    setSoundOn(answer.preferences.sound);
    setState((current) => ({ ...current, sound: answer.preferences.sound }));
  }, []);

  const signedOut = useCallback(() => {
    setSoundOn(false);
    setState({ user: null, servers: [], sound: false, loaded: true });
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ ...state, refresh, setSound, signedOut }),
    [state, refresh, setSound, signedOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** The Server object is re-read when a page opens and at least every 10 seconds. */
export function useServer(slug: string | undefined): {
  server: ServerObject | null;
  reload: () => Promise<void>;
} {
  const [server, setServer] = useState<ServerObject | null>(null);
  const current = useRef(slug);
  current.current = slug;

  const reload = useCallback(async () => {
    if (slug === undefined) return;
    try {
      const next = await get<ServerObject>(`/api/servers/${slug}`);
      if (current.current === slug) setServer(next);
    } catch {
      /* The last confirmed state stays on screen. */
    }
  }, [slug]);

  useEffect(() => {
    setServer(null);
    void reload();
  }, [reload]);

  useInterval(10000, () => {
    void reload();
  });

  return { server, reload };
}

/**
 * The active character is shared by the top bar's picker and every server
 * screen, so that picking one on the roster also picks it on the world view.
 */
interface RosterValue {
  readonly characters: readonly CharacterObject[];
  readonly activeId: string | null;
  readonly active: CharacterObject | null;
  readonly pick: (id: string) => void;
  readonly reload: () => Promise<void>;
}

const RosterContext = createContext<RosterValue>({
  characters: [],
  activeId: null,
  active: null,
  pick: () => undefined,
  reload: async () => undefined,
});

export const useRoster = (): RosterValue => useContext(RosterContext);

export function RosterProvider({
  slug,
  children,
}: {
  slug: string | undefined;
  children: ReactNode;
}): ReactNode {
  const [characters, setCharacters] = useState<CharacterObject[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (slug === undefined) {
      setCharacters([]);
      return;
    }
    try {
      const answer = await get<{ characters: CharacterObject[] }>(
        `/api/servers/${slug}/characters?mine=true`,
      );
      setCharacters(answer.characters);
      setActiveId((current) =>
        current !== null && answer.characters.some((entry) => entry.id === current)
          ? current
          : (answer.characters[0]?.id ?? null),
      );
    } catch {
      setCharacters([]);
    }
  }, [slug]);

  useEffect(() => {
    setActiveId(null);
    void reload();
  }, [reload]);

  const value = useMemo<RosterValue>(
    () => ({
      characters,
      activeId,
      active: characters.find((entry) => entry.id === activeId) ?? null,
      pick: setActiveId,
      reload,
    }),
    [characters, activeId, reload],
  );

  return <RosterContext.Provider value={value}>{children}</RosterContext.Provider>;
}

export function TopBar({
  server,
  showPicker,
  picker,
}: {
  server: ServerObject | null;
  showPicker: boolean;
  picker: ReactNode;
}): ReactNode {
  const { user, signedOut } = useSession();
  const { go } = useRouter();
  const band = useWidthBand();
  const [menuOpen, setMenuOpen] = useState(false);
  const [friendsOpen, setFriendsOpen] = useState(false);

  const firstWorld = server?.worlds[0]?.slug;
  const playTo =
    server !== null && firstWorld !== undefined ? `/s/${server.slug}/w/${firstWorld}` : '/servers';
  const gamesTo = server !== null ? `/s/${server.slug}/games` : '/servers';
  const compact = band === 'small';

  return (
    <header className="topbar">
      <span className="wordmark">Plotwright</span>
      <nav aria-label="Main">
        <ul>
          <li>
            <Link to={playTo}>Play</Link>
          </li>
          <li>
            <Link to={gamesTo}>Games</Link>
          </li>
          <li>
            <Link to="/help">Help</Link>
          </li>
        </ul>
      </nav>
      <span className="spacer" />
      {compact ? (
        <button
          type="button"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          Menu
        </button>
      ) : null}
      <div className="menu-panel" hidden={compact && !menuOpen}>
        {server !== null ? (
          <span className="bar-links">
            <Link to={`/s/${server.slug}/roster`}>Roster</Link>
            <Link to={`/s/${server.slug}/coins`}>Coins</Link>
            <Link to={`/s/${server.slug}/leaderboards`}>Leaderboards</Link>
            <button type="button" onClick={() => setFriendsOpen(true)}>
              Friends
            </button>
            {server.role === 'owner' ? (
              <>
                <Link to={`/s/${server.slug}/billing`}>Billing</Link>
                <Link to={`/s/${server.slug}/admin`}>Server admin</Link>
              </>
            ) : null}
          </span>
        ) : null}
        {showPicker ? picker : null}
        {user !== null ? (
          <button
            type="button"
            onClick={() => {
              void fetch('/api/session', { method: 'DELETE', credentials: 'same-origin' }).then(
                () => {
                  signedOut();
                  go('/sign-in');
                },
              );
            }}
          >
            Sign out
          </button>
        ) : null}
      </div>
      {friendsOpen && server !== null ? (
        <FriendsDialog slug={server.slug} onClose={() => setFriendsOpen(false)} />
      ) : null}
    </header>
  );
}

/**
 * The banner is chosen only from the Server object's status and
 * suspends_at_label, whatever the device clock says.
 */
export function ServerNotice({ server }: { server: ServerObject | null }): ReactNode {
  if (server === null) return null;
  if (server.status === 'past_due') {
    return (
      <div role="region" aria-label="Server notice" className="banner past-due">
        {pastDueBanner(server.suspends_at_label ?? '')}
      </div>
    );
  }
  if (server.status === 'suspended') {
    return (
      <div role="region" aria-label="Server notice" className="banner suspended">
        {SUSPENDED_BANNER}
      </div>
    );
  }
  return null;
}

export function SoundToggle(): ReactNode {
  const { sound, setSound } = useSession();
  return (
    <button
      type="button"
      aria-pressed={sound}
      onClick={() => {
        void setSound(!sound);
      }}
    >
      <Volume2 aria-hidden="true" size={16} /> Sound
    </button>
  );
}
