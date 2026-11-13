import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, failureOf, setToken, type Failure } from "./api.ts";
import type { Member, PoolsResponse, Role, Wallet } from "./types.ts";
import { NETWORK_FAILURE } from "../shared/copy.ts";
import { deskWall } from "../shared/format.ts";

// The browser's shared state: who is acting, which view is open, the live market, and the two feedback regions.

const STORED_SESSION = "quillmoor.session";

export const HOME: Record<Role, string> = {
  risk_steward: "/steward",
  liquidity_provider: "/supply",
  trader: "/trade",
  borrower: "/borrow",
  liquidator: "/liquidations",
};

// ---- navigation ----

interface Nav {
  path: string;
  /** The query string with its `?`, or an empty string. */
  search: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const NavContext = createContext<Nav>({ path: "/", search: "", navigate: () => undefined });

export function NavProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState({ path: window.location.pathname, search: window.location.search });
  useEffect(() => {
    const onPop = () => setLocation({ path: window.location.pathname, search: window.location.search });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((to: string, options: { replace?: boolean } = {}) => {
    if (options.replace) window.history.replaceState(null, "", to);
    else window.history.pushState(null, "", to);
    const url = new URL(to, window.location.origin);
    setLocation({ path: url.pathname, search: url.search });
    if (!options.replace) window.scrollTo({ top: 0 });
  }, []);
  const value = useMemo(() => ({ ...location, navigate }), [location, navigate]);
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  return useContext(NavContext);
}

// ---- feedback: Announcements (status) and Problems (alert) ----

export interface FieldLink {
  id: string;
  label: string;
}

export interface Announcement {
  text: string;
  link?: { href: string; label: string };
}

type Problem = { text: string } | { fields: FieldLink[] };

interface Feedback {
  announcement: Announcement | null;
  problem: Problem | null;
  announce: (announcement: Announcement | null) => void;
  report: (problem: Problem | null) => void;
  /** Shows a failed request in Problems: the API message verbatim, or the network copy. */
  reportFailure: (failure: Failure) => void;
}

const FeedbackContext = createContext<Feedback | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [announcement, announce] = useState<Announcement | null>(null);
  const [problem, report] = useState<Problem | null>(null);
  const reportFailure = useCallback((failure: Failure) => {
    if (failure.kind === "network") report({ text: NETWORK_FAILURE });
    else if (failure.kind === "error") report({ text: failure.message });
  }, []);
  const value = useMemo(() => ({ announcement, problem, announce, report, reportFailure }), [announcement, problem, reportFailure]);
  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}

export function useFeedback(): Feedback {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error("FeedbackProvider missing");
  return feedback;
}

// ---- session and live market ----

interface Session {
  members: Member[];
  member: Member | null;
  /** False until the stored or requested session has been resolved. */
  ready: boolean;
  /** True once the first pool and wallet reads have answered (or failed), so the sheet is painted once, complete. */
  loaded: boolean;
  choose: (actorId: string) => void;
  reloadMembers: () => void;
  market: PoolsResponse | null;
  /** The acting member's wallet and share holdings, as of the last refresh. */
  wallet: Wallet | null;
  /** Desk wall time of an API instant: `HH:MM:SS NST`, or with the date on the Ledger view. */
  wall: (iso: string, withDate?: boolean) => string;
  /** Bumped after every action; every live view refetches when it changes. */
  version: number;
  refresh: () => void;
}

const SessionContext = createContext<Session | null>(null);

interface StoredSession {
  actorId: string;
  token: string;
  /** The member as last read, so a returning visit shows its view at once and confirms the token in the background. */
  member?: Member;
}

function storedSession(): StoredSession | null {
  const text = window.localStorage.getItem(STORED_SESSION);
  if (text === null) return null;
  try {
    return JSON.parse(text) as StoredSession;
  } catch {
    return null;
  }
}

/** Opens a session for the member through the API and keeps its token for later visits. */
async function openSession(actorId: string): Promise<StoredSession> {
  const created = await api<{ token: string; actor_id: string }>("POST", "/api/sessions", { actor_id: actorId });
  const session = { actorId: created.actor_id, token: created.token };
  window.localStorage.setItem(STORED_SESSION, JSON.stringify(session));
  setToken(session.token);
  return session;
}

function rememberMember(member: Member): void {
  const stored = storedSession();
  if (stored) window.localStorage.setItem(STORED_SESSION, JSON.stringify({ ...stored, member }));
}

/** The member a returning visit starts from, so the top bar is drawn in its final shape on the first paint. */
function returningMember(): Member | null {
  if (new URLSearchParams(window.location.search).get("actor")) return null;
  return storedSession()?.member ?? null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const { navigate } = useNav();
  const { reportFailure } = useFeedback();
  const [member, setMember] = useState<Member | null>(returningMember);
  const [ready, setReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [market, setMarket] = useState<PoolsResponse | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const reloadMembers = useCallback(() => {
    api<{ actors: Member[] }>("GET", "/api/actors").then(
      (body) => setMembers(body.actors),
      (error: unknown) => reportFailure(failureOf(error)),
    );
  }, [reportFailure]);
  useEffect(reloadMembers, [reloadMembers]);

  // On load: `?actor=` opens a session for that member and is removed from the URL with a history replace once the
  // session has answered, so a reload before that opens it again; otherwise the stored token is used if the server still knows it.
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("actor");
    const resolve = async () => {
      if (requested) {
        await openSession(requested);
      } else {
        const stored = storedSession();
        if (stored) {
          setToken(stored.token);
          if (stored.member) {
            setMember(stored.member);
            setReady(true);
          }
        }
      }
      const me = await api<Member>("GET", "/api/me");
      if (requested) {
        params.delete("actor");
        const rest = params.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
      }
      return me;
    };
    resolve().then(
      (me) => {
        if (cancelled) return;
        rememberMember(me);
        setMember(me);
        setReady(true);
        navigate(`${window.location.pathname}${window.location.search}`, { replace: true });
      },
      (error: unknown) => {
        if (cancelled) return;
        setToken(null);
        setMember(null);
        window.localStorage.removeItem(STORED_SESSION);
        if (failureOf(error).kind === "network") reportFailure({ kind: "network" });
        setReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [navigate, reportFailure]);

  // Pool cards, the price rail and the wallet refetch every 5 seconds and after every action.
  const marketSeq = useRef(0);
  const loadMarket = useCallback(
    (initial: boolean) => {
      const seq = ++marketSeq.current;
      const pools = api<PoolsResponse>("GET", "/api/pools").then(
        (body) => {
          if (seq === marketSeq.current) setMarket(body);
        },
        (error: unknown) => {
          if (initial) reportFailure(failureOf(error));
        },
      );
      const balances = api<Wallet>("GET", "/api/wallet").then(
        (body) => {
          if (seq === marketSeq.current) setWallet(body);
        },
        () => undefined,
      );
      void Promise.all([pools, balances]).then(() => {
        if (seq === marketSeq.current) setLoaded(true);
      });
    },
    [reportFailure],
  );
  const memberId = member?.actor_id ?? null;
  useEffect(() => {
    if (memberId) loadMarket(version === 0);
  }, [loadMarket, version, memberId]);
  useEffect(() => {
    if (!memberId) return;
    const timer = window.setInterval(() => loadMarket(false), 5000);
    return () => window.clearInterval(timer);
  }, [loadMarket, memberId]);

  const choose = useCallback(
    (id: string) => {
      openSession(id).then(
        () =>
          api<Member>("GET", "/api/me").then((me) => {
            rememberMember(me);
            setMember(me);
            navigate(HOME[me.role]);
            setVersion((v) => v + 1);
          }),
        (error: unknown) => reportFailure(failureOf(error)),
      );
    },
    [navigate, reportFailure],
  );

  const zone = market?.desk_time_zone;
  const wall = useCallback((iso: string, withDate = false) => (zone ? deskWall(iso, zone, withDate) : ""), [zone]);
  const value = useMemo(
    () => ({ members, member, ready, loaded, choose, reloadMembers, market, wallet, wall, version, refresh }),
    [members, member, ready, loaded, choose, reloadMembers, market, wallet, wall, version, refresh],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("SessionProvider missing");
  return session;
}

/** Decimals of an asset as the server lists it. */
export function useDecimals(): (asset: string) => number {
  const { market } = useSession();
  return useCallback((asset: string) => market?.pools.find((p) => p.asset === asset)?.decimals ?? 0, [market]);
}

/**
 * Loads server data for a view and keeps it live: again whenever `deps` or the session version change, and every
 * `everyMs` while the view is open. Out-of-order replies are dropped, so only the latest request is shown.
 */
export function useLive<T>(load: (() => Promise<T>) | null, everyMs: number | null, deps: unknown[]): { data: T | undefined; reload: () => Promise<void> } {
  const { version } = useSession();
  const { reportFailure } = useFeedback();
  const [data, setData] = useState<T | undefined>(undefined);
  const seq = useRef(0);
  const loader = useRef(load);
  loader.current = load;
  const run = useCallback(
    (report: boolean): Promise<void> => {
      const current = loader.current;
      if (!current) return Promise.resolve();
      const mine = ++seq.current;
      return current().then(
        (value) => {
          if (mine === seq.current) setData(value);
        },
        (error: unknown) => {
          if (report && mine === seq.current) reportFailure(failureOf(error));
        },
      );
    },
    [reportFailure],
  );
  // The caller names what the load depends on; the loader itself is read through a ref.
  useEffect(() => {
    void run(true);
  }, [run, version, ...deps]);
  useEffect(() => {
    if (everyMs === null) return;
    const timer = window.setInterval(() => void run(false), everyMs);
    return () => window.clearInterval(timer);
  }, [run, everyMs]);
  return { data, reload: useCallback(() => run(false), [run]) };
}
