// Routes every page of the single-page client; the 3D screens load their own chunks.
import { render, type ComponentType } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Home, Pricing } from "./pages/public.js";
import { AppShell } from "./pages/shell.js";
import { Agents, Audit, Dashboard, Members, Scenes, Settings } from "./pages/workspace.js";
import { Billing } from "./pages/billing.js";
import { usePath } from "./ui.js";

/** Loads a screen that carries the WebGL renderer only when it is opened. */
function Lazy<P extends object>({ load, props }: { load: () => Promise<ComponentType<P>>; props: P }) {
  const [Screen, setScreen] = useState<ComponentType<P> | null>(null);
  useEffect(() => { load().then((component) => setScreen(() => component), () => undefined); }, [load]);
  return Screen ? <Screen {...props} /> : null;
}

const loadSignup = () => import("./pages/forms.js").then((m) => m.Signup);
const loadLogin = () => import("./pages/forms.js").then((m) => m.Login);
const loadInvite = () => import("./pages/forms.js").then((m) => m.Invite);
const loadEditor = () => import("./editor/editor.js").then((m) => m.Editor);
const loadReview = () => import("./pages/review.js").then((m) => m.Review);
const loadEmbed = () => import("./pages/embed.js").then((m) => m.Embed);

const APP_PAGES: Record<string, ComponentType> = {
  "": Dashboard, scenes: Scenes, members: Members, agents: Agents, audit: Audit, billing: Billing, settings: Settings,
};

function Router() {
  const path = usePath();
  const [, area, a, b] = path.split("/");
  if (path === "/") return <Home />;
  if (area === "pricing") return <Pricing />;
  if (area === "signup") return <Lazy load={loadSignup} props={{}} />;
  if (area === "login") return <Lazy load={loadLogin} props={{}} />;
  if (area === "invite" && a) return <Lazy load={loadInvite} props={{ token: decodeURIComponent(a) }} />;
  if (area === "review" && a) return <Lazy load={loadReview} props={{ token: decodeURIComponent(a) }} />;
  if (area === "embed" && a) return <Lazy load={loadEmbed} props={{ embedId: decodeURIComponent(a) }} />;
  if (area === "app") {
    if (a === "scenes" && b) {
      // The editor chunk carries the renderer: fetch it alongside the session instead of after it.
      void loadEditor();
      return <AppShell path={path}><Lazy load={loadEditor} props={{ sceneId: decodeURIComponent(b) }} /></AppShell>;
    }
    const Page = APP_PAGES[a ?? ""];
    if (Page) return <AppShell path={path}><Page /></AppShell>;
  }
  return <Home />;
}

const root = document.getElementById("root");
if (root) render(<Router />, root);
