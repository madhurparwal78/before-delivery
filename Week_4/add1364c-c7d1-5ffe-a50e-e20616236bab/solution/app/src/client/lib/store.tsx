import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from "react";
import { ApiError, get, del, setApiHooks, whenQuiet } from "./api";
import { advance, type ClockState } from "./office";
import { useRouter } from "./router";
import type { Clock, Person } from "./types";

type EventName = "rule-in-force" | "access-changed" | "session-ended" | "billing-changed" | "check-finished" | "review-opened" | "review-changed" | "seat-confirmed";
type Handler = (data: Record<string, unknown>) => void;
interface Message { text: string; key: number }

interface Store {
  me: Person | null;
  meLoaded: boolean;
  sessionEnded: boolean;
  endedRoute: string;
  office: { date: string; time: string; offset: string } | null;
  refreshMe: () => Promise<Person | null>;
  refreshClock: () => Promise<void>;
  status: Message;
  alert: Message;
  say: (text: string) => void;
  warn: (text: string) => void;
  subscribe: (name: EventName, handler: Handler) => () => void;
  // Bumped whenever the event stream opens. The stream starts only once the page's reads go quiet, so an event
  // sent before that is never delivered: a page that shows pushed state reads it again on each bump.
  streamTick: number;
  auditTick: number;
  bumpAudit: () => void;
  signOut: () => Promise<void>;
  reduced: boolean;
  peopleBusy: MutableRefObject<number>;
  // The vault ids the drawer is showing, sent when the stream attaches so the server can tell this page which
  // of them it may no longer see.
  shownVaults: MutableRefObject<string[]>;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("Store missing");
  return store;
}

const EVENT_NAMES: EventName[] = ["rule-in-force", "access-changed", "session-ended", "billing-changed", "check-finished", "review-opened", "review-changed", "seat-confirmed"];

export function StoreProvider({ children }: { children: ReactNode }) {
  const { location, navigate } = useRouter();
  const [me, setMe] = useState<Person | null>(null);
  const [meLoaded, setMeLoaded] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [endedRoute, setEndedRoute] = useState("/desk");
  const [clock, setClock] = useState<ClockState | null>(null);
  const [office, setOffice] = useState<Store["office"]>(null);
  const [status, setStatus] = useState<Message>({ text: "", key: 0 });
  const [alert, setAlert] = useState<Message>({ text: "", key: 0 });
  const [auditTick, setAuditTick] = useState(0);
  const [streamTick, setStreamTick] = useState(0);
  const shownVaults = useRef<string[]>([]);
  const handlers = useRef(new Map<EventName, Set<Handler>>());
  const counter = useRef(0);
  const peopleBusy = useRef(0);
  const routeRef = useRef(location.path + location.search);
  routeRef.current = location.path + location.search;
  const reduced = useMemo(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  const refreshClock = useCallback(async () => {
    try {
      const base = await get<Clock>("/api/clock");
      setClock({ base, mono: performance.now() });
    } catch { /* the next tick tries again */ }
  }, []);

  useEffect(() => {
    void refreshClock();
    const timer = window.setInterval(() => void refreshClock(), 20000);
    return () => window.clearInterval(timer);
  }, [refreshClock]);

  useEffect(() => {
    if (!clock) return;
    const update = () => setOffice(advance(clock, performance.now()));
    update();
    const timer = window.setInterval(update, 5000);
    return () => window.clearInterval(timer);
  }, [clock]);

  const refreshMe = useCallback(async () => {
    try {
      const body = await get<{ person: Person }>("/api/me", { quiet401: true });
      setMe(body.person);
      setMeLoaded(true);
      asked.current = true;
      return body.person;
    } catch (error) {
      if (error instanceof ApiError && error.code === "session_ended") {
        setEndedRoute(routeRef.current);
        setSessionEnded(true);
      }
      setMe(null);
      setMeLoaded(true);
      return null;
    }
  }, []);

  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !/^\/(desk|rotations|reviews|people|travel|billing|health|import|audit)(\/|$)/.test(location.path)) return;
    asked.current = true;
    void refreshMe();
  }, [location.path, refreshMe]);

  useEffect(() => {
    setApiHooks({
      onSessionEnded: () => { setEndedRoute(routeRef.current); setSessionEnded(true); },
      onSignedOut: () => {
        setMe(null);
        setMeLoaded(true);
        navigate(`/sign-in?next=${encodeURIComponent(routeRef.current)}`, true);
      },
    });
  }, [navigate]);

  const say = useCallback((text: string) => { counter.current += 1; setStatus({ text, key: counter.current }); }, []);
  const warn = useCallback((text: string) => { counter.current += 1; setAlert({ text, key: counter.current }); }, []);

  const subscribe = useCallback((name: EventName, handler: Handler) => {
    const set = handlers.current.get(name) ?? new Set<Handler>();
    set.add(handler);
    handlers.current.set(name, set);
    return () => { set.delete(handler); };
  }, []);

  useEffect(() => {
    if (!me || sessionEnded) return;
    let source: EventSource | null = null;
    let listeners: [string, (event: MessageEvent<string>) => void][] = [];
    const opened = () => setStreamTick((n) => n + 1);
    // Open the stream once the first paint's requests are done: a stream that never ends would otherwise keep the
    // page from ever settling for anything that waits for the network to go quiet.
    const open = () => {
      const seen = shownVaults.current;
      const stream = new EventSource(seen.length > 0 ? `/api/events?seen=${encodeURIComponent(seen.join(","))}` : "/api/events");
      source = stream;
      listeners = EVENT_NAMES.map((name) => {
        const listener = (event: MessageEvent<string>) => {
          let data: Record<string, unknown> = {};
          try { data = JSON.parse(event.data || "{}") as Record<string, unknown>; } catch { data = {}; }
          if (name === "session-ended") {
            setEndedRoute(routeRef.current);
            setSessionEnded(true);
          }
          handlers.current.get(name)?.forEach((h) => h(data));
        };
        stream.addEventListener(name, listener as EventListener);
        return [name, listener];
      });
      stream.addEventListener("open", opened as EventListener);
    };
    // Wait for the load event, then for the page's own API reads to have been quiet for a while (slow
    // directory or billing reads included), so the page settles before the endless stream starts.
    let cancel: () => void = () => undefined;
    const later = () => { cancel = whenQuiet(1200, open); };
    if (document.readyState === "complete") later();
    else window.addEventListener("load", later, { once: true });
    return () => {
      window.removeEventListener("load", later);
      cancel();
      const stream = source;
      if (stream) {
        listeners.forEach(([name, listener]) => stream.removeEventListener(name, listener as EventListener));
        stream.removeEventListener("open", opened as EventListener);
        stream.close();
      }
    };
  }, [me, sessionEnded]);

  const signOut = useCallback(async () => {
    try { await del("/api/sessions"); } catch { /* already signed out */ }
    setMe(null);
    navigate("/");
  }, [navigate]);

  const value = useMemo<Store>(() => ({
    me, meLoaded, sessionEnded, endedRoute, office, refreshMe, refreshClock, status, alert, say, warn, subscribe,
    streamTick, auditTick, bumpAudit: () => setAuditTick((n) => n + 1), signOut, reduced, peopleBusy, shownVaults,
  }), [me, meLoaded, sessionEnded, endedRoute, office, refreshMe, refreshClock, status, alert, say, warn, subscribe, streamTick, auditTick, signOut, reduced]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useEvent(name: EventName, handler: Handler): void {
  const { subscribe } = useStore();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe(name, (data) => ref.current(data)), [subscribe, name]);
}

