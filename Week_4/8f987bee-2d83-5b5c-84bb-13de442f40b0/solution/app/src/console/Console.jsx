import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Cross, Menu as MenuGlyph } from "../components/Icons.jsx";
import { Mark } from "../components/Logo.jsx";
import { useModal } from "../lib/dialog.js";
import { useMedia } from "../lib/media.js";
import { api, outageCopy, PERMISSION, toLogin } from "./api.js";
import Audit from "./Audit.jsx";
import Builder from "./Builder.jsx";
import { primeAudio } from "./chime.js";
import ConnectionPage from "./ConnectionPage.jsx";
import { ConsoleContext } from "./context.js";
import Dashboard from "./Dashboard.jsx";
import Destinations from "./Destinations.jsx";
import { draft } from "./draft.js";
import Members from "./Members.jsx";
import Palette from "./Palette.jsx";
import { mayOpen, PAGES } from "./pages.js";
import { session } from "./session.js";
import Settings from "./Settings.jsx";
import Sources from "./Sources.jsx";
import Switch from "./Switch.jsx";
import TablePage from "./TablePage.jsx";
import Wizard from "./Wizard.jsx";

// From 992 CSS pixels the console shows its fixed rail instead of the drawer.
const WIDE = "(min-width: 992px)";

function NavLinks({ role, onChoose }) {
  const { pathname } = useLocation();
  return (
    <ul className="rail-links">
      {PAGES.filter((page) => mayOpen(page.to, role)).map((page) => (
        <li key={page.to}>
          <NavLink to={page.to} end={page.end} onClick={onChoose} className={({ isActive }) =>
            `rail-link ${isActive || (page.end && pathname.startsWith("/app/connections")) ? "active" : ""}`}>
            {page.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

// Below 992 CSS pixels: the navigation drawer, a modal dialog sliding in from the left over a dimmed page.
function Drawer({ role, onClose }) {
  const close = useRef(null);
  const ref = useModal(true, onClose, close);
  return (
    <dialog ref={ref} className="drawer" aria-label="Navigation">
      <div className="drawer-top">
        <button ref={close} type="button" className="btn btn-outline btn-icon" aria-label="Close navigation" onClick={onClose}>
          <Cross width="18" height="18" />
        </button>
      </div>
      <NavLinks role={role} onChoose={onClose} />
    </dialog>
  );
}

function AccountMenu({ user, onSignOut }) {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  const item = useRef(null);
  const wrapper = useRef(null);
  useLayoutEffect(() => {
    if (open) item.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => {
      if (!wrapper.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const initials = user.name.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="account" ref={wrapper}>
      <button ref={button} type="button" className="avatar" aria-label="Account menu" aria-haspopup="menu"
        aria-expanded={open} onClick={() => setOpen(!open)} data-initials={initials} />
      {open && (
        <div className="account-menu" role="menu" aria-label="Account"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              button.current.focus();
            }
          }}>
          <p className="account-who"><strong>{user.name}</strong><span>{user.email} · {user.role}</span></p>
          <button ref={item} type="button" role="menuitem" className="btn btn-quiet" onClick={onSignOut}>Sign out</button>
        </div>
      )}
    </div>
  );
}

export default function Console() {
  const navigate = useNavigate();
  const location = useLocation();
  const wide = useMedia(WIDE);
  const [user, setUser] = useState(null);
  const [workspace, setWorkspace] = useState(null);
  const [alert, setAlert] = useState("");
  const [settingsStatus, setSettingsStatus] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const opener = useRef(null);

  const refreshUser = useCallback(async () => {
    const result = await api("/api/me");
    if (result.ok) setUser(result.body.user);
  }, []);
  const refreshWorkspace = useCallback(async () => {
    const result = await api("/api/workspace");
    if (result.ok) setWorkspace(result.body.workspace);
  }, []);

  useEffect(() => {
    if (!session.get()) {
      toLogin();
      return;
    }
    refreshWorkspace();
  }, [refreshWorkspace]);

  // Every page change reads the role again, so the pages and controls offered follow a role change at once.
  useEffect(() => {
    if (!session.get()) return;
    refreshUser();
    setAlert("");
    setSettingsStatus("");
    setDrawer(false);
    if (location.pathname !== "/app/connections/new") draft.discard();
  }, [location.pathname, refreshUser]);

  // A page the current role may not open is replaced by /app, so Back never returns to it.
  useEffect(() => {
    if (user && !mayOpen(location.pathname, user.role)) navigate("/app", { replace: true, state: { refused: true } });
  }, [user, location.pathname, navigate]);

  // Widening past 992 CSS pixels closes the drawer; the rail takes over.
  useEffect(() => {
    if (wide) setDrawer(false);
  }, [wide]);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // A refusal the whole page must show: permission copy (then the role is read again) or the outage copy.
  const report = useCallback((result) => {
    if (result.status === 403) {
      setAlert(PERMISSION);
      refreshUser();
    } else if (result.outage) {
      setAlert(outageCopy(result));
    }
  }, [refreshUser]);

  const savePreferences = async (changes) => {
    setUser((current) => ({ ...current, preferences: { ...current.preferences, ...changes } }));
    if (changes.sync_sounds) primeAudio();
    const result = await api("/api/me/preferences", { method: "PATCH", body: changes });
    if (result.ok) {
      setUser((current) => ({ ...current, preferences: result.body.preferences }));
      setSettingsStatus("Preferences saved");
    } else {
      report(result);
    }
    return result;
  };

  const signOut = async () => {
    await api("/api/auth/logout", { method: "POST", body: {} });
    session.clear();
    draft.discard();
    navigate("/");
  };

  const closeDrawer = useCallback(() => {
    setDrawer(false);
    opener.current?.focus();
  }, []);

  if (!user) return <div className="console console-loading" aria-busy="true" />;
  const editor = user.role !== "viewer";
  const admin = user.role === "admin";
  const theme = user.preferences.theme;
  const refused = location.state?.refused && location.pathname === "/app";
  const value = {
    user, workspace, editor, admin, report, refreshUser, refreshWorkspace, savePreferences, setAlert, setSettingsStatus,
  };

  return (
    <ConsoleContext.Provider value={value}>
      <div className="console" data-theme={theme}>
        {wide && (
          <aside className="rail">
            <Link className="rail-logo" to="/app" aria-label="Wayline console home">
              <Mark /><span aria-hidden="true">Wayline</span>
            </Link>
            <nav aria-label="Console"><NavLinks role={user.role} /></nav>
          </aside>
        )}
        <div className="console-main">
          <header className="topbar">
            {!wide && (
              <button ref={opener} type="button" className="btn btn-outline btn-icon drawer-button" aria-label="Open navigation"
                onClick={() => setDrawer(true)}>
                <MenuGlyph width="18" height="18" />
              </button>
            )}
            <span className="workspace-name">{workspace?.name ?? ""}</span>
            <p role="status" aria-label="Settings status" className="status-line settings-status">{settingsStatus}</p>
            <div className="topbar-tools">
              <Switch label="Sync sounds" checked={user.preferences.sync_sounds}
                onChange={(on) => savePreferences({ sync_sounds: on })} />
              <Switch label="Dark theme" checked={theme === "dark"}
                onChange={(on) => savePreferences({ theme: on ? "dark" : "light" })} />
              <AccountMenu user={user} onSignOut={signOut} />
            </div>
          </header>
          <main className="console-content" id="main">
            {(alert || refused) && <p role="alert" className="alert">{alert || PERMISSION}</p>}
            {mayOpen(location.pathname, user.role) && (
              <Routes>
                <Route index element={<Dashboard />} />
                <Route path="connections/new" element={<Wizard />} />
                <Route path="connections/:connectionId" element={<ConnectionPage />} />
                <Route path="sources" element={<Sources />} />
                <Route path="destinations" element={<Destinations />} />
                <Route path="destinations/:destinationId/tables/:table" element={<TablePage />} />
                <Route path="builder" element={<Builder />} />
                <Route path="members" element={<Members />} />
                <Route path="audit" element={<Audit />} />
                <Route path="settings" element={<Settings />} />
              </Routes>
            )}
          </main>
        </div>
        {drawer && !wide && <Drawer role={user.role} onClose={closeDrawer} />}
        {palette && <Palette onClose={() => setPalette(false)} />}
      </div>
    </ConsoleContext.Provider>
  );
}
