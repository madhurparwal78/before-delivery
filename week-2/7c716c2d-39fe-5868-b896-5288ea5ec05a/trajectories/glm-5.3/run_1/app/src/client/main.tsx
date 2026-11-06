import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import cssText from "./styles.css";

const styleEl = document.createElement("style");
styleEl.textContent = cssText;
document.head.appendChild(styleEl);
import { api, ApiError } from "./api.ts";
import { store } from "./store.ts";
import { usePath } from "./hooks.ts";
import { ServiceNotices, useInterval } from "./ui.tsx";
import { IssuesList, IssueDetail, PickerLayer, moveIssueStatus, assignIssueTo, useIssuesQuery, type PickerState } from "./issues.tsx";
import { CycleModule } from "./cycle.tsx";
import { ChatList, ChannelView, InboxView } from "./chat.tsx";
import { DocsList, DocEditor } from "./docs.tsx";
import { OfficeList, OfficeFloor } from "./office.tsx";
import { SettingsView, PasswordForm } from "./settings.tsx";
import { SignInScreen, CreateAccountScreen, InvitationsScreen, WelcomeScreen } from "./public.tsx";
import type { Issue } from "./types.ts";

function useViewport(): { isPhone: boolean } {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = (): void => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return { isPhone: w < 768 };
}

const MODULES = [
  { href: "/issues", label: "Issues" },
  { href: "/cycle", label: "Cycle" },
  { href: "/chat/inbox", label: "Chat" },
  { href: "/docs", label: "Docs" },
  { href: "/office", label: "Office" },
  { href: "/settings", label: "Settings" },
];

