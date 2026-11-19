import { PensPage } from "./pages/pens";
import { WorkspacePage } from "./pages/workspace";
import { DivesPage } from "./pages/dives";
import { ImportsPage } from "./pages/imports";
import { ReportsPage } from "./pages/reports";
import { DevicesPage } from "./pages/devices";
import { SharePage } from "./pages/share";
import { ConsoleShell } from "./shell";
import { useLocationKey } from "./ui";

export function App() {
  useLocationKey();
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const share = /^\/r\/([^/]+)$/.exec(path);
  if (share) return <SharePage token={decodeURIComponent(share[1])} />;
  const pen = /^\/pens\/([^/]+)$/.exec(path);
  let page = <h1 className="statement">This page does not exist</h1>;
  if (path === "/") page = <PensPage />;
  else if (pen) page = <WorkspacePage penId={decodeURIComponent(pen[1])} />;
  else if (path === "/dives") page = <DivesPage />;
  else if (path === "/imports") page = <ImportsPage />;
  else if (path === "/reports") page = <ReportsPage />;
  else if (path === "/devices") page = <DevicesPage />;
  return <ConsoleShell>{page}</ConsoleShell>;
}
