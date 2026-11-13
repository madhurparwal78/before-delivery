import { useEffect, useRef, type ReactElement } from "react";
import { isPagePath } from "../shared/routes";
import { AnnouncementRegion } from "./lib/announce";
import { usePhone, useMotion } from "./lib/motion";
import { Link, useLocation } from "./lib/router";
import { SessionProvider, useSessionOrNull } from "./lib/session";
import { undoToast, useToast } from "./lib/toasts";
import { BookingPage } from "./pages/Booking";
import { EarningsPage } from "./pages/Earnings";
import { IdReviewPage, NetworkPage } from "./pages/Founder";
import { HomePage } from "./pages/Home";
import { MyRidesPage } from "./pages/MyRides";
import { NotFoundPage } from "./pages/NotFound";
import { OfferPage } from "./pages/Offer";
import { ProfilePage } from "./pages/Profile";
import { RidePage } from "./pages/Ride";
import { SearchPage } from "./pages/Search";
import { SignInPage } from "./pages/SignIn";
import { WalletPage } from "./pages/Wallet";
import { Dialog } from "./ui/Dialog";
import { useState } from "react";

function NavLinks({ onNavigate }: { onNavigate?: () => void }): ReactElement | null {
  const session = useSessionOrNull();
  const { path } = useLocation();
  if (!session) return null;
  const member = session.member;
  const founder = !!member?.roles.includes("founder");
  const links: [string, string][] = !member
    ? [["Search", "/search"], ["Offer a ride", "/offer"], ["Sign in", "/sign-in"]]
    : founder
      ? [["Search", "/search"], ["ID review", "/founder/id-review"], ["Network", "/founder/network"]]
      : [["Search", "/search"], ["Offer a ride", "/offer"], ["My rides", "/my-rides"], ["Wallet", "/wallet"], ["Earnings", "/earnings"], ["Profile", "/profile"]];
  return (
    <nav aria-label="Main" className="nav">
      <ul>
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} aria-current={path === href ? "page" : undefined} onClick={onNavigate}>
              {label}
            </Link>
          </li>
        ))}
        {member ? (
          <li>
            <button
              type="button"
              onClick={() => {
                onNavigate?.();
                void session.signOut();
              }}
            >
              Sign out
            </button>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

function Toasts(): ReactElement {
  const toast = useToast();
  const motion = useMotion("toast");
  const node = useRef<HTMLDivElement | null>(null);
  const { play } = motion;
  const id = toast?.id;
  useEffect(() => {
    if (id === undefined) return;
    play();
    if (motion.ms > 0) {
      node.current?.animate(
        { transform: ["translateY(16px)", "translateY(0)"], opacity: [0, 1] },
        { duration: motion.ms, easing: "ease-out" },
      );
    }
    // a new toast replays the motion
  }, [id]);
  return (
    <section aria-label="Notifications" className="notifications">
      {toast ? (
        <div ref={node} className="toast" data-motion="toast" data-motion-ms={motion.ms} data-state={motion.state}>
          <span>{toast.text}</span>
          <button type="button" onClick={undoToast}>
            {toast.actionLabel}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Pages(): ReactElement | null {
  const session = useSessionOrNull();
  const { path } = useLocation();
  if (!session) return null;
  if (!isPagePath(path)) return <NotFoundPage />;
  const parts = path.split("/").filter(Boolean);
  switch (parts[0]) {
    case undefined: return <HomePage />;
    case "search": return <SearchPage />;
    case "rides": return <RidePage key={parts[1]} id={parts[1] ?? ""} />;
    case "bookings": return <BookingPage key={parts[1]} id={parts[1] ?? ""} />;
    case "offer": return <OfferPage />;
    case "my-rides": return <MyRidesPage />;
    case "wallet": return <WalletPage />;
    case "earnings": return <EarningsPage />;
    case "profile": return <ProfilePage />;
    case "sign-in": return <SignInPage />;
    case "founder": return parts[1] === "network" ? <NetworkPage /> : <IdReviewPage />;
    default: return <NotFoundPage />;
  }
}

function Shell(): ReactElement {
  const phone = usePhone();
  const { path } = useLocation();
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    setMenu(false);
    window.scrollTo(0, 0);
  }, [path]);

  return (
    <>
      <header className="top" role="banner">
        <Link href="/" className="brand">
          Longseat
        </Link>
        {phone ? (
          <button type="button" className="menu-button" aria-haspopup="dialog" aria-expanded={menu} onClick={() => setMenu(true)}>
            Menu
          </button>
        ) : (
          <NavLinks />
        )}
      </header>
      <main id="main">
        <Pages />
      </main>
      <Toasts />
      <AnnouncementRegion />
      <Dialog open={menu && phone} title="Menu" sheet onClose={() => setMenu(false)}>
        <NavLinks onNavigate={() => setMenu(false)} />
      </Dialog>
    </>
  );
}

export function App(): ReactElement {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}