function App(): React.ReactNode {
  const [path, navigate] = usePath();
  const [, forceUpdate] = useState(0);
  const { isPhone } = useViewport();
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [newIssueOpen, setNewIssueOpen] = useState(false);
  const pickerOpener = useMemo(() => ({ current: null as HTMLElement | null }), []);
  const heartbeatAt = useRef(0);

  useEffect(() => {
    const off = store.subscribe(() => forceUpdate((n) => n + 1));
    void store.bootstrap();
    return off;
  }, []);

  // The page fetches only two things on a timer: the status and the workspace record.
  useInterval(() => {
    void store.refreshStatus();
    void store.refreshWorkspace();
  }, 10000);

  useInterval(() => {
    if (!store.me || !store.workspace) return;
    const now = Date.now();
    if (now - heartbeatAt.current < 30000) return;
    heartbeatAt.current = now;
    void api.heartbeat().catch(() => undefined);
  }, 30000);

  useEffect(() => {
    void store.refreshStatus();
  }, []);

  const me = store.me;
  const ws = store.workspace;
  const url = new URL(path, "http://x");
  const parts = url.pathname.split("/").filter(Boolean);

  // Escape closes an open picker from anywhere on the page.
  useEffect(() => {
    if (!picker) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setPicker(null);
      if (pickerOpener.current && pickerOpener.current.isConnected) pickerOpener.current.focus();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [picker]);

  useEffect(() => {
    // The landing rules decide once the session is known.
    if (!store.bootstrapped) return;
    if (!me) {
      if (path === "/sign-in" || path === "/create-account") return;
      if (path === "/") navigate("/sign-in", true);
      else navigate(`/sign-in?next=${encodeURIComponent(path)}`, true);
      return;
    }
    if (!ws) {
      if (path === "/invitations") return;
      if (path === "/account" || parts[0] === "issues" || parts[0] === "cycle" || parts[0] === "chat" || parts[0] === "docs" || parts[0] === "office") {
        navigate("/invitations", true);
        return;
      }
      return;
    }
    if (path === "/welcome" && store.justJoined) return;
    if (
      path === "/" ||
      path === "/invitations" ||
      path === "/welcome" ||
      url.pathname === "/sign-in" ||
      path === "/create-account"
    ) {
      navigate("/issues", true);
      return;
    }
    if (path === "/account" && me.role === "owner") {
      navigate("/settings", true);
      return;
    }
    if (path === "/settings" && me.role !== "owner") {
      navigate("/issues", true);
      return;
    }
  }, [path, me, ws]);

  const nextParam = url.searchParams.get("next");

  if (!me) {
    const screen =
      path === "/create-account" ? (
        <CreateAccountScreen onNavigate={navigate} />
      ) : (
        <SignInScreen next={nextParam} onNavigate={navigate} />
      );
    return <Frame>{screen}</Frame>;
  }

  if (!ws) {
    if (path === "/welcome") {
      return (
        <Frame>
          <WelcomeScreen onNavigate={navigate} />
        </Frame>
      );
    }
    return (
      <Frame>
        <InvitationsScreen onNavigate={navigate} />
      </Frame>
    );
  }

  const issuesMatch = /^\/issues(?:\/(.*))?$/.exec(url.pathname);
  const cycleMatch = /^\/cycle(?:\/(\d+))?$/.exec(url.pathname);
  const chatMatch = /^\/chat(?:\/(.*))?$/.exec(url.pathname);
  const docsMatch = /^\/docs(?:\/(.*))?$/.exec(url.pathname);
  const isOffice = url.pathname === "/office";
  const isSettings = url.pathname === "/settings";
  const isAccount = url.pathname === "/account";

  const currentModule: string | null =
    issuesMatch ? "issues" : cycleMatch ? "cycle" : chatMatch ? "chat" : docsMatch ? "docs" : isOffice ? "office" : isSettings ? "settings" : isAccount ? "account" : null;

  const openPicker = (kind: "status" | "assignee", key: string, rect: DOMRect, issue?: Issue): void => {
    pickerOpener.current = document.activeElement as HTMLElement | null;
    const target = issue ?? store.issues[key] ?? null;
    if (!target) return;
    setPicker({ kind, issueKey: key, issue: target, anchorRect: rect });
  };

  const pickerIssue = picker ? picker.issue : null;

  return (
    <Frame>
      <div className="app-frame">
        <nav className="module-rail" aria-label="Modules">
          {MODULES.filter((m) => m.label !== "Settings" || me.role === "owner").map((m) => (
            <a
              key={m.href}
              href={m.href}
              aria-current={currentModule === m.href.split("/")[1] ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(m.href);
              }}
            >
              <span className="rail-label">{m.label}</span>
            </a>
          ))}
          {me.role !== "owner" && (
            <a
              href="/account"
              aria-current={currentModule === "account" ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate("/account");
              }}
            >
              <span className="rail-label">Account</span>
            </a>
          )}
          <button className="btn" aria-label="Sign out" onClick={() => void store.signOut().then(() => navigate("/sign-in", true))}>
            Sign out
          </button>
        </nav>
        {renderModule()}
      </div>
      <PickerLayer
        picker={picker}
        issue={pickerIssue}
        members={store.members}
        onPickStatus={(to) => {
          if (picker) void moveIssueStatus(picker.issueKey, to);
        }}
        onPickAssignee={(personId) => {
          if (picker) void assignIssueTo(picker.issueKey, personId);
        }}
        onClose={() => {
          // Closing a picker returns focus to the control that opened it.
          setPicker(null);
          if (pickerOpener.current && pickerOpener.current.isConnected) pickerOpener.current.focus();
        }}
      />
    </Frame>
  );

  function renderModule(): React.ReactNode {
    if (issuesMatch) {
      const issueKey = issuesMatch[1] ? decodeURIComponent(issuesMatch[1]) : null;
      const showDetail = isPhone ? Boolean(issueKey) : true;
      const showList = isPhone ? !issueKey : true;
      return (
        <>
          <div className={"pane-list" + (showList ? "" : " hidden-pane")} role="region" aria-label="List">
            <IssuesScreenList
              navigate={navigate}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              onOpen={(key) => navigate(`/issues/${key}${url.search}`)}
              onNewIssue={() => setNewIssueOpen(true)}
              onPicker={(kind, key, rect, issue) => openPicker(kind, key, rect, issue)}
            />
          </div>
          <div className={"pane-detail" + (showDetail ? "" : " hidden-pane")} role="region" aria-label="Detail" aria-hidden={!showDetail ? true : undefined}>
            {issueKey ? (
              <IssueDetail issueKey={issueKey} onPicker={openPicker} onNotFound={() => undefined} />
            ) : (
              <div className="not-found">Select an issue.</div>
            )}
          </div>
          {newIssueOpen && (
            <NewIssueDialog onClose={() => setNewIssueOpen(false)} navigate={navigate} query={url.search} />
          )}
        </>
      );
    }
    if (cycleMatch) {
      return (
        <>
          <div className={"pane-list" + (isPhone ? " hidden-pane" : "")} role="region" aria-label="List">
            <CycleList />
          </div>
          <div className="pane-detail" role="region" aria-label="Detail">
            <CycleModule number={cycleMatch[1] ? Number(cycleMatch[1]) : null} onNavigate={navigate} />
          </div>
        </>
      );
    }
    if (chatMatch) {
      const target = chatMatch[1] ? decodeURIComponent(chatMatch[1]) : "inbox";
      const showDetail = isPhone ? target !== "inbox" : true;
      const showList = isPhone ? target === "inbox" : true;
      return (
        <>
          <div className={"pane-list" + (showList ? "" : " hidden-pane")} role="region" aria-label="List">
            <ChatList currentChannelId={target} onNavigate={navigate} />
          </div>
          <div className={"pane-detail" + (showDetail ? "" : " hidden-pane")} role="region" aria-label="Detail">
            {target === "inbox" ? <InboxView /> : (
              <ChannelView channelId={target} onNavigate={navigate} isPhone={isPhone} onBack={() => navigate("/chat/inbox")} />
            )}
          </div>
        </>
      );
    }
    if (docsMatch) {
      const docId = docsMatch[1] ? decodeURIComponent(docsMatch[1]) : null;
      const showDetail = isPhone ? Boolean(docId) : true;
      const showList = isPhone ? !docId : true;
      return (
        <>
          <div className={"pane-list" + (showList ? "" : " hidden-pane")} role="region" aria-label="List">
            <DocsList onNavigate={navigate} currentDocId={docId} />
          </div>
          <div className={"pane-detail" + (showDetail ? "" : " hidden-pane")} role="region" aria-label="Detail">
            {docId ? <DocEditor docId={docId} isPhone={isPhone} onBack={() => navigate("/docs")} /> : <div className="not-found">Select a doc.</div>}
          </div>
        </>
      );
    }
    if (isOffice) {
      return (
        <>
          <div className={"pane-list" + (isPhone ? " hidden-pane" : "")} role="region" aria-label="List">
            <OfficeList currentRoomId={null} />
          </div>
          <div className="pane-detail" role="region" aria-label="Detail">
            <OfficeFloor onNotFound={() => undefined} />
          </div>
        </>
      );
    }
    if (url.pathname === "/welcome") {
      return (
        <div className="pane-detail" role="region" aria-label="Detail">
          <WelcomeScreen onNavigate={navigate} />
        </div>
      );
    }
    if (isSettings) {
      return (
        <div className="pane-detail" role="region" aria-label="Detail">
          <SettingsView />
        </div>
      );
    }
    if (isAccount) {
      return (
        <div className="pane-detail" role="region" aria-label="Detail">
          <h1>Account</h1>
          <PasswordForm />
        </div>
      );
    }
    return (
      <div className="pane-detail" role="region" aria-label="Detail">
        <div className="not-found">
          <h1>Not found</h1>
          <p>That item doesn't exist or isn't shared with you.</p>
        </div>
      </div>
    );
  }
}

