// Lacquer in the browser: the signed-in user, the routes of the brief and the shared-address rules.
import { StrictMode, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Me } from "../shared/api.js";
import { signInAddress } from "../shared/returnAddress.js";
import { bindSession, get } from "./api.js";
import { Bays } from "./pages/Bays.js";
import { Board } from "./pages/Board.js";
import { CarPage } from "./pages/CarPage.js";
import { CareRound } from "./pages/CareRound.js";
import { JobPage } from "./pages/JobPage.js";
import { Jobs } from "./pages/Jobs.js";
import { MyCars, PortalCar } from "./pages/PortalCars.js";
import { PortalInvoice } from "./pages/PortalInvoice.js";
import { PortalRelease, RequestRelease } from "./pages/PortalReleases.js";
import { Releases } from "./pages/Releases.js";
import { SignIn } from "./pages/SignIn.js";
import { StaffAccess } from "./pages/StaffAccess.js";
import { navigate, sharedAddressRedirect, useLocation } from "./router.js";
import { SessionContext, useSignInAgain } from "./session.js";
import { Shell } from "./Shell.js";
import { NotFound } from "./ui/NotFound.js";
import "./styles.css";

function route(path: string): JSX.Element {
  const match = (pattern: RegExp): string | null => pattern.exec(path)?.[1] ?? null;
  let id: string | null;
  if (path === "/bays") return <Bays />;
  if ((id = match(/^\/cars\/([^/]+)$/))) return <CarPage key={id} carId={id} />;
  if (path === "/round") return <CareRound />;
  if (path === "/jobs") return <Jobs />;
  if ((id = match(/^\/jobs\/([^/]+)$/))) return <JobPage key={id} jobId={id} portal={false} />;
  if (path === "/releases") return <Releases />;
  if (path === "/board") return <Board />;
  if (path === "/staff") return <StaffAccess />;
  if (path === "/portal") return <MyCars />;
  if ((id = match(/^\/portal\/cars\/([^/]+)\/release$/))) return <RequestRelease key={id} carId={id} />;
  if ((id = match(/^\/portal\/cars\/([^/]+)$/))) return <PortalCar key={id} carId={id} />;
  if ((id = match(/^\/portal\/jobs\/([^/]+)$/))) return <JobPage key={id} jobId={id} portal />;
  if ((id = match(/^\/portal\/invoices\/([^/]+)$/))) return <PortalInvoice key={id} invoiceId={id} />;
  if ((id = match(/^\/portal\/releases\/([^/]+)$/))) return <PortalRelease key={id} releaseId={id} />;
  return <NotFound />;
}

/** The signed-in user the server put in the page, so the first screen renders without a round trip. */
function sessionInPage(): Me | null {
  const text = document.getElementById("lacquer-session")?.textContent ?? "null";
  return JSON.parse(text) as Me | null;
}

function App(): JSX.Element | null {
  const location = useLocation();
  const [me, setMe] = useState<Me | null>(() => (window.location.pathname === "/sign-in" ? null : sessionInPage()));
  const meRef = useRef<Me | null>(null);
  meRef.current = me;
  const signInAgain = useSignInAgain(() => meRef.current?.user.email ?? "");
  const onSignIn = location.path === "/sign-in";

  useEffect(() => {
    bindSession({
      expired: signInAgain.request,
      ended: (code, firstLoad) => {
        setMe(null);
        const here = `${window.location.pathname}${window.location.search}`;
        const state = code === "access_revoked" ? { revoked: true } : {};
        navigate(firstLoad ? signInAddress(here) : "/sign-in", { replace: firstLoad, state });
      },
    });
  });

  useEffect(() => {
    if (onSignIn || me) return;
    get<Me>("/api/me", true).then(setMe, () => undefined);
  }, [onSignIn, me]);

  const redirect = me && !onSignIn ? sharedAddressRedirect(me.user.role, location.path, location.search) : null;
  useEffect(() => {
    if (redirect) navigate(redirect, { replace: true });
  }, [redirect]);

  if (onSignIn) {
    return (
      <SignIn
        key={`${location.search}${location.state.revoked ? "revoked" : ""}`}
        revoked={location.state.revoked === true}
        onSignedIn={async (target) => {
          setMe(await get<Me>("/api/me"));
          navigate(target);
        }}
      />
    );
  }
  if (!me || redirect) return null;
  return (
    <SessionContext.Provider value={{ user: me.user, units: me.units, setUnits: (units) => setMe({ ...me, units }) }}>
      <Shell>{route(location.path)}</Shell>
      {signInAgain.dialog}
    </SessionContext.Provider>
  );
}

const root = document.getElementById("root");
if (root) {
  const app = createRoot(root);
  flushSync(() =>
    app.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  );
}
