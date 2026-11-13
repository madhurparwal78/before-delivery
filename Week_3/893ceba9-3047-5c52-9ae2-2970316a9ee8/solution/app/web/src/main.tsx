import { render } from "preact";
import { useLayoutEffect } from "preact/hooks";
import "./styles.css";
import { navigate, useRoute } from "./router";
import { GradientDefs } from "./illustrations";
import { Shell } from "./layout";
import { api } from "./api";
import { loadSession, sessionStore, useLoad, useStore } from "./store";
import { Audit, Desk } from "./pages/desk";
import { Editor } from "./pages/editor";
import { Merge } from "./pages/merge";
import { ProjectPage } from "./pages/project";
import { Landing, NotFound, Notice, SignIn } from "./pages/public";
import { Review } from "./pages/review";
import { Settings } from "./pages/settings";
import { TM } from "./pages/tm";

function signedInPage(path: string) {
  if (path === "/desk") return <Desk />;
  if (path === "/audit") return <Audit />;
  if (path === "/review") return <Review />;
  const m = /^\/projects\/([^/]+)(?:\/(editor|tm|merge|settings))?$/.exec(path);
  if (m) {
    const slug = decodeURIComponent(m[1]);
    switch (m[2]) {
      case "editor": return <Editor key={slug} slug={slug} />;
      case "tm": return <TM key={slug} slug={slug} />;
      case "merge": return <Merge key={slug} slug={slug} />;
      case "settings": return <Settings key={slug} slug={slug} />;
      default: return <ProjectPage key={slug} slug={slug} />;
    }
  }
  return null;
}

/** A reviewer has no project screens: an invited project sends them to the queue, any other is not found. */
function ReviewerProject({ slug }: { slug: string }) {
  const project = useLoad(() => api("GET", `/api/projects/${encodeURIComponent(slug)}`), [slug]);
  useLayoutEffect(() => { if (project.data) navigate("/review", true); }, [project.data]);
  return project.error?.status === 404 ? <NotFound kind="project" /> : null;
}

function App() {
  const route = useRoute();
  const user = useStore(sessionStore);
  useLayoutEffect(() => { void loadSession(); }, []);
  const page = signedInPage(route.path);
  useLayoutEffect(() => {
    if (user === null && page) navigate(`/sign-in?next=${encodeURIComponent(route.path + location.search)}`, true);
  }, [user, route.path]);
  useLayoutEffect(() => {
    if (user?.role === "reviewer" && ["/desk", "/audit"].includes(route.path)) navigate("/review", true);
  }, [user?.role, route.path]);

  let body;
  if (route.path === "/") body = <Landing />;
  else if (route.path === "/sign-in") body = <SignIn />;
  else if (page) {
    const slug = /^\/projects\/([^/]+)/.exec(route.path)?.[1];
    body = user ? <Shell>{user.role === "reviewer" && slug ? <ReviewerProject slug={decodeURIComponent(slug)} /> : page}</Shell> : null;
  }
  else body = user ? <Shell><NotFound /></Shell> : user === undefined ? null : <NotFound />;
  return <>{body}<Notice /><GradientDefs /></>;
}

render(<App />, document.getElementById("root")!);
