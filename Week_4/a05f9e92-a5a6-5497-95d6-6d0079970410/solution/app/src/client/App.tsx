import { useEffect } from "react";
import { judgeScreen } from "../shared/screens.js";
import { Shell } from "./components/Shell.js";
import { AnnouncerProvider } from "./lib/announce.js";
import { matchRoute, navigate, useLocation, type RouteDef } from "./lib/router.js";
import { SessionProvider, useSession, type Loaded } from "./lib/session.js";
import { StateScreen } from "./lib/ui.js";
import { Landing } from "./screens/Landing.js";
import { Login } from "./screens/Login.js";
import { NotFound } from "./screens/NotFound.js";
import { screens } from "./screens/index.js";

const ROUTES: RouteDef[] = [
  { pattern: "/", render: () => <Landing /> },
  { pattern: "/login", render: () => <Login /> },
  ...screens,
];

function Redirect({ to }: { to: string }): JSX.Element {
  useEffect(() => navigate(to, true), [to]);
  return <StateScreen line="Loading Switchyard..." button="Cancel" onClick={() => history.back()} />;
}

function Routes(): JSX.Element {
  const { path } = useLocation();
  const session = useSession();
  if (session.status === "loading") return <StateScreen line="Loading Switchyard..." button="Cancel" onClick={() => history.back()} />;
  const verdict = judgeScreen(path, session.user ? session.user.roles : null);
  if (verdict === "login") return <Redirect to="/login" />;
  if (verdict === "missing") return <NotFound />;
  const found = matchRoute(path, ROUTES);
  return found ? found.route.render(found.params) : <NotFound />;
}

export function App({ initial }: { initial?: Loaded | null }): JSX.Element {
  return (
    <AnnouncerProvider>
      <SessionProvider initial={initial}>
        <Shell>
          <Routes />
        </Shell>
      </SessionProvider>
    </AnnouncerProvider>
  );
}
