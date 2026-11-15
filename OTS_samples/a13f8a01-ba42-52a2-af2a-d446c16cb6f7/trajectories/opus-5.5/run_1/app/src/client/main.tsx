import { render } from "preact";
import type { ClientConfig, User } from "../shared/types";
import { api } from "./api";
import { refreshLive } from "./live";
import { Editor } from "./pages/editor";
import { Embed, startingTab } from "./pages/embed";
import { History } from "./pages/history";
import { Collection, Collections, Dashboard, Explore } from "./pages/lists";
import { Landing, NotFound, Shelf, Signin, Signup, Verify } from "./pages/simple";
import { useLocation } from "./router";
import { setState } from "./store";

function App() {
  const location = useLocation();
  if (location.notFound) return <NotFound />;
  const path = location.path;
  let match: RegExpExecArray | null;
  if (path === "/") return <Landing />;
  if (path === "/signup") return <Signup />;
  if (path === "/signin") return <Signin />;
  if (path === "/verify") return <Verify token={location.search.get("token") ?? ""} />;
  if (path === "/dashboard") return <Dashboard />;
  if (path === "/explore") return <Explore />;
  if (path === "/collections") return <Collections />;
  if (path === "/shelf") return <Shelf />;
  if ((match = /^\/pen\/([a-z0-9]{10})$/.exec(path))) return <Editor key={match[1]} penId={match[1] as string} />;
  if ((match = /^\/pen\/([a-z0-9]{10})\/history$/.exec(path))) return <History key={match[1]} penId={match[1] as string} />;
  if ((match = /^\/collections\/([a-z0-9]{10})$/.exec(path))) return <Collection key={match[1]} id={match[1] as string} />;
  if ((match = /^\/embed\/([a-z0-9]{10})$/.exec(path))) return <Embed key={match[1]} penId={match[1] as string} tab={startingTab(location.search.get("tab"))} />;
  return <NotFound />;
}

async function boot(): Promise<void> {
  const [config, me] = await Promise.all([api<ClientConfig>("GET", "/api/config"), api<{ user: User }>("GET", "/api/me")]);
  setState({ ...(config.ok ? { config: config.data } : {}), user: me.ok ? me.data.user : null });
  refreshLive();
  const root = document.getElementById("app") as HTMLElement;
  root.textContent = "";
  render(<App />, root);
}

void boot();
