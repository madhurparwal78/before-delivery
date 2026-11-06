// The app shell: the main navigation, the screen for the current path, the checkout dialog and the feedback dock.
import { useEffect, useState } from "react";
import { whenLoaded } from "./api.ts";
import { Checkout, CheckoutFeedback } from "./checkout/Checkout.tsx";
import { Admin } from "./pages/Admin.tsx";
import { BoxOffice } from "./pages/BoxOffice.tsx";
import { Curate } from "./pages/Curate.tsx";
import { Finance } from "./pages/Finance.tsx";
import { Group } from "./pages/Group.tsx";
import { OrderPage } from "./pages/Order.tsx";
import { Programme } from "./pages/Programme.tsx";
import { Register, SignIn } from "./pages/SignIn.tsx";
import { Studio } from "./pages/Studio.tsx";
import { Tickets } from "./pages/Tickets.tsx";
import { navigate, useLocation } from "./router.ts";
import { useSession } from "./session.tsx";
import type { Role } from "./types.ts";

const STAFF_LINKS: Partial<Record<Role, [string, string]>> = {
  artist: ["/studio", "Studio"], curator: ["/curate", "Curate"], box_office: ["/box-office", "Box office"],
  finance: ["/finance", "Finance"], group_booker: ["/group", "Group"], admin: ["/admin", "Admin"],
};

function Link({ to, children, current }: { to: string; children: string; current: boolean }) {
  return (
    <a href={to} aria-current={current ? "page" : undefined} className="nav__link"
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        const [path, hash] = to.split("#");
        navigate(path || "/");
        if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ block: "start" }));
        else window.scrollTo({ top: 0 });
      }}>
      {children}
    </a>
  );
}

function Nav({ pending }: { pending: boolean }) {
  const { user, signOut } = useSession();
  const { pathname } = useLocation();
  const own = user ? STAFF_LINKS[user.role] : undefined;
  return (
    // Hidden (still in the page) while pending, so its signed-in links never replace the signed-out ones on screen.
    <header className={pending ? "masthead is-pending" : "masthead"}>
      <nav aria-label="Main" className="nav">
        <a href="/" className="nav__brand" onClick={(e) => { e.preventDefault(); navigate("/"); window.scrollTo({ top: 0 }); }}>
          <span aria-hidden="true" className="nav__mark" />Kerf<span className="visually-hidden"> Frequencies home</span>
        </a>
        <ul className="nav__links">
          <li><Link to="/" current={pathname === "/"}>Programme</Link></li>
          <li><Link to="/#gallery" current={false}>Gallery</Link></li>
          <li><Link to="/#tickets" current={false}>Tickets</Link></li>
          <li><Link to="/tickets" current={pathname === "/tickets"}>My tickets</Link></li>
          {own && <li><Link to={own[0]} current={pathname === own[0]}>{own[1]}</Link></li>}
          <li>
            {user
              ? <button type="button" className="nav__button" onClick={() => void signOut().then(() => navigate("/"))}>Sign out</button>
              : <Link to="/signin" current={pathname === "/signin"}>Sign in</Link>}
          </li>
        </ul>
      </nav>
    </header>
  );
}

function Screen({ pathname }: { pathname: string }) {
  if (pathname === "/signin") return <SignIn />;
  if (pathname === "/register") return <Register />;
  if (pathname === "/tickets") return <Tickets />;
  if (pathname.startsWith("/orders/")) return <OrderPage id={decodeURIComponent(pathname.slice("/orders/".length))} />;
  if (pathname === "/studio") return <Studio />;
  if (pathname === "/curate") return <Curate />;
  if (pathname === "/box-office") return <BoxOffice />;
  if (pathname === "/finance") return <Finance />;
  if (pathname === "/group") return <Group />;
  if (pathname === "/admin") return <Admin />;
  return <Programme />;
}

function Footer() {
  return (
    <footer className="footer" data-ground="hero">
      <div className="grid footer__inner">
        <p className="display footer__word" aria-hidden="true">Kerf</p>
        <div>
          <p>Kerf Frequencies 2027 · 28–31 October · Brussels</p>
          <p>A festival of art and technology by Kerf Collective, a small nonprofit. Five venues, one lattice.</p>
        </div>
      </div>
    </footer>
  );
}

/** Screens that render at once: the programme (its lattice starts on load) and the forms, which load nothing. */
const IMMEDIATE = new Set(["/", "/signin", "/register"]);

export function App() {
  const { pathname, search } = useLocation();
  const { user, ready } = useSession();
  // The page appears once the session is known and the fonts are in (display words are fitted to their final
  // font), and staff and account screens once their first loads have landed: nothing visible is ever pushed.
  const [fontsReady, setFontsReady] = useState(false);
  useEffect(() => { void document.fonts.ready.then(() => setFontsReady(true)); }, []);
  const pending = !ready || !fontsReady;
  const [settledPath, setSettledPath] = useState<string | null>(null);
  const settling = pending || (!IMMEDIATE.has(pathname) && settledPath !== pathname);
  useEffect(() => {
    if (!ready || IMMEDIATE.has(pathname)) return;
    return whenLoaded(() => setSettledPath(pathname));
  }, [pathname, ready]);
  const checkoutOpen = !!user && (user.role === "visitor" || user.role === "group_booker") && search.has("checkout");
  useEffect(() => {
    document.documentElement.dataset.screen = pathname === "/" ? "programme" : "screen";
    if (pathname !== "/") document.documentElement.dataset.ground = "screen";
  }, [pathname]);
  return (
    <>
      <a href="#main" className="skip">Skip to content</a>
      <Nav pending={pending} />
      <main id="main" tabIndex={-1} aria-busy={settling || undefined}>
        <Screen pathname={pathname} />
      </main>
      <Footer />
      {checkoutOpen ? <Checkout /> : <div className="dock"><CheckoutFeedback /></div>}
    </>
  );
}
