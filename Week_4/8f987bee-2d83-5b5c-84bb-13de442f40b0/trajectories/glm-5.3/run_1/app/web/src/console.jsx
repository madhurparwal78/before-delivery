import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Alert, Icon, Logo, Menu, Overlay } from "./components.jsx";
import { api, ApiError, readToken, writeToken } from "./api.js";

const UserContext = createContext({ user: null, reload: () => {}, setUser: () => {} });

export function useUser() {
  return useContext(UserContext);
}

const NAV_ITEMS = [
  { to: "/app", label: "Connections", minRole: "viewer" },
  { to: "/app/sources", label: "Sources", minRole: "viewer" },
  { to: "/app/destinations", label: "Destinations", minRole: "viewer" },
  { to: "/app/builder", label: "Builder", minRole: "editor" },
  { to: "/app/members", label: "Members", minRole: "admin" },
  { to: "/app/audit", label: "Audit log", minRole: "admin" },
  { to: "/app/settings", label: "Settings", minRole: "viewer" },
];

const ROLE_ORDER = { viewer: 0, editor: 1, admin: 2 };

export function roleAtLeast(role, min) {
  return ROLE_ORDER[role] >= ROLE_ORDER[min];
}

function ConsoleNav({ onNavigate }) {
  const { user } = useUser();
  const role = user?.role || "viewer";
  return (
    <nav className="nav-list" aria-label="Console">
      {NAV_ITEMS.filter((item) => roleAtLeast(role, item.minRole)).map((item) => (
        <NavLinkRow key={item.to} to={item.to} label={item.label} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

function NavLinkRow({ to, label, onNavigate }) {
  const location = useLocation();
  const active = to === "/app" ? location.pathname === "/app"
    : location.pathname === to || location.pathname.startsWith(`${to}/`);
  return (
    <Link to={to} className="nav-link" aria-current={active ? "page" : undefined}
      onClick={onNavigate}>
      {label}
    </Link>
  );
}

function CommandPalette({ onClose }) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [connections, setConnections] = useState([]);
  const { user } = useUser();
  const navigate = useNavigate();
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    api("/api/connections").then(({ data }) => setConnections(data.connections)).catch(() => {});
  }, []);

  const pages = NAV_ITEMS.filter((item) => roleAtLeast(user?.role || "viewer", item.minRole))
    .map((item) => ({ type: "page", label: item.label, to: item.to }));
  const matches = [
    ...connections.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 6)
      .map((c) => ({ type: "connection", label: c.name, to: `/app/connections/${c.id}` })),
    ...pages.filter((p) => p.label.toLowerCase().includes(query.toLowerCase())),
  ];

  const onKey = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const match = matches[highlight];
      if (match) {
        navigate(match.to);
        onClose();
      }
    }
  };

  return (
    <div className="dialog-backdrop" onKeyDown={onKey}>
      <div className="dialog" style={{ maxWidth: "520px" }} role="dialog" aria-modal="true"
        aria-label="Command palette">
        <input ref={inputRef} className="palette-input" type="text" value={query}
          placeholder="Search commands" aria-label="Search commands"
          onChange={(e) => { setQuery(e.target.value); setHighlight(0); }} />
        <ul className="palette-list" role="listbox">
          {matches.map((match, index) => (
            <li key={`${match.type}-${match.to}`} role="none">
              <button type="button" className="palette-option" role="option"
                aria-selected={index === highlight}
                data-highlighted={index === highlight}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => { navigate(match.to); onClose(); }}>
                <Icon name={match.type === "connection" ? "database" : "arrow"} />
                {match.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function ConsoleShell({ children }) {
  const [user, setUser] = useState(null);
  const [authState, setAuthState] = useState("loading");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [permission, setPermission] = useState("");
  const location = useLocation();
  const navigate = useNavigate();
  const wideRef = useRef(window.matchMedia("(min-width: 992px)"));
  const [wide, setWide] = useState(wideRef.current.matches);

  const reload = useCallback(async () => {
    const token = readToken();
    if (!token) {
      setUser(null);
      setAuthState("signedOut");
      return null;
    }
    try {
      const { data } = await api("/api/me");
      setUser(data.user);
      setAuthState("signedIn");
      return data.user;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        writeToken("");
        setUser(null);
        setAuthState("signedOut");
      } else if (error instanceof ApiError && error.status === 403) {
        const { data } = await api("/api/me");
        setUser(data.user);
        setAuthState("signedIn");
        return data.user;
      }
      return null;
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload, location.pathname]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 992px)");
    const onChange = () => {
      setWide(mq.matches);
      if (mq.matches) setDrawerOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (authState === "signedIn") setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [authState]);

  useEffect(() => {
    if (authState !== "signedOut") return;
    const next = encodeURIComponent(location.pathname + location.search);
    window.history.replaceState(null, "", `/login?next=${next}`);
    window.location.replace(`/login?next=${next}`);
  }, [authState, location]);

  const guard = useCallback((minRole) => {
    if (!user || !roleAtLeast(user.role, minRole)) {
      setPermission("You don't have permission to do that.");
      window.history.replaceState(null, "", "/app");
      navigate("/app", { replace: true });
    }
  }, [user, navigate]);

  const signOut = async () => {
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
    } catch {
      /* the session ends locally regardless */
    }
    writeToken("");
    window.location.replace("/");
  };

  const [prefsSaving, setPrefsSaving] = useState(false);
  const setPreference = async (patch) => {
    setPrefsSaving(true);
    try {
      const { data } = await api("/api/me/preferences", { method: "PATCH", body: patch });
      setUser((current) => ({ ...current, preferences: data.preferences }));
    } catch {
      /* preferences keep their stored value */
    } finally {
      setPrefsSaving(false);
    }
  };

  useEffect(() => {
    document.documentElement.dataset.theme = user?.preferences?.theme || "light";
  }, [user?.preferences?.theme]);

  const isAdmin = user?.role === "admin";

  return (
    <UserContext.Provider value={{ user, reload, setUser, guard }}>
      <div className="console">
        <aside className="console-rail">
          <nav aria-label="Console">
            <div style={{ marginBottom: "1.2rem" }}>
              <Link to="/app"><Logo /></Link>
            </div>
            <ConsoleNav />
          </nav>
        </aside>
        <div className="console-main">
          <header className="console-top">
            {!wide && (
              <button type="button" className="btn btn-outline btn-sm" aria-haspopup="dialog"
                aria-expanded={drawerOpen} onClick={() => setDrawerOpen(true)}>
                <Icon name="menu" />
                <span className="visually-hidden">Open navigation</span>
              </button>
            )}
            <strong style={{ color: "var(--ink)" }}>{user ? "Lumen Freight" : "Wayline"}</strong>
            <div style={{ marginLeft: "auto", display: "flex", gap: "0.8rem", alignItems: "center", flexWrap: "wrap" }}>
              <span className="switch">
                <input type="checkbox" role="switch" id="pref-sounds"
                  checked={Boolean(user?.preferences?.sync_sounds)} disabled={prefsSaving || !user}
                  onChange={(e) => setPreference({ sync_sounds: e.target.checked })} />
                <label className="switch-label" htmlFor="pref-sounds">Sync sounds</label>
              </span>
              <span className="switch">
                <input type="checkbox" role="switch" id="pref-theme"
                  checked={(user?.preferences?.theme || "light") === "dark"}
                  disabled={prefsSaving || !user}
                  onChange={(e) => setPreference({ theme: e.target.checked ? "dark" : "light" })} />
                <label className="switch-label" htmlFor="pref-theme">Dark theme</label>
              </span>
              <Menu label="Account menu" trigger={<span>{user ? user.name : "Account"}</span>}>
                {({ close }) => (
                  <>
                    <button type="button" className="menu-item" role="menuitem" onClick={() => {
                      close();
                      signOut();
                    }}>
                      Sign out
                    </button>
                  </>
                )}
              </Menu>
            </div>
          </header>
          <div className="console-body">
            {permission && (
              <Alert tone="error" id="console-permission">{permission}</Alert>
            )}
            {authState === "signedIn" ? children : (
              <p className="status-line" role="status" aria-live="polite">
                {authState === "loading" ? "Loading…" : ""}
              </p>
            )}
          </div>
        </div>
      </div>
      {drawerOpen && !wide && (
        <Overlay title="Navigation" onClose={() => setDrawerOpen(false)}>
          <ConsoleNav onNavigate={() => setDrawerOpen(false)} />
        </Overlay>
      )}
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
    </UserContext.Provider>
  );
}
