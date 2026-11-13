// The browser app: account pages for visitors, the shell for signed-in players.
import { options, render } from "preact";
import { useEffect } from "preact/hooks";
import { ForgotPage, ResetPage, SigninPage, SignupPage, VerifyPage } from "./account.js";
import { Notices } from "./notices.js";
import { redirect, route, type Route } from "./router.js";
import { Shell } from "./shell.js";
import { connect } from "./socket.js";
import { loadMe, me, refreshFriends, refreshParty } from "./state.js";
import { useStore } from "./store.js";

// Effects run right after each commit instead of waiting for the next painted frame.
options.requestAnimationFrame = (flush: () => void) => {
  void Promise.resolve().then(flush);
};

const ACCOUNT_PAGES = new Set<Route["page"]>(["signup", "signin", "forgot", "reset", "verify"]);
function startLive(verified: boolean): void {
  connect();
  if (verified) {
    void refreshFriends().catch(() => undefined);
    void refreshParty().catch(() => undefined);
  }
}

function AccountPage({ current }: { current: Route }) {
  if (current.page === "signup") return <SignupPage />;
  if (current.page === "forgot") return <ForgotPage />;
  if (current.page === "reset") return <ResetPage token={current.token} />;
  if (current.page === "verify") return <VerifyPage token={current.token} />;
  return <SigninPage />;
}

function App() {
  const current = useStore(route);
  const self = useStore(me);
  const account = ACCOUNT_PAGES.has(current.page);
  useEffect(() => {
    if (account || self !== undefined) return;
    void loadMe().then((user) => { if (user === null) redirect("/signin"); }).catch(() => undefined);
  }, [account, self]);
  useEffect(() => {
    if (account) return;
    if (self === null) redirect("/signin");
    else if (self !== undefined) startLive(self.emailVerified);
  }, [account, self?.id, self?.emailVerified]);
  useEffect(() => {
    document.title = account ? "Pratfall Cup" : "Pratfall Cup — Wobblewell Arcade";
  }, [account]);
  return (
    <>
      {account ? <AccountPage current={current} /> : <Shell current={current} />}
      <Notices />
    </>
  );
}

// App routes open the live connection while the page boots, alongside loading the session.
if (!ACCOUNT_PAGES.has(route.get().page)) connect();

const root = document.getElementById("app");
if (root !== null) render(<App />, root);
