import { useLayoutEffect } from "preact/hooks";
import { Home } from "./home/Home";
import { navigate, useRoute } from "./lib/router";
import { homeFor, useAuth } from "./lib/session";
import { Slide } from "./lib/Slide";
import { Editor } from "./screens/Editor";
import { Notice } from "./screens/Notice";
import { SignIn } from "./screens/SignIn";
import { Stockist } from "./screens/Stockist";

const threading = <main><Slide line="REEL CHANGE" sentence="One moment while the next reel is threaded." /></main>;

/** Sign-in and the two signed-in screens: each visitor only ever sees their own. */
function Desk({ screen }: { screen: "sign-in" | "stockist" | "editor" }) {
  const auth = useAuth();
  const target = auth.status === "loading" ? `/${screen}` : auth.status === "out" ? "/sign-in" : homeFor(auth.session);
  const here = `/${screen}`;
  useLayoutEffect(() => {
    if (auth.status !== "loading" && target !== here) navigate(target, { replace: true });
  }, [target, here, auth.status]);
  // the server already sent a signed-in visitor away from /sign-in, so the form never waits for the session read
  if (screen === "sign-in" && target === here) return <SignIn />;
  if (auth.status === "loading" || target !== here) return threading;
  if (auth.status !== "in") return threading;
  return screen === "editor" ? <Editor key={auth.session.accountId} session={auth.session} /> : <Stockist key={auth.session.accountId} session={auth.session} />;
}

export function App() {
  const route = useRoute();
  switch (route.name) {
    case "home":
      return <Home />;
    case "notice":
      return <Notice key={route.number} number={route.number} />;
    case "sign-in":
    case "stockist":
    case "editor":
      return <Desk screen={route.name} />;
    default:
      return <main><Slide line="REEL MISSING" sentence="This page isn't in the programme." /></main>;
  }
}
