import { render } from "preact";
import { pageConfig } from "./config.js";
import { DashboardPage } from "./pages/dashboard.js";
import { LandingPage } from "./pages/landing.js";
import { ProjectPage, SharedPage } from "./pages/project.js";
import { NotFoundPage, SignInPage } from "./pages/simple.js";

function App() {
  const path = location.pathname;
  if (pageConfig.notFound) return <NotFoundPage />;
  if (path === "/") return <LandingPage />;
  if (path === "/signin") return <SignInPage />;
  if (path === "/projects") return <DashboardPage />;
  const project = /^\/projects\/([^/]+)$/.exec(path);
  if (project) return <ProjectPage projectId={decodeURIComponent(project[1]!)} />;
  const shared = /^\/s\/([^/]+)$/.exec(path);
  if (shared) return <SharedPage token={decodeURIComponent(shared[1]!)} />;
  return <NotFoundPage />;
}

render(<App />, document.getElementById("app")!);
