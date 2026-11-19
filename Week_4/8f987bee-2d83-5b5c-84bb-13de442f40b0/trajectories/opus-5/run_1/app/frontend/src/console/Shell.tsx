import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Icon, Logo } from "../components/Icon";
import { LiveStatus, Switch } from "../components/ui";
import { api, readToken, type RequestError } from "../lib/api";
import { generalCopy, PERMISSION_COPY } from "../lib/copy";
import { useFocusTrap, useViewportWidth } from "../lib/hooks";
import { CONSOLE_PAGES, mayOpen, useSession, type Preferences, type User } from "../lib/session";

interface Connection {
  id: string;
  name: string;
}

interface ConsoleStatus {
  settingsMessage: string;
  announceSettings: (message: string) => void;
  announceAlert: (message: string | null) => void;
}

const StatusContext = createContext<ConsoleStatus>({
  settingsMessage: "",
  announceSettings: () => undefined,
  announceAlert: () => undefined,
});

/** The console's single "Settings status" region, shared by the preferences and the plan. */
export function useConsoleStatus(): ConsoleStatus {
  return useContext(StatusContext);
}

/** The outage, database outage and permission copies, shown in the console's alert. */
export function useRefusalAlert(): (error: RequestError) => string | null {
  const { announceAlert } = useConsoleStatus();
  return (error: RequestError) => {
    const copy = generalCopy(error);
    announceAlert(copy);
    return copy;
  };
}

function navigationFor(role: User["role"]): { path: string; label: string }[] {
  return CONSOLE_PAGES.filter((page) => mayOpen(role, page.path));
}

