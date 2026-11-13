import { useEffect, useState } from "react";
import type { Agency, SessionUser } from "../shared/api";
import { Header } from "./components/Header";
import { BillingHome } from "./roles/BillingHome";
import { CoordinatorHome } from "./roles/CoordinatorHome";
import { DeepLink } from "./roles/DeepLink";
import { InterpreterHome } from "./roles/InterpreterHome";
import { RequesterHome } from "./roles/RequesterHome";
import { SignIn } from "./roles/SignIn";
import { SessionEndedDialog } from "./dialogs/SessionEndedDialog";
import { useSessionEnded } from "./lib/session";
import { ApiFailure, apiGet } from "./lib/api";
import { announceError } from "./lib/live";
import { NETWORK_COPY } from "./lib/copy";
import { forgetRunningActions } from "./lib/refresh";
import { useAddress } from "./lib/router";

type Session = { state: "loading" } | { state: "signed-out"; unreachable?: boolean } | { state: "signed-in"; user: SessionUser; agency: Agency };

/** Every face the first screen draws. The first render waits for them so text never rewraps (and shifts the page) on a late swap. */
const FACES = ['900 1em "Archivo"', '400 1em "IBM Plex Sans"', '600 1em "IBM Plex Sans"', '400 1em "IBM Plex Mono"', '500 1em "IBM Plex Mono"'];
const FONT_WAIT_MS = 2500;

function fontsReady(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return Promise.resolve();
  const loads = Promise.all(FACES.map((face) => document.fonts.load(face).catch(() => []))).then(() => undefined);
  return Promise.race([loads, new Promise<void>((resolve) => setTimeout(resolve, FONT_WAIT_MS))]);
}

async function loadSession(): Promise<Session> {
  try {
    const user = await apiGet<SessionUser>("/api/me");
    return { state: "signed-in", user, agency: await apiGet<Agency>("/api/agency") };
  } catch (failure) {
    if (failure instanceof ApiFailure && failure.status === 401) return { state: "signed-out" };
    return { state: "signed-out", unreachable: true };
  }
}

export function App() {
  const [session, setSession] = useState<Session>({ state: "loading" });
  const { place, cause, go } = useAddress();

  const sessionEnded = useSessionEnded();

  useEffect(() => {
    void Promise.all([loadSession(), fontsReady()]).then(([loaded]) => setSession(loaded));
  }, []);

  // Announced once the page is drawn: the message strip is hidden while nothing else is on screen.
  const unreachable = session.state === "signed-out" && session.unreachable === true;
  useEffect(() => {
    if (unreachable) announceError(NETWORK_COPY);
  }, [unreachable]);

  const signOut = () => {
    forgetRunningActions();
    go("/", "replace");
    setSession({ state: "signed-out" });
  };

  if (session.state === "loading") return null;
  if (session.state === "signed-out") {
    return (
      <SignIn
        onSignedIn={(user) => {
          go("/", "replace");
          void apiGet<Agency>("/api/agency").then((agency) => setSession({ state: "signed-in", user, agency }));
        }}
      />
    );
  }

  const { user, agency } = session;
  const deep = /^\/bookings\/(\d{1,9})$/.exec(place.pathname);
  return (
    <>
      <Header
        user={user}
        agency={agency}
        onNavigate={(to) => go(to, "push")}
        onSignedOut={signOut}
      />
      {deep ? (
        <DeepLink key={deep[1]} id={deep[1] ?? ""} user={user} />
      ) : user.role === "coordinator" ? (
        <CoordinatorHome user={user} agency={agency} place={place} cause={cause} go={go} />
      ) : user.role === "requester" ? (
        <RequesterHome user={user} agency={agency} />
      ) : user.role === "interpreter" ? (
        <InterpreterHome user={user} agency={agency} />
      ) : (
        <BillingHome agency={agency} />
      )}
      {sessionEnded ? <SessionEndedDialog user={user} onSignedOut={signOut} /> : null}
    </>
  );
}
