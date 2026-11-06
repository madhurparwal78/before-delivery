import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./components/Shell";
import { Account } from "./pages/Account";
import { Book } from "./pages/Book";
import { BookingDetail } from "./pages/BookingDetail";
import { MyBookings } from "./pages/MyBookings";
import { NotFound } from "./pages/NotFound";
import { Pnr } from "./pages/Pnr";
import { Results } from "./pages/Results";
import { Search } from "./pages/Search";
import { useLocation } from "./lib/router";
import { SessionProvider } from "./lib/session";
import "./styles.css";

function Screen() {
  const { pathname, path } = useLocation();
  const booking = /^\/bookings\/([^/]+)$/.exec(pathname);
  const pnr = /^\/pnr(?:\/([^/]+))?$/.exec(pathname);
  if (pathname === "/") return <Search />;
  if (pathname === "/trains") return <Results key={pathname} />;
  if (pathname === "/book") return <Book key={path} />;
  if (pathname === "/bookings") return <MyBookings />;
  if (booking?.[1]) return <BookingDetail key={booking[1]} pnr={decodeURIComponent(booking[1])} />;
  if (pnr) return <Pnr key="pnr" initial={pnr[1] ? decodeURIComponent(pnr[1]) : ""} />;
  if (pathname === "/signin") return <Account key="signin" mode="signin" />;
  if (pathname === "/register") return <Account key="register" mode="register" />;
  return <NotFound />;
}

// The faces the first screen sets text in. The first render waits for them (at most 1.5 s), so text never reflows
// when a web font swaps in after the fallback has been laid out.
const FIRST_FACES = ['700 1em "Archivo"', '600 1em "Archivo"', '400 1em "IBM Plex Sans"',
  '600 1em "IBM Plex Sans"', '400 1em "JetBrains Mono"', '600 1em "JetBrains Mono"'];
const fontsReady = Promise.race([
  Promise.all(FIRST_FACES.map((face) => document.fonts.load(face))),
  new Promise((resolve) => setTimeout(resolve, 1500)),
]);

const root = document.getElementById("root");
if (root) {
  void fontsReady.catch(() => undefined).then(() => createRoot(root).render(
    <StrictMode>
      <SessionProvider>
        <Shell>
          <Screen />
        </Shell>
      </SessionProvider>
    </StrictMode>,
  ));
}
