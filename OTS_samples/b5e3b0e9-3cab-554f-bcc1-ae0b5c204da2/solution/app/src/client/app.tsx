import type { ComponentChildren } from "preact";
import { useLayoutEffect } from "preact/hooks";
import { api } from "./api.ts";
import { loadMe, meStore, useMe, useReducedMotion } from "./me.ts";
import { Link, navigate, useLocation } from "./router.tsx";
import { AerodromePage, AerodromesPage } from "./pages/aerodromes.tsx";
import { InvitePage, SignInPage, SignUpPage, VerifyPage } from "./pages/auth.tsx";
import { ClassPage } from "./pages/classpage.tsx";
import { DebriefPage } from "./pages/debrief.tsx";
import { Home } from "./pages/home.tsx";
import { Landing } from "./pages/landing.tsx";
import { RecordPage } from "./pages/record.tsx";
import { ScenarioPage } from "./pages/scenario.tsx";
import { SessionPage } from "./pages/session.tsx";
import { SettingsPage } from "./pages/settings.tsx";
import { Loading, NotFound } from "./pages/shared.tsx";

const NOTICE = "Training only. Fictional aerodromes. Not for real air traffic control.";

const isSessionPage = (path: string): boolean => /^\/sessions\/[^/]+$/.test(path);

function Footer({ withNav }: { withNav: boolean }) {
  const { me } = useMe();
  return (
    <footer class="site-footer" role="contentinfo">
      <p>{NOTICE}</p>
      {withNav && (
        <nav aria-label="Site">
          <Link href="/">Home</Link>
          {me && <Link href="/settings">Settings</Link>}
        </nav>
      )}
    </footer>
  );
}

function Header() {
  const { me } = useMe();
  const signOut = async (): Promise<void> => {
    await api("DELETE", "/api/session");
    meStore.set({ loaded: true, me: null });
    navigate("/");
  };
  return (
    <header class="site-header">
      <Link href="/" class="brand">
        Niner Hall Runup Bay
      </Link>
      <nav aria-label="Account">
        {me ? (
          <>
            <Link href="/settings">Settings</Link>
            <button type="button" onClick={() => void signOut()}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <Link href="/signin">Sign in</Link>
            <Link href="/signup">Sign up</Link>
          </>
        )}
      </nav>
    </header>
  );
}

/** A page that needs a signed-in user: anyone else is sent to sign in and returned here afterwards. */
function Private({ path, children }: { path: string; children: ComponentChildren }) {
  const { me } = useMe();
  useLayoutEffect(() => {
    if (!me) navigate(`/signin?next=${encodeURIComponent(path)}`, true);
  }, [me, path]);
  return me ? <>{children}</> : null;
}

function Routes({ path }: { path: string }) {
  const parts = path.split("/").filter((p) => p !== "");
  const [first, second, third] = parts;
  if (parts.length === 0) return <HomeOrLanding />;
  if (parts.length === 1) {
    if (first === "signup") return <SignUpPage />;
    if (first === "signin") return <SignInPage />;
    if (first === "verify") return <VerifyPage />;
    if (first === "aerodromes") return <Private path={path}><AerodromesPage /></Private>;
    if (first === "settings") return <Private path={path}><SettingsPage /></Private>;
  }
  if (parts.length === 2 && second !== undefined) {
    if (first === "invite") return <InvitePage token={second} />;
    if (first === "classes") return <Private path={path}><ClassPage id={second} /></Private>;
    if (first === "aerodromes") return <Private path={path}><AerodromePage id={second} /></Private>;
    if (first === "scenarios") return <Private path={path}><ScenarioPage key={second} id={second === "new" ? null : second} /></Private>;
    if (first === "sessions") return <Private path={path}><SessionPage id={second} /></Private>;
    if (first === "records") return <Private path={path}><RecordPage id={second} /></Private>;
  }
  if (parts.length === 3 && first === "sessions" && second !== undefined && third === "debrief") {
    return <Private path={path}><DebriefPage id={second} /></Private>;
  }
  return <NotFound />;
}

function HomeOrLanding() {
  const { me } = useMe();
  return me ? <Home /> : <Landing />;
}

export function App() {
  const { path } = useLocation();
  const { loaded } = useMe();
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    void loadMe();
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.reducedMotion = reduced ? "true" : "false";
  }, [reduced]);
  if (!loaded) return <Loading />;
  const landing = path === "/" && meStore.get().me === null;
  return (
    <div class="app">
      {!landing && !isSessionPage(path) && <Header />}
      {landing ? (
        <div class="main-landing">
          <Routes path={path} />
        </div>
      ) : (
        <main class="main">
          <Routes path={path} />
        </main>
      )}
      {!landing && <Footer withNav={isSessionPage(path)} />}
    </div>
  );
}
