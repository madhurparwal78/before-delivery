import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "../shared/api";
import { api, rememberedSession, rememberSession, SESSION_ENDED, signOut } from "./api";
import { Logbook } from "./logbook/Logbook";
import { Coach } from "./pages/Coach";
import { Cohorts } from "./pages/Cohorts";
import { Enroll } from "./pages/Enroll";
import { EnrollmentPage } from "./pages/Enrollment";
import { NotFound } from "./pages/NotFound";
import { SignIn } from "./pages/SignIn";
import { follow, navigate, useScreen, type Screen } from "./router";
import { MoonIcon } from "./ui/icons";
import "./styles.css";

function Header({ session, screen, onSignOut }: { session: Session | null; screen: Screen; onSignOut: () => void }) {
  return (
    <header className="header">
      <a className="wordmark" href="/" onClick={follow}>
        <MoonIcon size={22} />
        Lanternfish
      </a>
      {session ? (
        <div className="header-person">
          <span className="header-name">{session.name}</span>
          <button type="button" className="button quiet" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      ) : screen.name !== "signin" ? (
        <a className="button quiet" href="/signin" onClick={follow}>
          Sign in
        </a>
      ) : null}
    </header>
  );
}

/** Where the signed-in person lands for a requested `next`, as the server decides it; the Cohorts screen without an answer. */
async function landingFor(next: string | null): Promise<string> {
  try {
    const result = await api<{ landing: string }>("GET", `/api/landing?next=${encodeURIComponent(next ?? "")}`);
    if (result.status === 200) return result.data.landing;
  } catch {
    // No answer from the server: nowhere to decide the landing.
  }
  return "/";
}

function App() {
  const screen = useScreen();
  // undefined until the session is known; null when signed out.
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  const adopt = useCallback((next: Session | null) => {
    rememberSession(next);
    setSession(next);
  }, []);

  const loadSession = useCallback(async () => {
    try {
      const result = await api<Session>("GET", "/api/session");
      adopt(result.status === 200 ? { role: result.data.role, name: result.data.name, id: result.data.id } : null);
    } catch {
      // Offline: the session from the last successful answer, if nobody signed out since.
      setSession(rememberedSession());
    }
  }, [adopt]);
  useEffect(() => void loadSession(), [loadSession]);

  useEffect(() => {
    // Any request from a signed-in screen that answers 401 sends the browser back to sign-in; kept entries stay.
    const ended = () => {
      if (location.pathname !== "/logbook" && location.pathname !== "/coach") return;
      adopt(null);
      navigate(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    };
    window.addEventListener(SESSION_ENDED, ended);
    return () => window.removeEventListener(SESSION_ENDED, ended);
  }, [adopt]);

  useEffect(() => {
    if (session === undefined) return;
    const guarded = screen.name === "logbook" || screen.name === "coach";
    if (guarded && session === null) {
      navigate(`/signin?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    } else if (guarded && session && (screen.name === "logbook") !== (session.role === "dreamer")) {
      // The other role's screen: the server's landing for no `next` is the person's own screen.
      void landingFor(null).then((path) => navigate(path, { replace: true }));
    } else if (screen.name === "signin" && session) {
      void landingFor(screen.next).then((path) => navigate(path, { replace: true }));
    }
  }, [session, screen]);

  const onSignOut = async () => {
    adopt(null);
    navigate("/signin");
    await signOut();
  };

  const onSignedIn = (signedIn: Session) => {
    rememberSession(signedIn);
    setSession(signedIn);
  };

  let body = null;
  if (screen.name === "cohorts") body = <Cohorts />;
  if (screen.name === "enroll") body = <Enroll cohortId={screen.cohortId} />;
  if (screen.name === "enrollment") body = <EnrollmentPage enrollmentId={screen.enrollmentId} onSignedIn={onSignedIn} />;
  if (screen.name === "signin" && session === null) body = <SignIn onSignedIn={onSignedIn} />;
  if (screen.name === "logbook" && session?.role === "dreamer") body = <Logbook owner={session.id} />;
  if (screen.name === "coach" && session?.role === "coach") body = <Coach selectedId={screen.cohortId} />;
  if (screen.name === "not-found") body = <NotFound />;

  return (
    <>
      <Header session={session ?? null} screen={screen} onSignOut={() => void onSignOut()} />
      {body}
    </>
  );
}

// The self-hosted faces load before the first render, so text never reflows under a pointer or a reader.
const FACES = ['400 1em "Atkinson Hyperlegible"', '400 1em "Fraunces"', '500 1em "Fraunces"'];

const root = document.getElementById("root");
if (root) {
  void Promise.allSettled(FACES.map((face) => document.fonts.load(face))).then(() =>
    createRoot(root).render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
}
