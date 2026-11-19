import { ReactNode, useCallback, useEffect, useState } from "react";
import { api, User, CollectionSummary } from "./lib/api";
import { displayJson, JsonObj } from "shared/values";
import { useRoute, navigate } from "./lib/router";
import { TopBar, Rail, SectionsNav, CollectionsDrawer, OutageBanner, Section } from "./components/Shell";
import { DocumentsScreen } from "./components/DocumentsScreen";
import { PipelineScreen } from "./components/Pipeline";
import { MembersScreen, IndexesScreen, SchemaScreen, RulesScreen, SavedQueriesScreen, InvitesScreen } from "./screens/ProjectScreens";
import { LandingScreen, SignupScreen, ConfirmScreen, SigninScreen, ProjectsScreen, NotFoundScreen } from "./screens/AccountScreens";
import { ResizeSeparator } from "./components/ResizeSeparator";
import { usePipeline } from "./lib/pipeline";

/** The application: routes, the signed-in shell and the phone tabs. */

export function App(): ReactNode {
  const { path, segments } = useRoute();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [outage, setOutage] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [project, setProject] = useState<{ id: string; name: string; role: "owner" | "editor" | "reader" } | null>(null);
  const [phone, setPhone] = useState(window.innerWidth < 768);
  const [phoneTab, setPhoneTab] = useState<"query" | "results" | "pipeline">("query");
  const [queryPanePercent, setQueryPanePercent] = useState(30);
  const [pipelinePanePercent, setPipelinePanePercent] = useState(50);
  useEffect(() => {
    const onResize = (): void => setPhone(window.innerWidth < 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    void api.get<{ user: User }>("/api/me")
      .then(r => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  // health check on open, and whenever a file route reports an outage
  const checkHealth = useCallback(() => {
    void fetch("/api/health")
      .then(r => r.json())
      .then((d: { status: string }) => setOutage(d.status !== "ok"))
      .catch(() => setOutage(false));
  }, []);
  useEffect(checkHealth, [checkHealth]);

  const loadProject = useCallback((pid: string): void => {
    void api.get<{ id: string; name: string; role: "owner" | "editor" | "reader" }>(`/api/projects/${pid}`)
      .then(r => setProject({ id: r.id, name: r.name, role: r.role }))
      .catch(() => setProject(null));
    void api.get<{ collections: CollectionSummary[] }>(`/api/projects/${pid}/collections`)
      .then(r => setCollections(r.collections))
      .catch(() => setCollections([]));
  }, []);

  const pid = segments[0] === "p" ? segments[1] : null;
  const cid = segments[2] === "c" ? segments[3] : null;
  useEffect(() => {
    if (pid !== null) loadProject(pid);
  }, [pid, loadProject]);

  // sign-out redirect for protected routes
  const isPublic = path === "/" || path === "/signup" || path === "/confirm" || path === "/signin";
  useEffect(() => {
    if (ready && user === null && !isPublic) {
      const returnTo = encodeURIComponent(path);
      navigate(`/signin?returnTo=${returnTo}`, true);
    }
  }, [ready, user, isPublic, path]);

  // data for the shell
  const railCollections = pid === null ? [] : collections;

  // landing and account screens have no shell
  if (isPublic) {
    if (path === "/") return <LandingScreen />;
    if (path === "/signup") return <SignupScreen onSignedIn={setUser} />;
    if (path === "/confirm") return <ConfirmScreen onSignedIn={setUser} />;
    if (path === "/signin") {
      const returnTo = new URLSearchParams(window.location.search).get("returnTo") ?? "/projects";
      return <SigninScreen onSignedIn={u => { setUser(u); }} returnTo={returnTo} />;
    }
  }

  if (!ready) return <div className="boot" aria-busy="true" />;

  if (user === null) return <NotFoundScreen />;

  const shell = (children: ReactNode, sectionOf: Section | null): ReactNode => (
    <div className="app-shell">
      <TopBar
        user={user}
        showCollections={phone && pid !== null}
        onOpenCollections={() => setDrawerOpen(true)}
        onSignOut={() => {
          void api.post("/api/auth/signout").then(() => {
            setUser(null);
            navigate("/signin");
          });
        }}
      />
      {outage && <OutageBanner />}
      <div className="shell-body">
        {!phone && (
          <Rail
            project={pid === null ? null : { id: pid, name: project?.name ?? "" }}
            collections={railCollections}
            currentCollectionId={cid}
            section={sectionOf}
            onNavigate={p => navigate(p)}
          />
        )}
        <div className="shell-content">
          <SectionsNav pid={pid} cid={cid} section={sectionOf} />
          {cid !== null && project?.role === "reader" && (
            <div role="note" className="reader-note">You have read access</div>
          )}
          {children}
        </div>
      </div>
      {phone && (
        <CollectionsDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          project={pid === null ? null : { id: pid, name: project?.name ?? "" }}
          collections={railCollections}
          currentCollectionId={cid}
          onNavigate={p => navigate(p)}
        />
      )}
    </div>
  );

  if (path === "/projects") return shell(<ProjectsScreen user={user} onRefresh={() => {}} />, null);
  if (path === "/invites") return shell(<InvitesScreen user={user} />, null);

  // project routes
  if (segments[0] === "p" && segments.length >= 2) {
    if (project === null) {
      return ready ? shell(<NotFoundScreen />, null) : <div className="boot" aria-busy="true" />;
    }
    if (segments[2] === "members" && segments.length === 3) {
      return shell(<MembersScreen pid={pid as string} role={project.role} onRefresh={() => loadProject(pid as string)} />, "members");
    }
    if (segments[2] === "c" && segments.length >= 4) {
      const collectionInfo = collections.find(c => c.id === cid);
      const role = project.role;
      const refresh = (): void => loadProject(pid as string);
      // a role event from the stream updates the open screen at once (DP-65)
      const applyRole = (r: string): void => {
        setProject(cur => cur === null ? cur : { ...cur, role: r as "owner" | "editor" | "reader" });
      };

      // documents with an optional open document
      if (segments.length === 6 && segments[4] === "d") {
        return shell(
          <PhoneTabs
            phone={phone}
            tab={phoneTab}
            onTab={setPhoneTab}
            query={
              <DocumentsScreenInner
                pid={pid as string} cid={cid as string} role={role} phone={phone}
                initialDocId={segments[5]} outage={outage} onOutageChange={setOutage}
                collectionName={collectionInfo?.name ?? ""}
                queryPanePercent={queryPanePercent}
                onQueryPanePercent={setQueryPanePercent}
                onRoleChange={applyRole}
              />
            }
            pipeline={<PipelineHost pid={pid as string} cid={cid as string} phone={phone} panePercent={pipelinePanePercent} onPanePercent={setPipelinePanePercent} />}
          />,
          "documents",
        );
      }
      if (segments.length === 4) {
        return shell(
          <PhoneTabs
            phone={phone}
            tab={phoneTab}
            onTab={setPhoneTab}
            query={
              <DocumentsScreenInner
                pid={pid as string} cid={cid as string} role={role} phone={phone}
                initialDocId={null} outage={outage} onOutageChange={setOutage}
                collectionName={collectionInfo?.name ?? ""}
                queryPanePercent={queryPanePercent}
                onQueryPanePercent={setQueryPanePercent}
                onRoleChange={applyRole}
              />
            }
            pipeline={<PipelineHost pid={pid as string} cid={cid as string} phone={phone} panePercent={pipelinePanePercent} onPanePercent={setPipelinePanePercent} />}
          />,
          "documents",
        );
      }
      if (segments[4] === "queries") return shell(<SavedQueriesScreen pid={pid as string} cid={cid as string} role={role} onRunSaved={() => navigate(`/p/${pid}/c/${cid}`)} />, "queries");
      if (segments[4] === "pipeline") {
        return shell(
          <PipelineHost pid={pid as string} cid={cid as string} phone={phone} panePercent={pipelinePanePercent} onPanePercent={setPipelinePanePercent} />,
          "pipeline",
        );
      }
      if (segments[4] === "indexes") return shell(<IndexesScreen pid={pid as string} cid={cid as string} role={role} onRefresh={refresh} />, "indexes");
      if (segments[4] === "schema") return shell(<SchemaScreen pid={pid as string} cid={cid as string} />, "schema");
      if (segments[4] === "rules") return shell(<RulesScreen pid={pid as string} cid={cid as string} role={role} onRefresh={refresh} />, "rules");
    }
  }

  return shell(<NotFoundScreen />, null);
}

interface DocumentsScreenInnerProps {
  pid: string;
  cid: string;
  role: "owner" | "editor" | "reader";
  phone: boolean;
  initialDocId: string | null;
  outage: boolean;
  onOutageChange: (v: boolean) => void;
  collectionName: string;
  queryPanePercent: number;
  onQueryPanePercent: (v: number) => void;
  onRoleChange: (role: string) => void;
}

function DocumentsScreenInner(props: DocumentsScreenInnerProps): ReactNode {
  return (
    <DocumentsScreen
      pid={props.pid}
      cid={props.cid}
      role={props.role}
      phone={props.phone}
      initialDocId={props.initialDocId}
      outage={props.outage}
      onOutageChange={props.onOutageChange}
      collectionName={props.collectionName}
      queryPanePercent={props.queryPanePercent}
      onQueryPanePercent={props.onQueryPanePercent}
      onRoleChange={props.onRoleChange}
    />
  );
}

/** The phone workspace tabs (DP-12): Query, Results, Pipeline. */
function PhoneTabs(props: {
  phone: boolean;
  tab: "query" | "results" | "pipeline";
  onTab: (t: "query" | "results" | "pipeline") => void;
  query: ReactNode;
  pipeline: ReactNode;
}): ReactNode {
  if (!props.phone) {
    return (
      <div className="documents-and-pipeline">
        {props.query}
        {props.pipeline}
      </div>
    );
  }
  const tabs: { id: "query" | "results" | "pipeline"; label: string }[] = [
    { id: "query", label: "Query" },
    { id: "results", label: "Results" },
    { id: "pipeline", label: "Pipeline" },
  ];
  return (
    <div className="phone-tabs">
      <div role="tablist" aria-label="Workspace" className="tablist"
        onKeyDown={e => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          e.preventDefault();
          const idx = tabs.findIndex(t => t.id === props.tab);
          const next = e.key === "ArrowRight" ? tabs[(idx + 1) % tabs.length] : tabs[(idx - 1 + tabs.length) % tabs.length];
          props.onTab(next.id);
        }}
      >
        {tabs.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={props.tab === t.id}
            tabIndex={props.tab === t.id ? 0 : -1}
            className={props.tab === t.id ? "tab current" : "tab"}
            onClick={() => props.onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" hidden={props.tab !== "query"} className="tabpanel">{props.query}</div>
      <div role="tabpanel" hidden={props.tab !== "results"} className="tabpanel">{props.query}</div>
      <div role="tabpanel" hidden={props.tab !== "pipeline"} className="tabpanel">{props.pipeline}</div>
    </div>
  );
}

function PipelineHost(props: {
  pid: string;
  cid: string;
  phone: boolean;
  panePercent: number;
  onPanePercent: (v: number) => void;
}): ReactNode {
  const pipeline = usePipeline(props.pid, props.cid);
  const stagePreviewDocs = pipeline.preview?.stages[pipeline.focusedStage ?? 0]?.documents ?? [];
  return (
    <div className="pipeline-host">
      <div className="pipeline-main" style={{ flexBasis: `${props.panePercent}%` }}>
        <PipelineScreen
          stages={pipeline.stages}
          preview={pipeline.preview}
          collectionCount={pipeline.collectionCount}
          pinId={pipeline.pinId}
          pending={pipeline.pending}
          statusText={pipeline.statusText}
          errorText={pipeline.errorText}
          cappedLimit={pipeline.cappedLimit}
          onChange={pipeline.setStages}
          onRecompute={pipeline.recompute}
          onPreviewStage={pipeline.previewStage}
          onFocusStage={pipeline.focusStage}
          onSaveDraft={pipeline.saveDraft}
          onStatus={pipeline.setStatusText}
          onPin={pipeline.setPinId}
          onUnpin={pipeline.clearPin}
          readOnly={pipeline.readOnly}
          phone={props.phone}
        />
      </div>
      <ResizeSeparator label="Resize pipeline pane" value={props.panePercent} onChange={props.onPanePercent} />
      <section aria-label="Stage preview" className="stage-preview">
        {stagePreviewDocs.map((d, i) => (
          <pre key={i} className="json-block">{displayJson(d as JsonObj)}</pre>
        ))}
      </section>
    </div>
  );
}
