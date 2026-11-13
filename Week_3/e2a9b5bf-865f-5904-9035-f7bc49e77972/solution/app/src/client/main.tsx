import { render } from "preact";
import { useLayoutEffect } from "preact/hooks";
import { PAGE_CSS } from "../shared/packet-page";
import { interceptLinks, navigate, useLocation, currentPathAndQuery } from "./lib/router";
import { useSelect } from "./lib/store";
import { Landing } from "./screens/landing";
import { AuthScreen } from "./screens/auth";
import { HistoryScreen } from "./screens/history";
import { KitScreen } from "./screens/kit";
import { PacketScreen } from "./screens/packet";
import { ProgramScreen } from "./screens/program";
import { ProgramsScreen } from "./screens/programs";
import { SessionScreen } from "./screens/session";
import { TonightScreen } from "./screens/tonight";
import { boot } from "./state/auth";
import { app } from "./state/model";
import { NotFoundScreen } from "./ui/layout";
import "./styles/app.css";

const style = document.createElement("style");
style.textContent = PAGE_CSS;
document.head.appendChild(style);

type Route =
  | { name: "landing" }
  | { name: "signin" }
  | { name: "signup" }
  | { name: "tonight" }
  | { name: "programs" }
  | { name: "program"; id: string }
  | { name: "kit" }
  | { name: "session"; id: string; observation: string | null }
  | { name: "history"; id: string }
  | { name: "packet"; id: string }
  | { name: "missing" };

function match(path: string, search: string): Route {
  const segments = path.split("/").filter(Boolean);
  const [a, b] = segments;
  if (segments.length === 0) return { name: "landing" };
  if (segments.length === 1) {
    if (a === "signin" || a === "signup" || a === "tonight" || a === "programs" || a === "kit") return { name: a };
  }
  if (segments.length === 2 && b) {
    if (a === "programs") return { name: "program", id: b };
    if (a === "sessions") return { name: "session", id: b, observation: new URLSearchParams(search).get("observation") };
    if (a === "objects") return { name: "history", id: b };
    if (a === "packets") return { name: "packet", id: b };
  }
  return { name: "missing" };
}

const PUBLIC = new Set(["landing", "signin", "signup", "missing"]);

function App() {
  const { path, search } = useLocation();
  const phase = useSelect(app, (s) => s.phase);
  const auth = useSelect(app, (s) => s.auth);
  const expired = useSelect(app, (s) => s.expired);
  const route = match(path, search);

  useLayoutEffect(() => {
    if (phase !== "ready") return;
    if (!PUBLIC.has(route.name) && auth === "out") {
      navigate(`/signin?next=${encodeURIComponent(currentPathAndQuery())}`, { replace: true });
    } else if ((route.name === "signin" || route.name === "signup") && auth === "in" && !expired) {
      navigate("/tonight", { replace: true });
    }
  }, [phase, auth, expired, path, search]);

  if (route.name === "landing") return <Landing />;
  if (route.name === "missing") return <NotFoundScreen />;
  if (phase !== "ready") return null;
  if (route.name === "signin" || route.name === "signup") return auth === "in" && !expired ? null : <AuthScreen mode={route.name} />;
  if (auth !== "in") return null;
  switch (route.name) {
    case "tonight":
      return <TonightScreen />;
    case "programs":
      return <ProgramsScreen />;
    case "program":
      return <ProgramScreen id={route.id} />;
    case "kit":
      return <KitScreen />;
    case "session":
      return <SessionScreen sessionId={route.id} observationId={route.observation} />;
    case "history":
      return <HistoryScreen objectId={route.id} />;
    case "packet":
      return <PacketScreen id={route.id} />;
  }
}

interceptLinks();
const root = document.getElementById("app");
if (root) render(<App />, root);
const dialogs = document.getElementById("dialogs");
if (!dialogs) throw new Error("the page needs a #dialogs element");
void boot();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => undefined);
