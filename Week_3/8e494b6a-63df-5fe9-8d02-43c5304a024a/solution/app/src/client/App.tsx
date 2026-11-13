// The application: who is signed in, which page the address names, and the console chrome around it.
import { useEffect, type ReactNode } from "react";
import { api } from "./lib/api";
import { connectLive } from "./lib/live";
import { navigate, useLocation } from "./lib/router";
import { update, useAppState, type Me } from "./lib/store";
import { Shell } from "./shell/Shell";
import { AlertsPage, MaintenancePage, NewRulePage, RulePage } from "./pages/Alerts";
import { KeysPage, SpacesPage } from "./pages/Admin";
import { Auth } from "./pages/Auth";
import { CasePage, CasesPage } from "./pages/Cases";
import { ExplorePage } from "./pages/explore/Explore";
import { InboxPage } from "./pages/Inbox";
import { NotFound } from "./pages/NotFound";
import { ObjectivesPage } from "./pages/Objectives";
import { PipelineEditorPage, PipelinesPage, SimulatePage } from "./pages/Pipelines";
import { PipesPage } from "./pages/Pipes";
import { RulesPage } from "./pages/Rules";
import { AnalyzePage, LifecyclePage, StreamPage, StreamsPage } from "./pages/Streams";
import { TracePage, TracesPage } from "./pages/Traces";

function route(path: string): ReactNode {
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  const [head, a, b] = parts;
  if (parts.length === 0) return null;
  switch (head) {
    case "explore": return parts.length === 1 ? <ExplorePage /> : <NotFound />;
    case "pipes": return parts.length === 1 ? <PipesPage /> : <NotFound />;
    case "streams":
      if (parts.length === 1) return <StreamsPage />;
      if (parts.length === 2 && a) return <StreamPage key={a} name={a} />;
      if (parts.length === 3 && a && b === "analyze") return <AnalyzePage key={a} name={a} />;
      if (parts.length === 3 && a && b === "lifecycle") return <LifecyclePage key={a} name={a} />;
      return <NotFound />;
    case "pipelines":
      if (parts.length === 1) return <PipelinesPage />;
      if (parts.length === 2 && a) return <PipelineEditorPage key={a} name={a} />;
      if (parts.length === 3 && a && b === "simulate") return <SimulatePage key={a} name={a} />;
      return <NotFound />;
    case "alerts":
      if (parts.length === 1) return <AlertsPage />;
      if (parts.length === 2 && a === "new") return <NewRulePage />;
      if (parts.length === 2 && a === "maintenance") return <MaintenancePage />;
      if (parts.length === 2 && a) return <RulePage key={a} id={a} />;
      return <NotFound />;
    case "inbox": return parts.length === 1 ? <InboxPage /> : <NotFound />;
    case "cases":
      if (parts.length === 1) return <CasesPage />;
      return parts.length === 2 && a ? <CasePage key={a} number={a} /> : <NotFound />;
    case "traces":
      if (parts.length === 1) return <TracesPage />;
      return parts.length === 2 && a ? <TracePage key={a} id={a} /> : <NotFound />;
    case "objectives": return parts.length === 1 ? <ObjectivesPage /> : <NotFound />;
    case "spaces": return parts.length === 1 ? <SpacesPage /> : <NotFound />;
    case "keys": return parts.length === 1 ? <KeysPage /> : <NotFound />;
    case "rules": return parts.length === 1 ? <RulesPage /> : <NotFound />;
    default: return <NotFound />;
  }
}

export function App() {
  const { path } = useLocation();
  const me = useAppState((s) => s.me);
  const loaded = useAppState((s) => s.loaded);
  const spaceVersion = useAppState((s) => s.spaceVersion);
  const seq = useAppState((s) => s.seq);
  const pending = useAppState((s) => s.pending);

  useEffect(() => {
    api.get<Me>("/api/me").then(
      (profile) => update({ me: profile, seq: profile.seq, loaded: true }),
      () => update({ me: null, loaded: true }),
    );
  }, []);

  useEffect(() => {
    if (me) connectLive(me.space.slug, me.seq);
  }, [me?.space.slug, spaceVersion]);

  useEffect(() => {
    if (!me) return;
    api.get<{ streams: Array<{ events: number; failures: number }> }>("/api/streams").then(
      (list) => update({ ingest: { stored: list.streams.reduce((n, s) => n + s.events, 0), failed: list.streams.reduce((n, s) => n + s.failures, 0) } }),
      () => undefined,
    );
  }, [me?.space.slug, spaceVersion]);

  const auth = path === "/signin" || path === "/signup";
  useEffect(() => {
    if (!loaded) return;
    if (!me && !auth) navigate("/signin", true);
    else if (me && (auth || path === "/")) navigate("/explore", true);
  }, [loaded, me, auth, path]);

  if (!loaded) return <main className="main" data-seq={0} data-pending={pending}><p className="muted">Loading Spoorline.</p></main>;
  if (!me) return auth ? <Auth key={path} mode={path === "/signup" ? "signup" : "signin"} /> : <main className="main" data-seq={seq} data-pending={pending} />;
  return <Shell me={me}><div key={`${me.space.slug}:${spaceVersion}`}>{route(path)}</div></Shell>;
}
