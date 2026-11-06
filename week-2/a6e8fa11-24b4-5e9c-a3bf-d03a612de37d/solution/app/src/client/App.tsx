// Routes, the signed-out redirect and the shell around signed-in screens.
import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { COPY } from "./copy.js";
import { match, navigate, usePath } from "./router.js";
import { InviteAccept } from "./screens/InviteAccept.js";
import { ShareView } from "./screens/ShareView.js";
import { SignIn } from "./screens/SignIn.js";
import { StationSettings } from "./screens/StationSettings.js";
import { WorkbookList } from "./screens/WorkbookList.js";
import { SessionContext } from "./session.js";
import { ServiceBanner, TopBar } from "./TopBar.js";
import { type User } from "./types.js";
import { NoticesRegion } from "./ui/notices.js";
import { WorkbookScreen } from "./workbook/WorkbookScreen.js";

export function NotFound(): JSX.Element {
  return (
    <main className="page page-center">
      <section className="card card-narrow">
        <h1>{COPY.notFoundHeading}</h1>
        <p>{COPY.notFoundLine}</p>
      </section>
    </main>
  );
}

export function App(): JSX.Element {
  const path = usePath();
  const route = match(path);
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api
      .get<{ user: User }>("/api/session")
      .then((r) => setUser(r.user))
      .catch(() => setUser(null));
  }, []);

  const open = route.screen === "signin" || route.screen === "invite" || route.screen === "share";
  useEffect(() => {
    if (user === null && !open) navigate("/signin", true);
    if (user && route.screen === "signin") navigate("/", true);
  }, [user, open, route.screen]);

  const session = useMemo(() => (user ? { user, setUser } : null), [user]);

  let body: JSX.Element | null = null;
  if (route.screen === "share") body = <ShareView token={route.token} />;
  else if (route.screen === "invite") body = <InviteAccept token={route.token} onAccepted={setUser} />;
  else if (route.screen === "signin") body = user === null ? <SignIn onSignedIn={setUser} /> : null;
  else if (session) {
    let screen: JSX.Element;
    if (route.screen === "list") screen = <WorkbookList />;
    else if (route.screen === "workbook") screen = <WorkbookScreen key={route.id} id={route.id} />;
    else if (route.screen === "station" && session.user.role === "data_manager") screen = <StationSettings />;
    else screen = <NotFound />;
    body = (
      <SessionContext.Provider value={session}>
        <div className="shell">
          <TopBar />
          <ServiceBanner />
          {screen}
        </div>
      </SessionContext.Provider>
    );
  }
  return (
    <>
      {body}
      <NoticesRegion />
    </>
  );
}
