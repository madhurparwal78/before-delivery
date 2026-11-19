import { useEffect, useState } from "react";
import { loadConfig } from "./api";
import { startLive, stopLive } from "./live";
import { useAddress } from "./router";
import { refreshSession, session } from "./session";
import { useStore } from "./store";
import { InfoStrip } from "./ui/InfoStrip";
import { Screen } from "./ui/Screen";
import { Invite, SignIn, SignUp, Verify } from "./pages/Account";
import { History } from "./pages/History";
import { Import } from "./pages/Import";
import { Library } from "./pages/Library";
import { SnapshotPage } from "./pages/Snapshot";
import { TeamSettings } from "./pages/Team";
import { Workbench } from "./workbench/Workbench";

function Route({ path }: { path: string }) {
  const parts = path.split("/").filter(Boolean);
  const [first, second] = parts;
  if (parts.length === 0 || (first === "w" && parts.length === 1)) return <Workbench />;
  if (first === "library" && parts.length === 1) return <Library />;
  if (first === "library" && second && parts.length === 2) return <History recipeId={second} />;
  if (first === "import" && parts.length === 1) return <Import />;
  if (first === "team" && parts.length === 1) return <TeamSettings />;
  if (first === "signup" && parts.length === 1) return <SignUp />;
  if (first === "signin" && parts.length === 1) return <SignIn />;
  if (first === "verify" && second && parts.length === 2) return <Verify token={second} />;
  if (first === "invite" && second && parts.length === 2) return <Invite token={second} />;
  if (first === "s" && second && parts.length === 2) return <SnapshotPage token={second} />;
  return (
    <Screen label="Not found" title="Not found" narrow>
      <p className="empty">There is nothing at this address.</p>
    </Screen>
  );
}

export function App() {
  const address = useAddress();
  const [started, setStarted] = useState(false);
  const user = useStore(session, (state) => state.user);

  useEffect(() => {
    void Promise.all([loadConfig(), refreshSession()]).then(() => setStarted(true));
  }, []);

  useEffect(() => {
    if (!started) return;
    if (user) startLive();
    else stopLive();
  }, [started, user?.id]);

  return (
    <div className="app">
      <InfoStrip />
      {started ? <Route path={address.split("?")[0] as string} /> : <main className="screen" aria-busy="true" />}
    </div>
  );
}
