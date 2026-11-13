// The app shell: header, live regions, routes and the dialogs any page can open.

import { useEffect } from "react";
import { useLocation } from "./router.js";
import { useApp } from "./state.js";
import { Header } from "./components/Header.js";
import { AccountDialogs } from "./components/AccountDialogs.js";
import { PlanDialog } from "./components/PlanDialog.js";
import { IndexPage } from "./pages/Index.js";
import { ChapterPage } from "./pages/Chapter.js";
import { TimelinePage } from "./pages/Timeline.js";
import { SourcesPage } from "./pages/Sources.js";
import { SessionsPage } from "./pages/Sessions.js";
import { SupportPage } from "./pages/Support.js";
import { AccountPage } from "./pages/Account.js";
import { StudioPage } from "./pages/Studio.js";
import { BoxOfficePage } from "./pages/BoxOffice.js";
import { NotFound } from "./pages/NotFound.js";

const TITLES: Record<string, string> = {
  "/": "The eight rooms",
  "/timeline": "Timeline",
  "/sources": "Sources",
  "/sessions": "Guided sessions",
  "/support": "Support",
  "/account": "Your account",
  "/studio": "Studio",
  "/box-office": "Box office",
};

function Page({ path }: { path: string }) {
  const chapter = /^\/chapters\/(\d+)$/.exec(path);
  if (chapter) return <ChapterPage key={chapter[1]} number={Number(chapter[1])} />;
  switch (path) {
    case "/":
      return <IndexPage />;
    case "/timeline":
      return <TimelinePage />;
    case "/sources":
      return <SourcesPage />;
    case "/sessions":
      return <SessionsPage />;
    case "/support":
      return <SupportPage />;
    case "/account":
      return <AccountPage />;
    case "/studio":
      return <StudioPage />;
    case "/box-office":
      return <BoxOfficePage />;
    default:
      return <NotFound />;
  }
}

export function App() {
  const { path } = useLocation();
  const app = useApp();
  useEffect(() => {
    document.title = `${TITLES[path] ?? "Sightline"} — Halden Reading Room`;
  }, [path]);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div role="status" aria-label="Service notice" className={`service-notice${app.serviceNotice ? " has-notice" : ""}`}>
        {app.serviceNotice}
      </div>
      <Header />
      <div role="status" aria-label="Notices" className={`notices${app.notice.text ? " has-notice" : ""}`}>
        <span key={app.notice.serial}>{app.notice.text}</span>
      </div>
      <main id="main" tabIndex={-1}>
        <Page path={path} />
      </main>
      <AccountDialogs />
      <PlanDialog />
    </>
  );
}
