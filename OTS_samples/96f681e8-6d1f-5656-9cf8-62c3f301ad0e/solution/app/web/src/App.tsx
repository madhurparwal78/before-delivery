import { type ReactElement, useEffect } from "react";
import { AnnouncerProvider } from "./announce";
import { currentPath } from "./draft";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { Home } from "./pages/Home";
import { Matches } from "./pages/Matches";
import { NotFound, WrongRole } from "./pages/NotFound";
import { Courts } from "./pages/Courts";
import { useLocation } from "./router";
import { SessionProvider, hasRole, useSession } from "./session";
import { Share } from "./pages/Share";
import { Me } from "./pages/Me";
import { Booking } from "./pages/Booking";
import { Desk } from "./pages/Desk";
import { Coach } from "./pages/Coach";
import { Manager } from "./pages/Manager";

function SignInRedirect() {
  useEffect(() => {
    window.location.replace(`/login?return=${encodeURIComponent(currentPath())}`);
  }, []);
  return <div className="page" aria-busy="true" />;
}

function Routes() {
  const { path } = useLocation();
  const session = useSession();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [path]);

  const memberPage = (role: string | null, page: ReactElement) => {
    if (session.state === "loading") return <div className="page" aria-busy="true" />;
    if (session.state === "signed-out") {
      return <SignInRedirect />;
    }
    if (role && !hasRole(session, role) && !(role === "desk" && hasRole(session, "manager"))) return <WrongRole />;
    return page;
  };

  if (path === "/") return <Home />;
  if (path === "/matches") return <Matches />;
  if (path === "/courts") return memberPage(null, <Courts />);
  if (path === "/me") return memberPage(null, <Me />);
  if (path.startsWith("/share/")) return memberPage(null, <Share token={decodeURIComponent(path.slice("/share/".length))} />);
  if (path.startsWith("/bookings/")) return memberPage(null, <Booking id={decodeURIComponent(path.slice("/bookings/".length))} />);
  if (path === "/desk") return memberPage("desk", <Desk />);
  if (path === "/coach") return memberPage("coach", <Coach />);
  if (path === "/manager") return memberPage("manager", <Manager />);
  return <NotFound />;
}

// The shell first paints once the session is known, so the header and its role links never move under the reader.
function Shell() {
  const session = useSession();
  if (session.state === "loading") return null;
  return (
    <AnnouncerProvider>
      <Header />
      <main id="main">
        <Routes />
      </main>
      <Footer />
    </AnnouncerProvider>
  );
}

export function App() {
  return (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  );
}