function IssuesScreenList(props: {
  navigate: (path: string) => void;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onOpen: (key: string) => void;
  onNewIssue: () => void;
  onPicker: (kind: "status" | "assignee", key: string, rect: DOMRect, issue: Issue) => void;
}): React.ReactNode {
  const url = new URL(window.location.pathname + window.location.search, "http://x");
  const project = url.searchParams.get("project") ?? "";
  const cycle = url.searchParams.get("cycle") ?? "";
  const { issues, loading } = useIssuesQuery(buildIssuesQuery(project, cycle));

  useEffect(() => {
    if (issues.length > 0 && !issues.some((i) => i.key === props.selectedKey)) {
      props.onSelect(issues[0].key);
    }
  }, [issues]);

  const projectOptions = [{ id: "", name: "All projects" }, ...store.projects];
  const cycleOptions = [
    { value: "", label: "Current cycle" },
    { value: "all", label: "All cycles" },
    { value: "none", label: "No cycle" },
  ];

  return (
    <div>
      <div className="topbar" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
        <select
          aria-label="Project filter"
          value={project}
          onChange={(e) => {
            props.navigate(withQuery(e.target.value ? `project=${e.target.value}` : "", cycle));
          }}
        >
          {projectOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Cycle filter"
          value={cycle}
          onChange={(e) => {
            props.navigate(withQuery(project ? `project=${project}` : "", e.target.value ? `cycle=${e.target.value}` : ""));
          }}
        >
          {cycleOptions.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <button className="btn" aria-label="New issue" onClick={props.onNewIssue}>
          New issue
        </button>
      </div>
      {loading && <div className="meta">Loading…</div>}
      <IssuesList
        issues={issues}
        selectedKey={props.selectedKey}
        onSelect={props.onSelect}
        onOpen={props.onOpen}
        onPicker={(kind, key, rect) => {
          const issue = issues.find((i) => i.key === key);
          if (issue) props.onPicker(kind, key, rect, issue);
        }}
        focusListRef={() => undefined}
      />
    </div>
  );
}

function NewIssueDialog(props: { onClose: () => void; navigate: (path: string) => void; query: string }): React.ReactNode {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState(store.projects[0]?.id ?? "");
  const [error, setError] = useState("");
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-label="New issue">
        <h2>New issue</h2>
        <div className="form-grid">
          <label htmlFor="ni-title">Title</label>
          <input id="ni-title" aria-label="Title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} />
          <label htmlFor="ni-desc">Description</label>
          <textarea id="ni-desc" aria-label="Description" value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
          <label htmlFor="ni-project">Project</label>
          <select id="ni-project" aria-label="Project" value={projectId} onChange={(e) => setProjectId(e.currentTarget.value)}>
            {store.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div role="status" style={{ marginTop: 6 }}>
          {error}
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
          <button
            className="btn primary"
            aria-label="Create issue"
            onClick={() => {
              void (async () => {
                try {
                  const { data } = await api.createIssue({
                    project_id: projectId,
                    title,
                    description,
                  });
                  store.upsertIssue(data as Issue);
                  store.announce(`${data.key} created.`);
                  props.onClose();
                  props.navigate(`/issues/${data.key}${props.query}`);
                } catch (e) {
                  if (e instanceof ApiError) {
                    if (e.code === "cycle_closed") {
                      setError("Cycle <n> has ended. Plan into the current cycle or later.".replace("<n>", "That cycle"));
                      return;
                    }
                    if (e.fields?.title) {
                      setError("Give the issue a title.");
                      return;
                    }
                    if (e.code === "database_unavailable") {
                      setError("Tallyroom can't reach its database. Changes are not being saved.");
                      return;
                    }
                  }
                  setError("The issue wasn't created.");
                }
              })();
            }}
          >
            Create issue
          </button>
          <button className="btn" aria-label="Cancel" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function CycleList(): React.ReactNode {
  const issues = Object.values(store.issues);
  return (
    <div>
      <div className="section-label">Cycle issues</div>
      {issues.map((i) => (
        <div key={i.key} className="row">
          <span className="key">{i.key}</span>
          <span className="title">{i.title}</span>
        </div>
      ))}
      {issues.length === 0 && <div className="meta">The cycle's issues appear here.</div>}
    </div>
  );
}

function buildIssuesQuery(project: string, cycle: string): string {
  const params: string[] = [];
  if (project) params.push(`project=${encodeURIComponent(project)}`);
  if (cycle) params.push(`cycle=${encodeURIComponent(cycle)}`);
  return params.length > 0 ? `?${params.join("&")}` : "";
}

function withQuery(projectPart: string, cyclePart: string): string {
  const params = [projectPart, cyclePart].filter((p) => p.length > 0);
  return `/issues${params.length > 0 ? `?${params.join("&")}` : ""}`;
}

function Frame(props: { children: React.ReactNode }): React.ReactNode {
  return (
    <>
      <ServiceNotices status={store.status} workspace={store.workspace} />
      <div className="announcements" role="status" aria-live="polite" aria-label="Announcements">
        {store.announcements.slice(-3).map((a, i) => (
          <div key={i}>{a}</div>
        ))}
      </div>
      {props.children}
    </>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
