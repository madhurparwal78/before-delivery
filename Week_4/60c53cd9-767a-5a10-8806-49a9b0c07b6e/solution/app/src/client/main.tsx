/** Browser entry: providers, the header and the route table. */
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { AuthProvider, useAuth } from "./auth.js";
import { ChromeProvider, useChrome } from "./chrome.js";
import { ConsolePage } from "./ConsolePage.js";
import { Finder } from "./finder/Finder.js";
import { HoldPage } from "./HoldPage.js";
import { Landing } from "./Landing.js";
import { MyHoldsProvider, useMyHolds } from "./my-holds.js";
import { NoticesProvider } from "./notices.js";
import { Link, useAddress } from "./router.js";
import { SharedPage } from "./SharedPage.js";

const Header = (): ReactNode => {
  const { account, ready, openSignIn, signOut } = useAuth();
  const { active } = useMyHolds();
  const chrome = useChrome();
  return (
    <header className="site-header">
      <Link to="/" className="brand">
        Highwater
      </Link>
      <nav className="header-actions" aria-label="Account">
        {account?.role === "buyer" && active ? <Link to={`/holds/${active.id}`}>My hold</Link> : null}
        {chrome.filtersButton ? (
          <button type="button" className="button" onClick={() => chrome.setSheetOpen(!chrome.sheetOpen)}>
            Filters
          </button>
        ) : null}
        {ready ? (
          account ? (
            <button type="button" className="button" onClick={() => void signOut()}>
              Sign out
            </button>
          ) : (
            <button type="button" className="button" onClick={() => openSignIn({ title: "Sign in" })}>
              Sign in
            </button>
          )
        ) : null}
      </nav>
    </header>
  );
};

const Routes = (): ReactNode => {
  const address = useAddress();
  const path = address.split("?")[0] ?? "/";
  if (path === "/finder") return <Finder />;
  if (path === "/console") return <ConsolePage />;
  const hold = /^\/holds\/([^/]+)$/.exec(path);
  if (hold) return <HoldPage id={decodeURIComponent(hold[1] as string)} />;
  return <Landing />;
};

const Root = (): ReactNode => {
  const address = useAddress();
  const path = address.split("?")[0] ?? "/";
  const shared = /^\/shared\/([^/]+)$/.exec(path);
  if (shared) {
    return (
      <NoticesProvider>
        <SharedPage token={decodeURIComponent(shared[1] as string)} />
      </NoticesProvider>
    );
  }
  return (
    <NoticesProvider>
      <AuthProvider>
        <MyHoldsProvider>
          <ChromeProvider>
            <Header />
            <Routes />
          </ChromeProvider>
        </MyHoldsProvider>
      </AuthProvider>
    </NoticesProvider>
  );
};

/** The three faces are preloaded; the first render waits for them (at most 2.5 s) so that no text re-flows when they arrive. */
const FACES = ['900 1em "Red Hat Display"', '400 1em "Red Hat Text"', '700 1em "Red Hat Text"'];
const fontsReady = Promise.race([
  Promise.all(FACES.map((face) => document.fonts.load(face))).catch(() => undefined),
  new Promise((resolve) => window.setTimeout(resolve, 2500)),
]);

void fontsReady.then(() => {
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
});
