// Screen routing (brief: Screens and layout).
import { useEffect } from "react";
import { navigate, useLocation } from "./lib/router.js";
import { landing } from "./lib/returnPath.js";
import { useSession } from "./lib/session.js";
import { TopBar } from "./components/TopBar.js";
import { Admin } from "./screens/Admin.js";
import { Invite, SignIn, SignUp } from "./screens/Auth.js";
import { ClusterSettings } from "./screens/ClusterSettings.js";
import { Explore } from "./screens/Explore.js";
import { NotFound } from "./screens/NotFound.js";
import { Profile } from "./screens/Profile.js";
import { PublicCluster } from "./screens/PublicCluster.js";
import { Review } from "./screens/Review.js";
import { Wall } from "./wall/Wall.js";

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function Screen() {
  const { path, href } = useLocation();
  const { account } = useSession();
  let match: RegExpExecArray | null;
  if (path === "/signin") return <SignIn />;
  if (path === "/signup") return <SignUp />;
  if (path === "/explore") return <Explore />;
  if ((match = /^\/invite\/([^/]+)$/.exec(path))) return <Invite token={decodeURIComponent(match[1] ?? "")} />;
  if ((match = /^\/review\/([^/]+)$/.exec(path))) return <Review token={decodeURIComponent(match[1] ?? "")} />;
  if ((match = /^\/@([^/]+)$/.exec(path))) return <Profile key={match[1]} handle={decodeURIComponent(match[1] ?? "")} />;
  if ((match = /^\/c\/([^/]+)$/.exec(path))) return <PublicCluster key={match[1]} id={match[1] ?? ""} />;
  const workspaceScreen = /^\/w\/([a-z0-9-]+)(?:\/(admin)|\/clusters\/([^/]+))?$/.exec(path);
  if (path === "/" || workspaceScreen) {
    if (account === null) return path === "/" ? <Redirect to="/explore" /> : <Redirect to={`/signin?next=${encodeURIComponent(href)}`} />;
    if (path === "/") return <Redirect to={landing(account)} />;
    const workspace = account.workspaces.find((w) => w.slug === workspaceScreen?.[1]);
    if (!workspace || !workspaceScreen) return <NotFound />;
    if (workspaceScreen[2]) return account.role === "ops_lead" ? <Admin key={workspace.slug} workspace={workspace} /> : <NotFound />;
    if (workspaceScreen[3]) return <ClusterSettings key={workspaceScreen[3]} account={account} workspace={workspace} clusterId={workspaceScreen[3]} />;
    return <Wall key={workspace.slug} workspace={workspace} />;
  }
  return <NotFound />;
}

export function App() {
  const { path } = useLocation();
  return (
    <div className="app" data-screen={path.startsWith("/w/") && path.split("/").length === 3 ? "wall" : "page"}>
      <TopBar />
      <Screen />
    </div>
  );
}
