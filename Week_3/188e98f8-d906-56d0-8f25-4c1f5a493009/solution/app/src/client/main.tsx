import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { Archive } from "./Archive";
import { Captain } from "./Captain";
import { DisputesProvider } from "./disputes";
import { LeagueProvider, useLeague } from "./league";
import { Marker } from "./Marker";
import { MessagesProvider } from "./messages";
import { NotFound } from "./NotFound";
import { Public } from "./Public";
import { Quizmaster } from "./Quizmaster";
import { usePath } from "./router";
import { SessionProvider, useSession } from "./session";
import { SignIn } from "./SignIn";

/** How long the desk waits for its first data before it draws what it has (an unreachable server). */
const FIRST_DATA_MS = 1500;

/** The self-hosted faces every page draws with (styles.css @font-face). */
const FACES = ['400 1em "Atkinson Hyperlegible"', '700 1em "Atkinson Hyperlegible"', '700 1em "Fraunces Variable"'];

/**
 * The first paint waits for the session, the first league read and the webfonts, so the masthead, the
 * round strip and the desk draw once, at their final size, instead of shifting as each answer arrives or
 * as the fallback font (wider, so it wraps more at phone widths) swaps for the real one.
 */
function FirstData({ children }: { children: ReactNode }) {
  const { state } = useSession();
  const { rounds } = useLeague();
  const [gaveUp, setGaveUp] = useState(false);
  const [fontsIn, setFontsIn] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setGaveUp(true), FIRST_DATA_MS);
    const fonts = document.fonts;
    if (fonts === undefined) setFontsIn(true);
    else void Promise.all(FACES.map((face) => fonts.load(face))).finally(() => setFontsIn(true));
    return () => window.clearTimeout(timer);
  }, []);
  const ready = state.status !== "loading" && rounds !== null && fontsIn;
  return ready || gaveUp ? <>{children}</> : null;
}

function Screen() {
  switch (usePath()) {
    case "/":
      return <Public />;
    case "/sign-in":
      return <SignIn />;
    case "/captain":
      return <Captain />;
    case "/marker":
      return <Marker />;
    case "/quizmaster":
      return <Quizmaster />;
    case "/archive":
      return <Archive />;
    default:
      return <NotFound />;
  }
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <MessagesProvider>
    <SessionProvider>
      <LeagueProvider>
        <DisputesProvider>
          <FirstData>
            <Screen />
          </FirstData>
        </DisputesProvider>
      </LeagueProvider>
    </SessionProvider>
  </MessagesProvider>,
);
