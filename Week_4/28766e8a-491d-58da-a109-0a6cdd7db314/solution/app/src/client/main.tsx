// Linewell browser client: one page per address (brief: Screens).
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { AuthPage } from "./pages/auth";
import { DiagramList } from "./pages/list";
import { NotFound } from "./pages/not-found";
import { Workspace } from "./workspace/workspace";
import "./styles.css";

function Page({ path }: { path: string }) {
  if (document.documentElement.dataset.view === "not-found") return <NotFound />;
  if (path === "/signin") return <AuthPage mode="signin" />;
  if (path === "/signup") return <AuthPage mode="signup" />;
  const workspace = /^\/d\/([^/]+)$/.exec(path);
  if (workspace) return <Workspace key={workspace[1]} diagramId={decodeURIComponent(workspace[1] as string)} />;
  return <DiagramList />;
}

/** The page, and the one polite announcer that outlives every view change. */
function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  return (
    <>
      <Page path={path} />
      <div id="announcer" class="visually-hidden" aria-live="polite" />
    </>
  );
}

render(<App />, document.getElementById("app") as HTMLElement);
