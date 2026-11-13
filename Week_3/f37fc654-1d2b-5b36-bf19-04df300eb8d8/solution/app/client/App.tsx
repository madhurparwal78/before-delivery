import { useEffect, type ReactElement } from "react";
import { NoticeLane, TopBar } from "./components/Shell";
import { startEvents } from "./lib/events";
import { useLocation } from "./lib/router";
import { useSession } from "./lib/session";
import { Brief } from "./pages/Brief";
import { Checkout } from "./pages/Checkout";
import { Commissions } from "./pages/Commissions";
import { Configure } from "./pages/Configure";
import { CrewDays, DaySheet } from "./pages/Crew";
import { CrmSettings, Deliveries } from "./pages/Crm";
import { Files } from "./pages/Files";
import { InstallDay } from "./pages/InstallDay";
import { Invite, Share } from "./pages/Sponsor";
import { Landing } from "./pages/Landing";
import { Maintenance } from "./pages/Maintenance";
import { NotFound } from "./pages/NotFound";
import { Overview } from "./pages/Overview";
import { Preview } from "./pages/Preview";
import { Jobs, Studio } from "./pages/Studio";
import { Stage } from "./stage/Stage";

function route(path: string): ReactElement {
  if (path === "/") return <Landing />;
  if (path === "/brief/new") return <Brief briefId={null} />;
  let m = /^\/briefs\/([^/]+)$/.exec(path);
  if (m) return <Brief key={m[1]} briefId={m[1]} />;
  if (path === "/commissions") return <Commissions />;
  if (path === "/studio") return <Studio />;
  if (path === "/studio/jobs") return <Jobs />;
  if (path === "/crew") return <CrewDays />;
  if (path === "/settings/crm") return <CrmSettings />;
  m = /^\/crew\/days\/([^/]+)$/.exec(path);
  if (m) return <DaySheet key={m[1]} id={m[1]} />;
  m = /^\/i\/([^/]+)$/.exec(path);
  if (m) return <Invite key={m[1]} token={m[1]} />;
  m = /^\/c\/([^/]+)(?:\/(files|preview|configure|day|checkout|share|webhooks|maintenance))?$/.exec(path);
  if (m) {
    const id = m[1];
    switch (m[2]) {
      case undefined: return <Overview key={id} id={id} />;
      case "files": return <Files key={id} id={id} />;
      case "preview": return <Preview key={id} id={id} />;
      case "configure": return <Configure key={id} id={id} />;
      case "day": return <InstallDay key={id} id={id} />;
      case "checkout": return <Checkout key={id} id={id} />;
      case "share": return <Share key={id} id={id} />;
      case "webhooks": return <Deliveries key={id} id={id} />;
      default: return <Maintenance key={id} id={id} />;
    }
  }
  return <NotFound />;
}

export function App() {
  const { path } = useLocation();
  const { status } = useSession();
  useEffect(() => {
    if (status === "in") startEvents();
  }, [status]);
  const brief = path === "/brief/new" || path.startsWith("/briefs/");
  return (
    <>
      <Stage />
      <div className={`app ${brief ? "page-brief" : ""}`}>
        {!brief && <TopBar />}
        <NoticeLane />
        {route(path)}
      </div>
    </>
  );
}
