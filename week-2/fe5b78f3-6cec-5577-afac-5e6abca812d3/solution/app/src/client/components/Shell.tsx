// The top bar, main navigation and route ribbon on every screen.
import { LogIn, LogOut, Search, Ticket, TrainFront } from "lucide-react";
import { type ReactNode, createContext, useContext, useLayoutEffect, useState } from "react";
import { istTime } from "../../shared/format";
import { Link, navigate, useLocation } from "../lib/router";
import { useSession } from "../lib/session";

interface RibbonStop {
  code: string;
  name: string;
  /** IST timestamp of the departure (or arrival at the last stop). */
  at?: string;
  end?: boolean;
}

const RibbonContext = createContext<(stops: RibbonStop[]) => void>(() => undefined);

/** Shows these stops on the route ribbon while the calling screen is open, set before the browser paints so the
 * ribbon never changes height after the first frame. */
export function useRibbon(stops: RibbonStop[]): void {
  const set = useContext(RibbonContext);
  const key = JSON.stringify(stops);
  useLayoutEffect(() => {
    set(JSON.parse(key) as RibbonStop[]);
  }, [key, set]);
}

function RouteRibbon({ stops }: { stops: RibbonStop[] }) {
  return (
    <div className="ribbon-frame">
      <section className="ribbon" aria-label="Route" tabIndex={0}>
        {stops.length === 0 ? <p className="ribbon-empty">No route on this screen. Search trains to print one here.</p> : null}
        <ol hidden={stops.length === 0}>
          {stops.map((s) => (
            <li key={s.code + (s.at ?? "")} className={s.end ? "end" : undefined}>
              <span className="code">{s.code}</span>
              <span className="below">
                <span className="name">{s.name}</span>
                {s.at ? <time dateTime={s.at}>{istTime(s.at)} IST</time> : null}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { account, signOut } = useSession();
  const { pathname } = useLocation();
  const [stops, setStops] = useState<RibbonStop[]>([]);
  const current = (href: string): "page" | undefined =>
    (href === "/" ? pathname === "/" || pathname === "/trains" : pathname.startsWith(href)) ? "page" : undefined;
  return (
    <RibbonContext.Provider value={setStops}>
      <header className="topbar">
        <Link href="/" className="wordmark">
          <TrainFront size={20} strokeWidth={1.75} aria-hidden="true" />
          Pakka Rail <span className="stamp">PAKKA</span>
        </Link>
        <nav className="nav" aria-label="Main">
          <Link href="/" aria-current={current("/")}>
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            Search trains
          </Link>
          <Link href="/bookings" aria-current={current("/bookings")}>
            <Ticket size={16} strokeWidth={1.75} aria-hidden="true" />
            My bookings
          </Link>
          <Link href="/pnr" aria-current={current("/pnr")}>
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            PNR status
          </Link>
          {account ? (
            <button type="button" onClick={() => void signOut().then(() => navigate("/"))}>
              <LogOut size={16} strokeWidth={1.75} aria-hidden="true" />
              Sign out
            </button>
          ) : (
            <Link href="/signin" aria-current={current("/signin")}>
              <LogIn size={16} strokeWidth={1.75} aria-hidden="true" />
              Sign in
            </Link>
          )}
        </nav>
      </header>
      <RouteRibbon stops={stops} />
      <main>{children}</main>
    </RibbonContext.Provider>
  );
}
