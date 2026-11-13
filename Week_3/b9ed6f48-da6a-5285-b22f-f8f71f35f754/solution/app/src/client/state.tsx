// App-wide state: the signed-in person, Motion and Sound, the Notices and Service notice live
// regions, and the dialogs any page can open (Sign in, Supporter plan).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiFailure, type Path, type Preferences, type User } from "./api.js";
import { COPY } from "../shared/copy.js";

interface AppState {
  user: User | null;
  userLoaded: boolean;
  preferences: Preferences;
  /** System reduced motion, the Motion switch off, or both. */
  reducedMotion: boolean;
  setPreference: (name: keyof Preferences, value: boolean) => void;
  signedIn: (user: User) => Promise<void>;
  signOut: () => Promise<void>;
  notice: { text: string; serial: number };
  announce: (text: string) => void;
  serviceNotice: string;
  setServiceNotice: (text: string) => void;
  openSignIn: (opener?: HTMLElement | null) => void;
  openPlan: (opener?: HTMLElement | null) => void;
  dialog: { kind: "sign-in" | "plan" | null; opener: HTMLElement | null; serial: number };
  closeDialog: () => void;
  /** Records a resolved chapter and/or position, keeping it in the page until PocketBase answers. */
  savePath: (change: { resolved?: number; position?: { chapter: number; exhibit: string } }) => void;
  pathVersion: number;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const value = useContext(Ctx);
  if (!value) throw new Error("useApp outside AppProvider");
  return value;
}

const systemQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>({ motion: true, sound: false });
  const [systemReduced, setSystemReduced] = useState(systemQuery.matches);
  const [notice, setNotice] = useState({ text: "", serial: 0 });
  const [serviceNotice, setServiceNotice] = useState("");
  const [dialog, setDialog] = useState<AppState["dialog"]>({ kind: null, opener: null, serial: 0 });
  const [pathVersion, setPathVersion] = useState(0);
  const pending = useRef<{ resolved: number[]; position: { chapter: number; exhibit: string } | null }>({ resolved: [], position: null });

  useEffect(() => {
    const listener = () => setSystemReduced(systemQuery.matches);
    systemQuery.addEventListener("change", listener);
    return () => systemQuery.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    api<{ user: User; preferences: Preferences }>("/api/me")
      .then((me) => {
        setUser(me.user);
        setPreferences(me.preferences);
      })
      .catch(() => setUser(null))
      .finally(() => setUserLoaded(true));
  }, []);

  // The shell waits (at most 2.5 s) for the session, so the header never re-wraps when the account controls arrive.
  const [shellReady, setShellReady] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setShellReady(true), 2500);
    return () => window.clearTimeout(timer);
  }, []);

  const reducedMotion = systemReduced || !preferences.motion;
  useEffect(() => {
    document.documentElement.classList.toggle("still", reducedMotion);
  }, [reducedMotion]);

  const announce = useCallback((text: string) => setNotice((n) => ({ text, serial: n.serial + 1 })), []);

  const accountsDown = useCallback((error: unknown) => {
    if (error instanceof ApiFailure && error.error.code === "accounts_unavailable") setServiceNotice(COPY.accountsDown);
  }, []);

  const setPreference = useCallback(
    (name: keyof Preferences, value: boolean) => {
      setPreferences((current) => {
        const next = { ...current, [name]: value };
        if (user) api("/api/me/preferences", { method: "PUT", body: next }).catch(accountsDown);
        return next;
      });
    },
    [user, accountsDown],
  );

  const flushPath = useCallback(async () => {
    const queued = pending.current;
    try {
      for (const chapter of [...queued.resolved]) {
        await api<{ path: Path }>("/api/me/path/resolved", { body: { chapter } });
        queued.resolved = queued.resolved.filter((n) => n !== chapter);
      }
      if (queued.position) {
        const position = queued.position;
        await api("/api/me/path/position", { method: "PUT", body: position });
        if (queued.position === position) queued.position = null;
      }
      setPathVersion((v) => v + 1);
    } catch (error) {
      accountsDown(error);
    }
  }, [accountsDown]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (pending.current.resolved.length || pending.current.position) void flushPath();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [flushPath]);

  const savePath = useCallback<AppState["savePath"]>(
    (change) => {
      if (change.resolved !== undefined && !pending.current.resolved.includes(change.resolved)) pending.current.resolved.push(change.resolved);
      if (change.position) pending.current.position = change.position;
      void flushPath();
    },
    [flushPath],
  );

  const signedIn = useCallback(async (next: User) => {
    setUser(next);
    setServiceNotice("");
    const me = await api<{ user: User; preferences: Preferences }>("/api/me");
    setPreferences(me.preferences);
  }, []);

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { body: {} });
    setUser(null);
    setPreferences({ motion: true, sound: false });
  }, []);

  const openSignIn = useCallback((opener?: HTMLElement | null) => setDialog((d) => ({ kind: "sign-in", opener: opener ?? null, serial: d.serial + 1 })), []);
  const openPlan = useCallback((opener?: HTMLElement | null) => setDialog((d) => ({ kind: "plan", opener: opener ?? null, serial: d.serial + 1 })), []);
  const closeDialog = useCallback(() => setDialog((d) => ({ kind: null, opener: d.opener, serial: d.serial })), []);

  const value = useMemo<AppState>(
    () => ({
      user,
      userLoaded,
      preferences,
      reducedMotion,
      setPreference,
      signedIn,
      signOut,
      notice,
      announce,
      serviceNotice,
      setServiceNotice,
      openSignIn,
      openPlan,
      dialog,
      closeDialog,
      savePath,
      pathVersion,
    }),
    [user, userLoaded, preferences, reducedMotion, setPreference, signedIn, signOut, notice, announce, serviceNotice, openSignIn, openPlan, dialog, closeDialog, savePath, pathVersion],
  );
  return <Ctx.Provider value={value}>{userLoaded || shellReady ? children : null}</Ctx.Provider>;
}
