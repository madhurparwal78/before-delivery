import "./styles.css";
import type { JSX } from "preact";
import { render } from "preact";
import { InvitePage, NotFound, Projects, SignIn } from "./pages.tsx";
import { ProjectView } from "./project/ProjectView.tsx";
import { useLocation } from "./router.ts";

function App(): JSX.Element {
  const where = useLocation();
  const url = new URL(where, location.origin);
  const path = url.pathname;
  const project = /^\/p\/([^/]+)\/?$/.exec(path);
  const invite = /^\/invite\/([^/]+)\/?$/.exec(path);
  const share = /^\/s\/([^/]+)\/?$/.exec(path);
  if (path === "/signin") return <SignIn next={url.searchParams.get("next")} />;
  if (path === "/") return <Projects />;
  if (project) {
    const id = decodeURIComponent(project[1] as string);
    return <ProjectView key={`p-${id}`} mode="member" id={id} search={url.search} />;
  }
  if (invite) return <InvitePage key={invite[1]} token={decodeURIComponent(invite[1] as string)} />;
  if (share) {
    const token = decodeURIComponent(share[1] as string);
    return <ProjectView key={`s-${token}`} mode="share" id={token} search={url.search} />;
  }
  return <NotFound />;
}

render(<App />, document.getElementById("root") as HTMLElement);
