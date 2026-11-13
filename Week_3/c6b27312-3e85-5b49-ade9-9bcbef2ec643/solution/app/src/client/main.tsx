import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { SignInPage, SignUpPage } from "./AuthPages";
import { ComparePage } from "./ComparePage";
import { DashboardPage } from "./DashboardPage";
import { Home } from "./Home";
import { PartPage } from "./PartPage";
import { PublishPage } from "./PublishPage";
import { RoomPage } from "./RoomPage";
import { useLocation } from "./router";
import { SessionProvider, useSession } from "./session";
import { NotFound, Shell } from "./shell";
import { TapePage } from "./TapePage";

function Routes() {
  const { pathname } = useLocation();
  const { ready } = useSession();
  const parts = pathname.split("/").filter(Boolean);
  let page = <NotFound />;
  if (parts.length === 0) page = <Home />;
  else if (parts[0] === "parts" && parts[1] === "new" && parts.length === 2) page = <PublishPage />;
  else if (parts[0] === "parts" && parts.length === 2) page = <PartPage slug={parts[1] as string} />;
  else if (parts[0] === "parts" && parts[2] === "compare" && parts.length === 3) page = <ComparePage slug={parts[1] as string} />;
  else if (parts[0] === "tapes" && parts.length === 2) page = <TapePage revisionId={parts[1] as string} />;
  else if (parts[0] === "rooms" && parts.length === 2) page = <RoomPage roomId={parts[1] as string} />;
  else if (parts[0] === "dashboard" && parts.length === 1) page = <DashboardPage />;
  else if (parts[0] === "signin" && parts.length === 1) page = <SignInPage />;
  else if (parts[0] === "signup" && parts.length === 1) page = <SignUpPage />;
  return <Shell bare={parts.length === 0}>{ready || parts.length === 0 ? page : <div className="loading-page" aria-busy="true" />}</Shell>;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <SessionProvider>
      <Routes />
    </SessionProvider>
  </StrictMode>,
);
