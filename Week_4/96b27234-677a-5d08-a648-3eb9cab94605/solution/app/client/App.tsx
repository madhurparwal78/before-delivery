import { useEffect, type ReactElement } from "react";
import { Confirm, Home, SignIn, SignUp } from "./pages/Public";
import { Communities, Community } from "./pages/Communities";
import { Friends, Invite } from "./pages/Friends";
import { Gathering } from "./pages/Gathering";
import { Moderation } from "./pages/Moderation";
import { NotFound } from "./pages/NotFound";
import { SessionPage } from "./pages/SessionPage";
import { Sessions } from "./pages/Sessions";
import { Studio } from "./pages/Studio";
import { Loading } from "./ui/Bits";
import { PublicLayout, SignedInLayout } from "./ui/Layout";
import { navigate, useLocation } from "./lib/router";
import { account, loadAccount, useStore } from "./lib/store";

type Match = { page: "public" | "private"; render: (parts: string[]) => ReactElement } | null;

const PUBLIC: [RegExp, (parts: string[]) => ReactElement][] = [
  [/^\/$/, () => <Home />],
  [/^\/signin$/, () => <SignIn />],
  [/^\/signup$/, () => <SignUp />],
  [/^\/confirm\/([^/]+)$/, (parts) => <Confirm token={parts[0] ?? ""} />],
];

const PRIVATE: [RegExp, (parts: string[]) => ReactElement][] = [
  [/^\/sessions$/, () => <Sessions />],
  [/^\/sessions\/([^/]+)$/, (parts) => <SessionPage key={parts[0]} id={parts[0] ?? ""} />],
  [/^\/friends$/, () => <Friends />],
  [/^\/invites\/([^/]+)$/, (parts) => <Invite token={parts[0] ?? ""} />],
  [/^\/studio$/, () => <Studio />],
  [/^\/communities$/, () => <Communities />],
  [/^\/communities\/([^/]+)$/, (parts) => <Community key={parts[0]} id={parts[0] ?? ""} />],
  [/^\/gatherings\/([^/]+)$/, (parts) => <Gathering key={parts[0]} id={parts[0] ?? ""} />],
  [/^\/moderation$/, () => <Moderation />],
];

function match(pathname: string): Match {
  const clean = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  for (const [pattern, render] of PUBLIC) {
    const found = pattern.exec(clean);
    if (found) return { page: "public", render: () => render(found.slice(1).map(decodeURIComponent)) };
  }
  for (const [pattern, render] of PRIVATE) {
    const found = pattern.exec(clean);
    if (found) return { page: "private", render: () => render(found.slice(1).map(decodeURIComponent)) };
  }
  return null;
}

export function App() {
  const location = useLocation();
  const state = useStore(account);
  const pathname = location.split("?")[0] ?? "/";
  const found = match(pathname);
  useEffect(() => {
    void loadAccount();
  }, []);
  const signedIn = state.state === "in";
  const needsSignIn = found?.page === "private" && state.state === "out";
  useEffect(() => {
    if (needsSignIn) navigate(`/signin?next=${encodeURIComponent(location)}`, true);
    else if (pathname === "/" && signedIn) navigate("/sessions", true);
  }, [needsSignIn, signedIn, pathname, location]);

  if (!found) {
    return signedIn ? (
      <SignedInLayout>
        <NotFound />
      </SignedInLayout>
    ) : (
      <PublicLayout>
        <NotFound />
      </PublicLayout>
    );
  }
  if (found.page === "private") {
    if (state.state !== "in") {
      return (
        <PublicLayout>
          <Loading />
        </PublicLayout>
      );
    }
    return <SignedInLayout>{found.render([])}</SignedInLayout>;
  }
  if (pathname === "/" && signedIn) return null;
  return signedIn ? <SignedInLayout>{found.render([])}</SignedInLayout> : <PublicLayout>{found.render([])}</PublicLayout>;
}
