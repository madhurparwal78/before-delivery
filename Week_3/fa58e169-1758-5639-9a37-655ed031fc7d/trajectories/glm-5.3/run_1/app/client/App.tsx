import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, type MeData } from "./lib/api";
import { useLayoutWidth } from "./lib/hooks";
import { s } from "../common/copy";
import { WorkspaceNav, TopBar } from "./components/Shell";
import { DesignerPage } from "./pages/DesignerPage";
import { PatternsPage } from "./pages/PatternsPage";
import { AuthPages } from "./pages/AuthPages";
import { FollowPage } from "./pages/FollowPage";
import { PublicPage } from "./pages/PublicPage";
import { ComparePage } from "./pages/ComparePage";
import { SettingsPage } from "./pages/SettingsPage";
import { NotFoundPage } from "./components/NotFound";
import type { JSX } from "react";

interface RouteInfo {
  page:
    | "patterns"
    | "designer"
    | "signup"
    | "signin"
    | "verify"
    | "invite"
    | "settings"
    | "follow"
    | "public"
    | "compare";
  id?: string;
  query: URLSearchParams;
}

function parseRoute(): RouteInfo {
  const url = new URL(window.location.href);
  const path = url.pathname;
  const query = url.searchParams;
  if (path === "/" || path === "") return { page: "patterns", query };
  if (path === "/signup") return { page: "signup", query };
  if (path === "/signin") return { page: "signin", query };
  if (path === "/verify") return { page: "verify", query };
  if (path === "/settings") return { page: "settings", query };
  const invite = /^\/invite\/([^/]+)$/.exec(path);
  if (invite) return { page: "invite", id: invite[1], query };
  const follow = /^\/follow\/([^/]+)$/.exec(path);
  if (follow) return { page: "follow", id: follow[1], query };
  const pub = /^\/p\/([^/]+)$/.exec(path);
  if (pub) return { page: "public", id: pub[1], query };
  const compare = /^\/patterns\/([^/]+)\/compare$/.exec(path);
  if (compare) return { page: "compare", id: compare[1], query };
  const designer = /^\/patterns\/([^/]+)$/.exec(path);
  if (designer) return { page: "designer", id: designer[1], query };
  return { page: "patterns", query };
}

function App(): JSX.Element {
  const layout = useLayoutWidth();
  const [route, setRoute] = useState<RouteInfo>(parseRoute);
  const [me, setMe] = useState<MeData | null | "loading">("loading");
  const [railOpen, setRailOpen] = useState(true);
  const [live, setLive] = useState<string | null>(null);
  const [motion, setMotion] = useState(false);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    void api<MeData>("/api/me")
      .then((data) => setMe(data))
      .catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (typeof me !== "object" || me === null) return;
    setMotion(me.reduceMotion);
  }, [me]);

  const rootAttributes = useMemo(
    () => ({
      "data-layout": layout,
      "data-reduce-motion": motion ? "true" : "false",
    }),
    [layout, motion],
  );

  const needsAuth = ["patterns", "designer", "settings", "follow", "compare"].includes(route.page);

  useEffect(() => {
    if (me === "loading") return;
    if (me === null && needsAuth) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/signin?next=${next}`;
    }
  }, [me, needsAuth, route]);

  const signedIn = typeof me === "object" && me !== null;

  const leadLine = (): string => {
    if (route.page === "designer") return s.loading;
    if (route.page === "patterns") return signedIn ? "Your patterns" : s.loading;
    if (route.page === "signup") return "Create your account";
    if (route.page === "signin") return "Sign in";
    if (route.page === "verify") return "Verify your email";
    if (route.page === "settings") return "Settings";
    if (route.page === "invite") return "Join the pattern test";
    if (route.page === "follow") return "Follow the pattern";
    if (route.page === "public") return "Published pattern";
    if (route.page === "compare") return "Compare versions";
    return s.loading;
  };

  return (
    <div {...rootAttributes}>
      <TopBar
        railOpen={railOpen}
        onToggle={() => setRailOpen(!railOpen)}
        showNew={signedIn && route.page === "patterns"}
        onLive={(value: string) => setLive(value)}
      />
      {signedIn ? (
        <div className="shell">
          {(layout === "desktop" ? railOpen : true) && layout === "desktop" ? (
            <WorkspaceNav route={route} layout={layout} />
          ) : null}
          <main className="main">
            <p className="live-strip">
              <span className="status" role="status" aria-live="polite" aria-label="Live">
                {live ?? (live === null ? s.liveOn : s.liveOff)}
              </span>
            </p>
            <h1 className="lead">{leadLine()}</h1>
            {route.page === "patterns" ? <PatternsPage me={me!} layout={layout} /> : null}
            {route.page === "designer" ? <DesignerPage me={me!} layout={layout} /> : null}
            {route.page === "compare" && route.id ? <ComparePage me={me!} layout={layout} id={route.id} query={route.query} /> : null}
            {route.page === "follow" && route.id ? <FollowPage me={me!} layout={layout} id={route.id} onLive={setLive} /> : null}
            {route.page === "settings" ? <SettingsPage me={me!} onMotion={setMotion} /> : null}
            {route.page === "signup" || route.page === "signin" || route.page === "verify" || route.page === "invite"
              ? (
                <AuthPages
                  page={route.page}
                  token={route.id}
                  query={route.query}
                />
              )
              : null}
            {route.page === "public" && route.id ? <PublicPage id={route.id} /> : null}
          </main>
        </div>
      ) : route.page === "public" && route.id ? (
        <main className="main">
          <h1 className="lead">{leadLine()}</h1>
          <PublicPage id={route.id} />
        </main>
      ) : route.page === "signup" ||
        route.page === "signin" ||
        route.page === "verify" ||
        route.page === "invite" ? (
        <main className="main">
          <h1 className="lead">{leadLine()}</h1>
          <AuthPages page={route.page} token={route.id} query={route.query} />
        </main>
      ) : me === "loading" ? (
        <main className="main">
          <h1 className="lead">{s.loading}</h1>
          <div className="panel" />
        </main>
      ) : (
        <NotFoundPage />
      )}
      {signedIn && layout !== "desktop" ? (
        <div className="stacked-nav">
          <WorkspaceNav route={route} layout={layout} inline />
        </div>
      ) : null}
    </div>
  );
}

void api<never>("/api/config").catch(() => undefined);

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
