import { useRef, useState } from "preact/hooks";
import { get } from "../api";
import { useMount, useResource } from "../hooks";
import { Icon } from "../icons";
import { navigate, useRoute } from "../router";
import { orderTasks, useProjectData } from "../project-data";
import { openModal } from "../store";
import type { Me, Task } from "../types";
import { Dialog, Pill, refocus } from "../ui";
import { BoardView } from "../project/BoardView";
import { Detail } from "../project/Detail";
import { DownloadDialog } from "../project/dialogs";
import { ListView, type FocusRequest } from "../project/ListView";
import { TimelineView } from "../project/TimelineView";
import { EmptyState } from "./NotFound";

const VIEWS = [["list", "List"], ["board", "Board"], ["timeline", "Timeline"]] as const;
type View = (typeof VIEWS)[number][0];
const DESKTOP = "(min-width: 1100px)";

function useDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => matchMedia(DESKTOP).matches);
  useMount(() => {
    const query = matchMedia(DESKTOP);
    const update = () => setDesktop(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return desktop;
}

export function ProjectPage({ projectId, me }: { projectId: string; me: Me }) {
  const route = useRoute();
  const desktop = useDesktop();
  const data = useProjectData(projectId);
  const [panelOpen, setPanelOpen] = useState(desktop);
  const [openId, setOpenId] = useState<string | null>(route.query.get("task"));
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [slow, setSlow] = useState(false);
  const view: View = (VIEWS.find(([v]) => v === route.query.get("view"))?.[0]) ?? "list";
  const nonce = useRef(0);
  const bundle = data.bundle;

  useMount(() => {
    const timer = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(timer);
  }, [projectId]);
  useMount(() => { setOpenId(route.query.get("task")); }, [projectId]);

  const teamProjects = useResource<Array<{ id: string; name: string; progress: number }>>(async () => {
    if (!bundle) return undefined;
    const result = await get<{ projects: Array<{ id: string; name: string; progress: number }> }>(`/api/teams/${bundle.project.teamId}/projects`);
    return result.ok ? result.data.projects : undefined;
  }, [bundle?.project.teamId], (e) => e.t === "structure" || e.t === "tasks");

  if (data.missing) {
    return (
      <div class="page narrow">
        <EmptyState level={1} title="Project not found" action="Back to My work" onAction={() => navigate("/")} />
      </div>
    );
  }
  if (!bundle) {
    return (
      <div class="page">
        <div class="loading-block"><p class="empty-title">Loading</p>{slow && <Pill onClick={data.reload}>Reload</Pill>}</div>
      </div>
    );
  }
  const { project, tasks } = bundle;
  const openTask = openId ? tasks.find((t) => t.id === openId) : undefined;
  /** A docked detail needs the width, so the rail steps aside while a task is open. */
  const railShown = panelOpen && !(openTask && desktop);

  const open = (task: Task) => setOpenId(task.id);
  const close = () => {
    const id = openId;
    setOpenId(null);
    if (id) refocus(document.querySelector<HTMLElement>(`[data-open-id="${id}"]`));
  };
  const request = (target: FocusRequest["target"]) => {
    nonce.current += 1;
    setFocusRequest({ nonce: nonce.current, target });
  };
  const afterTaskDeleted = (task: Task) => {
    const flat = orderTasks(tasks, project.sections);
    const at = flat.findIndex((t) => t.id === task.id);
    const gone = new Set([task.id, ...flat.filter((t) => t.parentId === task.id).map((t) => t.id)]);
    const next = flat.slice(at + 1).find((t) => !gone.has(t.id)) ?? [...flat.slice(0, at)].reverse().find((t) => !gone.has(t.id));
    data.setTasks((all) => all.filter((t) => !gone.has(t.id)));
    setOpenId(null);
    request(next ? { row: next.id } : { add: true });
  };

  const tabKey = (event: KeyboardEvent, current: View) => {
    const order = VIEWS.map(([v]) => v);
    const at = order.indexOf(current);
    const next = event.key === "ArrowRight" ? order[(at + 1) % order.length] : event.key === "ArrowLeft" ? order[(at + order.length - 1) % order.length]
      : event.key === "Home" ? order[0] : event.key === "End" ? order[order.length - 1] : null;
    if (!next) return;
    event.preventDefault();
    navigate(`/projects/${projectId}?view=${next}`, true);
    queueMicrotask(() => document.getElementById(`view-tab-${next}`)?.focus());
  };

  const detail = openTask && (
    <Detail taskId={openTask.id} project={project} me={me} data={data} onClose={close} onDeleted={afterTaskDeleted} />
  );

  return (
    <div class={`project-page${desktop ? " is-desktop" : ""}${openTask && desktop ? " has-dock" : ""}`}>
      <aside id="project-panel" class="project-rail" hidden={!railShown} aria-label="Project panel contents">
        <h2 class="rail-title">Team projects</h2>
        <nav aria-label="Team projects">
          <ul class="plain-list">
            {(teamProjects.data ?? [{ id: project.id, name: project.name, progress: project.progress }]).map((p) => (
              <li key={p.id}><a href={`/projects/${p.id}`} aria-current={p.id === project.id ? "page" : undefined}>{p.name}</a></li>
            ))}
          </ul>
        </nav>
        <p class="muted num">{`${Math.floor(project.progress + 0.5)}% of tasks complete`}</p>
      </aside>
      <section class="project-main">
        <div class="project-head">
          <button type="button" class="pill pill-outline panel-toggle" aria-expanded={railShown} aria-controls="project-panel" onClick={() => setPanelOpen(!railShown)}>
            <Icon name={railShown ? "chevron-left" : "chevron-right"} size={16} />Project panel
          </button>
          <h1 class="project-title">{project.name}</h1>
        </div>
        <div class="chip-row">
          <div role="tablist" aria-label="Project views" class="tablist">
            {VIEWS.map(([value, label]) => (
              <button key={value} id={`view-tab-${value}`} type="button" role="tab" aria-selected={view === value} aria-controls="view-panel"
                tabIndex={view === value ? 0 : -1} class={`chip${view === value ? " is-active" : ""}`}
                onKeyDown={(e) => tabKey(e, view)} onClick={() => navigate(`/projects/${projectId}?view=${value}`, true)}>
                {label}
              </button>
            ))}
          </div>
          <a class="chip chip-link" href={`/workload/${project.teamId}`}>Workload</a>
          <a class="chip chip-link" href={`/projects/${projectId}/rules`}>Rules</a>
          <button type="button" class="chip chip-link" onClick={() => openModal((closeModal) => <DownloadDialog projectId={projectId} close={closeModal} />)}>
            <Icon name="download" size={16} />Download project
          </button>
        </div>
        <div id="view-panel" role="tabpanel" aria-labelledby={`view-tab-${view}`} class="view-panel">
          {view === "list" && <ListView data={data} bundle={bundle} onOpen={open} focusRequest={focusRequest} afterDelete={(_, target) => request(target)} />}
          {view === "board" && <BoardView data={data} bundle={bundle} onOpen={open} />}
          {view === "timeline" && <TimelineView data={data} bundle={bundle} onOpen={open} />}
        </div>
      </section>
      {openTask && desktop && (
        <DockedDetail label={`Task: ${openTask.name}`}>{detail}</DockedDetail>
      )}
      {openTask && !desktop && (
        <Dialog label={`Task: ${openTask.name}`} class={`sheet`} onClose={close}
          returnTo={() => document.querySelector<HTMLElement>(`[data-open-id="${openTask.id}"]`)}>
          {detail}
        </Dialog>
      )}
    </div>
  );
}

function DockedDetail({ label, children }: { label: string; children: preact.ComponentChildren }) {
  const ref = useRef<HTMLElement>(null);
  useMount(() => { ref.current?.focus({ preventScroll: true }); }, []);
  return <aside ref={ref} class="detail-dock" aria-label={label} tabIndex={-1}>{children}</aside>;
}
