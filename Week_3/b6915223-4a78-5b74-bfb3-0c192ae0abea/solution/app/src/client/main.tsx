import { options, render } from "preact";
import { useEffect } from "preact/hooks";
import type { Account } from "../shared/api.ts";
import { request } from "./api.ts";
import { Header } from "./components/Header.tsx";
import { connectLive, useLive } from "./live.ts";
import { HistoryPage } from "./pages/History.tsx";
import { LeaguePage } from "./pages/League.tsx";
import { LeaguesPage } from "./pages/Leagues.tsx";
import { MemberHistoryPage } from "./pages/MemberHistory.tsx";
import { OperatorPage } from "./pages/Operator.tsx";
import { SignInPage } from "./pages/SignIn.tsx";
import { TeamPage } from "./pages/Team.tsx";
import { TransfersPage } from "./pages/Transfers.tsx";
import { navigate, useLocation } from "./router.ts";
import { refreshGameweek, refreshNotices, setState, useApp } from "./store.ts";
import "./styles.css";

// Effects flush on the next task rather than the next animation frame, so data loading and
// redirects never wait on frame timing (a background tab can go without frames for a long time).
const effects = new MessageChannel();
const pending: (() => void)[] = [];
effects.port1.onmessage = () => {
  for (const run of pending.splice(0)) run();
};
options.requestAnimationFrame = (run) => {
  pending.push(run);
  effects.port2.postMessage(0);
};

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, true), [to]);
  return null;
}

function Routes() {
  const { me } = useApp();
  const { path } = useLocation();
  if (path === "/signin") return me ? <Redirect to={me.role === "operator" ? "/operator" : "/team"} /> : <SignInPage />;
  if (!me) return <Redirect to="/signin" />;
  const home = me.role === "operator" ? "/operator" : "/team";
  if (path === "/") return <Redirect to={home} />;
  if (me.role === "operator") return path === "/operator" ? <OperatorPage /> : <Redirect to="/operator" />;
  if (path === "/team") return <TeamPage />;
  if (path === "/transfers") return <TransfersPage />;
  if (path === "/leagues") return <LeaguesPage />;
  if (path === "/history") return <HistoryPage />;
  const member = /^\/leagues\/(\d+)\/members\/([A-Za-z0-9]+)$/.exec(path);
  if (member) return <MemberHistoryPage key={path} leagueId={member[1]!} managerId={member[2]!} />;
  const league = /^\/leagues\/(\d+)$/.exec(path);
  if (league) return <LeaguePage key={path} leagueId={league[1]!} />;
  return <Redirect to={home} />;
}

function App() {
  const { ready } = useApp();
  useEffect(() => {
    void (async () => {
      const me = await request<Account>("GET", "/api/me");
      setState({ me: me.ok ? me.data : null, ready: true });
      if (me.ok) {
        connectLive();
        void refreshGameweek();
        void refreshNotices();
      }
    })();
  }, []);
  useLive((message) => {
    if (message.t === "gameweek") void refreshGameweek();
  });
  // Nothing paints until the account is known, so the header never changes shape under the page.
  if (!ready) return null;
  return (
    <>
      <a class="sr-only" href="#content">
        Skip to content
      </a>
      <Header />
      <div id="content">
        <Routes />
      </div>
    </>
  );
}

render(<App />, document.getElementById("app")!);
