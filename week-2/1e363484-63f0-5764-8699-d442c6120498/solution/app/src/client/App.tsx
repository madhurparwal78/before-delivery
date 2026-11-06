import { AccessPage } from "./pages/AccessPage";
import { AuditPage } from "./pages/AuditPage";
import { FigurePage } from "./pages/FigurePage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { RegulatorAuditPage, RegulatorPage } from "./pages/RegulatorPage";
import { SignInPage } from "./pages/SignInPage";
import { useLayoutEffect } from "react";
import { navigate, usePath } from "./router";
import { Shell } from "./ui/Shell";
import { Workspace } from "./workspace/Workspace";

export function App() {
  const path = usePath();
  let match: RegExpExecArray | null;

  if (path === "/signin") return <SignInPage />;
  if ((match = /^\/r\/([^/]+)\/audit$/.exec(path))) return <RegulatorAuditPage key={match[1]} token={match[1]!} />;
  if ((match = /^\/r\/([^/]+)$/.exec(path))) return <RegulatorPage key={match[1]} token={match[1]!} />;

  let screen = <UnknownScreen />;
  if (path === "/projects") {
    screen = <ProjectsPage />;
  } else if ((match = /^\/projects\/([^/]+)\/figures\/([^/]+)\/audit$/.exec(path))) {
    screen = <AuditPage key={path} slug={match[1]!} figureId={match[2]!} />;
  } else if ((match = /^\/projects\/([^/]+)\/figures\/([^/]+)$/.exec(path))) {
    screen = <FigurePage key={path} slug={match[1]!} figureId={match[2]!} />;
  } else if ((match = /^\/projects\/([^/]+)$/.exec(path))) {
    screen = <Workspace key={match[1]} slug={match[1]!} />;
  } else if (path === "/admin/access") {
    screen = <AccessPage />;
  }
  return <Shell>{screen}</Shell>;
}

/** Any other address opens the project list. */
function UnknownScreen() {
  useLayoutEffect(() => navigate("/projects", { replace: true }), []);
  return null;
}
