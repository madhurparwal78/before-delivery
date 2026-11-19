// Sign-in gate and screen routing (brief: Screens and layout).
import { useEffect } from "react";
import { api, ApiError, whenSignedOut } from "./api";
import { loadStatus, refreshFolders, refreshStorage, session, wireEvents } from "./data";
import { useStore } from "./store";
import { navigate, useLocation } from "./router";
import { startLive, stopLive, events } from "./live";
import { restore, startUploads } from "./uploads/manager";
import { SignIn } from "./screens/SignIn";
import { Frame } from "./shell/Frame";
import { Browser } from "./drive/Browser";
import { BinScreen } from "./screens/Bin";
import { HandoversScreen } from "./screens/Handovers";
import { SettingsScreen } from "./screens/Settings";
import type { Person } from "../shared/api";

wireEvents();
startUploads();

function signInAddress(): string {
  const here = location.pathname + location.search;
  return here === "/" || here.startsWith("/sign-in") ? "/sign-in" : `/sign-in?next=${encodeURIComponent(here)}`;
}

whenSignedOut(() => {
  if (session.get() === null) return;
  stopLive();
  session.set(null);
  navigate(signInAddress(), { replace: true });
});

events.on("signedOut", () => {
  stopLive();
  session.set(null);
  navigate("/sign-in", { replace: true });
});

export function enterApp(person: Person): void {
  session.set(person);
  startLive();
  void loadStatus();
  void refreshFolders();
  void refreshStorage();
  void restore();
}

export function App() {
  const me = useStore(session);
  const url = useLocation();

  useEffect(() => {
    void loadStatus();
    api<{ person: Person }>("GET", "/api/session").then((body) => enterApp(body.person), (failure: unknown) => {
      if (failure instanceof ApiError) session.set(null);
    });
  }, []);

  useEffect(() => {
    if (me === undefined) return;
    if (me === null && url.pathname !== "/sign-in") navigate(signInAddress(), { replace: true });
    if (me && (url.pathname === "/sign-in" || url.pathname === "/")) {
      const next = url.searchParams.get("next");
      navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : me.kind === "staff" ? "/drive" : "/shared", { replace: true });
    }
    if (me && me.kind !== "staff" && ["/bin", "/handovers", "/settings"].includes(url.pathname)) navigate("/shared", { replace: true });
    if (me && me.staffRole !== "admin" && url.pathname === "/settings") navigate("/drive", { replace: true });
  }, [me, url.pathname, url.search]);

  if (me === undefined) return <div className="booting" aria-busy="true" />;
  if (me === null) return url.pathname === "/sign-in" ? <SignIn /> : <div className="booting" aria-busy="true" />;

  const path = url.pathname;
  return (
    <Frame>
      {path === "/recent" ? <Browser screen="recent" />
        : path === "/shared" ? <Browser screen="shared" />
        : path === "/bin" ? <BinScreen />
        : path === "/handovers" ? <HandoversScreen />
        : path === "/settings" ? <SettingsScreen />
        : <Browser screen="drive" />}
    </Frame>
  );
}
