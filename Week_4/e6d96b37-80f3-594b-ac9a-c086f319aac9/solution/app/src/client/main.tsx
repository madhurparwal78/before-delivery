// Flan desk entry: routes the published pages and wraps each desk in its live store.

import "@fontsource/saira/latin-500.css";
import "@fontsource/saira/latin-600.css";
import "@fontsource/archivo/latin-400.css";
import "@fontsource/archivo/latin-700.css";
import "./styles.css";
import { useEffect, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { F } from "../shared/feedback";
import type { WorkspaceSlug } from "../shared/drafts";
import type { SessionInfo } from "../shared/types";
import { api } from "./api";
import { successCopy } from "./commands";
import { DeskProvider, useDesk } from "./desk";
import { Help } from "./help";
import { Home } from "./home";
import { useLocation } from "./route";
import { Footer, Shell } from "./shell";
import { Album } from "./workspaces/Album";
import { Attribution } from "./workspaces/Attribution";
import { Audit } from "./workspaces/Audit";
import { Condition } from "./workspaces/Condition";
import { Counteroffers } from "./workspaces/Counteroffers";
import { Dispatch } from "./workspaces/Dispatch";
import { Disputes } from "./workspaces/Disputes";
import { Intake } from "./workspaces/Intake";
import { Keepers } from "./workspaces/Keepers";
import { Offers } from "./workspaces/Offers";
import { Receipt } from "./workspaces/Receipt";
import { Reconcile } from "./workspaces/Reconcile";
import { Tray } from "./workspaces/Tray";

const WORKSPACE_VIEWS: Record<WorkspaceSlug, () => ReactElement | null> = {
  intake: Intake,
  attribution: Attribution,
  reconciliation: Reconcile,
  tray: Tray,
  album: Album,
  condition: Condition,
  keepers: Keepers,
  audit: Audit,
  offers: Offers,
  counteroffers: Counteroffers,
  dispatch: Dispatch,
  receipt: Receipt,
  disputes: Disputes,
};

const DEALER_ONLY: readonly WorkspaceSlug[] = ["intake", "attribution", "reconciliation", "tray", "album", "condition", "keepers", "audit"];

function DeskPage({ slug }: { slug: WorkspaceSlug | null }) {
  const { phase, session } = useDesk();
  const View = slug ? WORKSPACE_VIEWS[slug] : null;
  const allowed = !slug || session?.role === "dealer" || !DEALER_ONLY.includes(slug);
  return (
    <Shell current={slug}>
      {phase === "loading" && <p className="caption-text">Loading desk…</p>}
      {phase === "hidden" && <p className="page-message">{F.HIDDEN}</p>}
      {phase === "unavailable" && <p className="page-message">{F.SERVICE}</p>}
      {phase === "ready" && !allowed && <p className="page-message">{F.HIDDEN}</p>}
      {phase === "ready" && allowed && (View ? <View /> : <Home />)}
    </Shell>
  );
}

/** The plain shell used where no desk is open: help pages and the sign-in outage page. */
function PlainPage({ children, error }: { children?: ReactElement; error?: string }) {
  return (
    <div className="page">
      <header className="masthead">
        <div className="mast-left">
          <a className="wordmark" href="/">
            Flan
          </a>
        </div>
        <div className="folder-tabs" role="tablist" aria-label="Desks">
          <a role="tab" className="folder-tab" aria-selected={false} href="/">
            Stock
          </a>
          <a role="tab" className="folder-tab" aria-selected={false} href="/">
            Exchange
          </a>
        </div>
        <a className="corner" aria-describedby="corner-count corner-status" href="/">
          <span className="sr-only">Open exchange circle</span>
          <span id="corner-count" className="corner-count" aria-hidden="true">Exchange desk</span>
          <span id="corner-status" className="corner-status" aria-hidden="true">{F.CORNER_VERIFY}</span>
        </a>
      </header>
      <div className="rule" aria-hidden="true" />
      <section className="status-line" aria-label="Desk status" />
      <main id="desk-main" className="sheet" aria-label="Specimen desk" tabIndex={-1}>
        <div className="feedback">
          <div role="status" aria-label="Desk updates" aria-live="polite" aria-atomic="true" className="desk-updates" />
          <div role="alert" aria-label="Desk error" className={error ? "desk-error" : "desk-error empty"}>
            {error}
          </div>
        </div>
        {children}
      </main>
      <div className="rule" aria-hidden="true" />
      <Footer />
    </div>
  );
}

function RootRedirect() {
  useEffect(() => {
    void api<SessionInfo>("GET", "/api/session").then((r) => location.replace(`/desk/${r.ok && r.body.namespace ? r.body.namespace : "hollowmint"}`));
  }, []);
  return <PlainPage />;
}

function App() {
  const { route } = useLocation();
  switch (route.kind) {
    case "home":
    case "workspace":
      return (
        <DeskProvider key={route.ns} ns={route.ns} success={successCopy}>
          <DeskPage slug={route.kind === "workspace" ? route.slug : null} />
        </DeskProvider>
      );
    case "help":
      return (
        <PlainPage>
          <Help page={route.page} />
        </PlainPage>
      );
    case "signin-down":
      return (
        <PlainPage error={F.SIGNIN_DOWN}>
          <p className="page-message">{F.SIGNIN_DOWN}</p>
        </PlainPage>
      );
    case "root":
      return <RootRedirect />;
  }
}

createRoot(document.getElementById("root")!).render(<App />);