function CommandPalette({
  connections,
  role,
  onClose,
}: {
  connections: Connection[];
  role: User["role"];
  onClose: () => void;
}): JSX.Element {
  const [typed, setTyped] = useState("");
  const [highlight, setHighlight] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useFocusTrap(true, panel);
  const options = [
    ...navigationFor(role).map((page) => ({ label: page.label, path: page.path })),
    ...connections.map((connection) => ({
      label: connection.name,
      path: `/app/connections/${connection.id}`,
    })),
  ].filter((option) => option.label.toLowerCase().includes(typed.toLowerCase()));

  useEffect(() => {
    panel.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label="Command palette" ref={panel}>
        <div className="field">
          <label htmlFor="palette-search">Search commands</label>
          <input
            id="palette-search"
            type="text"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setHighlight((index) => Math.min(index + 1, options.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setHighlight((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const option = options[highlight];
                if (option) {
                  onClose();
                  navigate(option.path);
                }
              }
            }}
          />
        </div>
        <div role="listbox" aria-label="Commands">
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              key={option.path}
              aria-selected={index === highlight}
              className="palette-option"
              onClick={() => {
                onClose();
                navigate(option.path);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Drawer({ role, onClose }: { role: User["role"]; onClose: () => void }): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  useFocusTrap(true, panel);
  useEffect(() => {
    close.current?.focus();
    const handle = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onClose]);
  return (
    <>
      <div className="drawer-backdrop" onMouseDown={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label="Navigation" ref={panel}>
        <button type="button" className="button outline" ref={close} onClick={onClose}>
          <Icon name="cross" />
          Close navigation
        </button>
        {navigationFor(role).map((page) => (
          <Link
            key={page.path}
            to={page.path}
            className={`nav-link ${location.pathname === page.path ? "active" : ""}`}
            onClick={onClose}
          >
            {page.label}
          </Link>
        ))}
      </div>
    </>
  );
}

export function ConsoleShell({ children }: { children: ReactNode }): JSX.Element {
  const session = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const width = useViewportWidth();
  const narrow = width < 992;
  const [workspace, setWorkspace] = useState<{ name: string } | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [alertAt, setAlertAt] = useState<string | null>(null);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [actionAlert, setActionAlert] = useState<string | null>(null);
  const drawerButton = useRef<HTMLButtonElement>(null);
  const paletteReturn = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!readToken()) {
      const here = `${location.pathname}${location.search}`;
      navigate(`/login?next=${encodeURIComponent(here)}`, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  const role = session.user?.role ?? null;

  useEffect(() => {
    if (!readToken()) return;
    void session.refresh().then((user) => {
      if (user && !mayOpen(user.role, location.pathname)) {
        setAlertAt("/app");
        navigate("/app", { replace: true });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    if (role && !mayOpen(role, location.pathname)) {
      setAlertAt("/app");
      navigate("/app", { replace: true });
    } else if (alertAt !== null && location.pathname !== alertAt) {
      setAlertAt(null);
    }
  }, [role, location.pathname, navigate, alertAt]);

  useEffect(() => {
    if (!readToken()) return;
    void api<{ workspace: { name: string } }>("GET", "/api/workspace")
      .then((answer) => setWorkspace(answer.workspace))
      .catch(() => setWorkspace(null));
    void api<{ connections: Connection[] }>("GET", "/api/connections")
      .then((answer) => setConnections(answer.connections))
      .catch(() => setConnections([]));
  }, [session.user?.id]);

  useEffect(() => {
    if (!narrow) setDrawerOpen(false);
  }, [narrow]);

  useEffect(() => {
    setActionAlert(null);
  }, [location.pathname]);

  useEffect(() => {
    const theme = session.user?.preferences.theme ?? "light";
    document.documentElement.setAttribute("data-theme", theme);
    return () => document.documentElement.removeAttribute("data-theme");
  }, [session.user?.preferences.theme]);

  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        paletteReturn.current = document.activeElement as HTMLElement;
        setPaletteOpen(true);
      }
      if (event.key === "Escape" && paletteOpen) {
        setPaletteOpen(false);
        paletteReturn.current?.focus();
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [paletteOpen]);

  const savePreferences = useCallback(
    async (next: Partial<Preferences>) => {
      const answer = await api<{ preferences: Preferences }>("PATCH", "/api/me/preferences", { body: next });
      session.setPreferences(answer.preferences);
      setSettingsMessage("Preferences saved");
    },
    [session],
  );

  const preferences = session.user?.preferences ?? { sync_sounds: false, theme: "light" as const };

  return (
    <StatusContext.Provider
      value={{ settingsMessage, announceSettings: setSettingsMessage, announceAlert: setActionAlert }}
    >
    <div className="console">
      <div className="console-top">
        <Link to="/app" className="logo">
          <Logo />
        </Link>
        {narrow ? (
          <button
            type="button"
            className="button outline"
            ref={drawerButton}
            onClick={() => setDrawerOpen(true)}
          >
            <Icon name="lines" />
            Open navigation
          </button>
        ) : null}
        <span className="workspace-name">{workspace?.name ?? "Wayline"}</span>
        <Switch
          label="Sync sounds"
          checked={preferences.sync_sounds}
          onChange={(next) => void savePreferences({ sync_sounds: next })}
        />
        <Switch
          label="Dark theme"
          checked={preferences.theme === "dark"}
          onChange={(next) => void savePreferences({ theme: next ? "dark" : "light" })}
        />
        <LiveStatus name="Settings status" message={settingsMessage} />
        <div className="menu-shell">
          <button
            type="button"
            className="button outline"
            aria-expanded={accountOpen}
            aria-label="Account menu"
            onClick={() => setAccountOpen(!accountOpen)}
          >
            {(session.user?.name ?? "W").slice(0, 1)}
          </button>
          {accountOpen ? (
            <div className="menu-panel" role="menu" aria-label="Account">
              <button
                type="button"
                role="menuitem"
                className="palette-option"
                onClick={async () => {
                  setAccountOpen(false);
                  await session.signOut();
                  navigate("/");
                }}
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
      <div className="console-body">
        {!narrow && role ? (
          <nav className="console-rail" aria-label="Console">
            {navigationFor(role).map((page) => (
              <Link
                key={page.path}
                to={page.path}
                className={`nav-link ${location.pathname === page.path ? "active" : ""}`}
              >
                {page.label}
              </Link>
            ))}
          </nav>
        ) : null}
        <main className="console-main">
          <div className="console-content">
            {alertAt === location.pathname ? (
              <div className="alert" role="alert">
                {PERMISSION_COPY}
              </div>
            ) : null}
            {actionAlert !== null ? (
              <div className="alert" role="alert">
                {actionAlert}
              </div>
            ) : null}
            {children}
          </div>
        </main>
      </div>
      {drawerOpen && role ? (
        <Drawer
          role={role}
          onClose={() => {
            setDrawerOpen(false);
            window.setTimeout(() => drawerButton.current?.focus(), 0);
          }}
        />
      ) : null}
      {paletteOpen && role ? (
        <CommandPalette
          connections={connections}
          role={role}
          onClose={() => {
            setPaletteOpen(false);
            paletteReturn.current?.focus();
          }}
        />
      ) : null}
    </div>
    </StatusContext.Provider>
  );
}
