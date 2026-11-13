import type { JSX } from "preact";
import { render } from "preact";
import { useLayoutEffect } from "preact/hooks";
import { Shell } from "./components/Shell";
import { loadMe, useMe } from "./me";
import { Daily } from "./pages/Daily";
import { Duel } from "./pages/Duel";
import { Home } from "./pages/Home";
import { Leaderboard } from "./pages/Leaderboard";
import { NotFound, Voice } from "./pages/NotFound";
import { Play } from "./pages/Play";
import { Profile } from "./pages/Profile";
import { ResetConfirm, ResetRequest, SignIn, SignUp, Verify } from "./pages/Account";
import { Room } from "./pages/Room";
import { navigate, useLocation } from "./router";
import "./styles.css";

interface Page {
  pattern: RegExp;
  signedIn: boolean;
  render: (params: string[]) => JSX.Element;
}

const first = (params: string[]): string => params[0] ?? "";

const PAGES: Page[] = [
  { pattern: /^\/$/, signedIn: false, render: () => <Home /> },
  { pattern: /^\/signin$/, signedIn: false, render: () => <SignIn /> },
  { pattern: /^\/signup$/, signedIn: false, render: () => <SignUp /> },
  { pattern: /^\/verify\/([^/]+)$/, signedIn: false, render: (params) => <Verify token={first(params)} /> },
  { pattern: /^\/reset$/, signedIn: false, render: () => <ResetRequest /> },
  { pattern: /^\/reset\/([^/]+)$/, signedIn: false, render: (params) => <ResetConfirm token={first(params)} /> },
  { pattern: /^\/daily$/, signedIn: true, render: () => <Daily /> },
  { pattern: /^\/leaderboard$/, signedIn: true, render: () => <Leaderboard /> },
  { pattern: /^\/leaderboard\/(\d{4}-\d{2}-\d{2})$/, signedIn: true, render: (params) => <Leaderboard key={first(params)} date={first(params)} /> },
  { pattern: /^\/duel$/, signedIn: true, render: () => <Duel /> },
  { pattern: /^\/duel\/([A-Za-z0-9]+)$/, signedIn: true, render: (params) => <Room code={first(params).toUpperCase()} /> },
  { pattern: /^\/profile$/, signedIn: true, render: () => <Profile /> },
  { pattern: /^\/play\/([^/]+)$/, signedIn: true, render: (params) => <Play key={first(params)} id={first(params)} /> },
];

function App(): JSX.Element {
  const me = useMe();
  const { path, search } = useLocation();
  const matched = PAGES.map((page) => ({ page, params: page.pattern.exec(path) })).find((entry) => entry.params !== null);
  const needsSignIn = matched?.page.signedIn === true && me === null;

  useLayoutEffect(() => {
    if (needsSignIn) navigate(`/signin?next=${encodeURIComponent(path + search.toString().replace(/^(?=.)/, "?"))}`, true);
  }, [needsSignIn, path]);

  if (!matched?.params) {
    return (
      <Shell navigation="top">
        <NotFound />
      </Shell>
    );
  }
  const waiting = matched.page.signedIn && me === undefined;
  return (
    <Shell navigation={path === "/" ? "bottom" : "top"}>
      {waiting || needsSignIn ? <Voice sentence="The atelier is preparing your page." /> : matched.page.render(matched.params.slice(1))}
    </Shell>
  );
}

void loadMe().catch(() => undefined);
const root = document.getElementById("app");
if (root) render(<App />, root);
